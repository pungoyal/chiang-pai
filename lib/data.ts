// All reads and pie-moving writes. Every mutation runs in a transaction,
// locks the rows it checks, and only ever appends to the ledger.

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { MAX_AVATAR_BYTES, sniffImageType } from "./avatar.ts";
import { db } from "./db/index.ts";
import {
  allowlist,
  avatars,
  type BillEntryRow,
  type BillRevisionRow,
  billEntries,
  billRevisions,
  bills,
  type CommentRow,
  type CredentialRow,
  commentMentions,
  comments,
  credentials,
  type InviteRow,
  invites,
  type LedgerRow,
  ledger,
  type Market,
  type MarketReactionRow,
  type Member,
  marketReactions,
  markets,
  marketViews,
  members,
  type ReactionKind,
} from "./db/schema.ts";
import { normalizeEmail } from "./email.ts";
import { exposure, otherSide, type Position, refundAll, type Side, settle } from "./engine.ts";
import { env } from "./env.ts";
import { expiresAtFrom, hashInviteCode, inviteState, newInviteCode } from "./invites.ts";
import { logger } from "./logger.ts";
import { parseMentions } from "./mentions.ts";
import { piesText, toCents } from "./pies.ts";
import { type CandidateMarket, type MarketHistory, type Reason, recommend } from "./recommend.ts";
import {
  type BillEntryInput,
  type BillKind,
  buildEntries,
  type Currency,
  type MemberBillLine,
  memberBillLine,
  memberNets,
  nets,
  SplitError,
  type SplitMode,
  settleUpPlan,
  type Transfer,
} from "./split.ts";
import { type MarketResult, marketOutcomes, replay, summarizeResults, toResult } from "./stats.ts";

export type { ReactionKind };
// The pure accounting behind these reads lives in lib/stats.ts; re-exported so
// pages keep importing everything data-shaped from here.
export { type MarketResult, summarizeResults };

/** User-facing failures (insufficient pies, market closed, …). */
export class DataError extends Error {}

// ---------- derived shapes ----------

export interface ParticipantPosition {
  member: Member;
  side: Side;
  stakeC: number;
}

export interface MarketView {
  market: Market;
  creator: Member;
  yesPoolC: number;
  noPoolC: number;
  participants: ParticipantPosition[];
  mySide: Side | null;
  myStakeC: number;
}

export interface ActivityItem {
  row: LedgerRow;
  member: Member;
  market: Market | null;
}

/** An open market the viewer hasn't joined, with why it's being pitched. */
export interface RecommendedMarket {
  view: MarketView;
  /** Display-ready chip labels, strongest signal first. */
  reasons: string[];
}

export interface MemberStats {
  member: Member;
  netC: number;
  committedC: number;
  resolvedCount: number;
  wins: number;
  losses: number;
  wageredC: number;
  profitC: number;
  roi: number | null;
  ranked: boolean;
  biggestWinC: number;
  biggestLossC: number;
}

// ---------- replay helpers ----------

function positionsToParticipants(
  positions: Map<string, Position>,
  memberById: Map<string, Member>,
): ParticipantPosition[] {
  const out: ParticipantPosition[] = [];
  for (const [memberId, pos] of positions) {
    const stakeC = exposure(pos);
    if (stakeC === 0) continue;
    const member = memberById.get(memberId);
    if (!member) continue;
    out.push({ member, side: pos.yesC > 0 ? "yes" : "no", stakeC });
  }
  return out.sort((a, b) => b.stakeC - a.stakeC || a.member.name.localeCompare(b.member.name));
}

async function marketLedger(marketIds: string[]): Promise<Map<string, LedgerRow[]>> {
  const byMarket = new Map<string, LedgerRow[]>();
  if (marketIds.length === 0) return byMarket;
  const rows = await db
    .select()
    .from(ledger)
    .where(inArray(ledger.marketId, marketIds))
    .orderBy(asc(ledger.id));
  for (const row of rows) {
    const list = byMarket.get(row.marketId!) ?? [];
    list.push(row);
    byMarket.set(row.marketId!, list);
  }
  return byMarket;
}

async function membersById(): Promise<Map<string, Member>> {
  const all = await db.select().from(members);
  return new Map(all.map((m) => [m.id, m]));
}

/** Live upvote/watch rows for the given markets, keyed by market. */
async function reactionsByMarket(marketIds: string[]): Promise<Map<string, MarketReactionRow[]>> {
  const byMarket = new Map<string, MarketReactionRow[]>();
  if (marketIds.length === 0) return byMarket;
  const rows = await db
    .select()
    .from(marketReactions)
    .where(inArray(marketReactions.marketId, marketIds))
    .orderBy(asc(marketReactions.at));
  for (const row of rows) {
    const list = byMarket.get(row.marketId) ?? [];
    list.push(row);
    byMarket.set(row.marketId, list);
  }
  return byMarket;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every write starts the same way: take the row lock so concurrent bets on one
 * market serialize, then read back the stake events to replay. Callers check
 * `status` themselves — the message differs between betting and resolving.
 */
async function lockMarket(tx: Tx, marketId: string): Promise<Market> {
  const [market] = await tx.select().from(markets).where(eq(markets.id, marketId)).for("update");
  if (!market) throw new DataError("Prediction not found.");
  return market;
}

function requireOpen(market: Market): void {
  if (market.status !== "open") throw new DataError("This prediction has already been resolved.");
}

/** The bet/switch rows for one market, oldest first — the replay input. */
async function stakeRows(tx: Tx, marketId: string): Promise<LedgerRow[]> {
  return tx
    .select()
    .from(ledger)
    .where(and(eq(ledger.marketId, marketId), inArray(ledger.kind, ["bet", "switch"])))
    .orderBy(asc(ledger.id));
}

// ---------- membership ----------

export async function isAllowed(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (env.FOUNDING_MEMBERS.includes(normalized)) return true;
  const [row] = await db.select().from(allowlist).where(eq(allowlist.email, normalized));
  if (row) return true;
  const [existing] = await db.select().from(members).where(eq(members.email, normalized));
  return Boolean(existing);
}

/**
 * Called on every sign-in. Returns the member, creating them on first
 * arrival — or null if the email isn't invited. There is no starting grant:
 * every member has an infinite bank, and their number is lifetime net.
 */
export async function ensureMember(
  email: string,
  name: string | null,
  image: string | null,
  opts?: { bypassAllowlist?: boolean },
): Promise<Member | null> {
  const normalized = normalizeEmail(email);
  const [existing] = await db.select().from(members).where(eq(members.email, normalized));
  if (existing) {
    if ((name && name !== existing.name) || (image && image !== existing.image)) {
      const [updated] = await db
        .update(members)
        .set({ name: name ?? existing.name, image: image ?? existing.image })
        .where(eq(members.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  if (!opts?.bypassAllowlist && !(await isAllowed(normalized))) return null;

  try {
    const [created] = await db
      .insert(members)
      .values({ id: randomUUID(), email: normalized, name: name ?? normalized, image })
      .returning();
    logger.info({ memberId: created.id, email: normalized }, "member joined");
    return created;
  } catch {
    // Concurrent first sign-in: the unique email constraint fired; re-read.
    logger.debug({ email: normalized }, "concurrent first sign-in, re-reading member");
    const [raced] = await db.select().from(members).where(eq(members.email, normalized));
    return raced ?? null;
  }
}

// ---------- passkeys ----------
//
// A member may hold several; any of them signs them in. Verification is in
// lib/webauthn.ts — everything here is storage.

export async function listCredentials(memberId: string): Promise<CredentialRow[]> {
  return db
    .select()
    .from(credentials)
    .where(eq(credentials.memberId, memberId))
    .orderBy(asc(credentials.createdAt));
}

/** Sign-in looks a credential up by the id the authenticator handed the browser. */
export async function findCredential(id: string): Promise<CredentialRow | null> {
  const [row] = await db.select().from(credentials).where(eq(credentials.id, id));
  return row ?? null;
}

export async function addCredential(
  memberId: string,
  credential: {
    credentialId: string;
    publicKey: Buffer;
    alg: number;
    signCount: number;
    backedUp: boolean;
  },
): Promise<void> {
  await db.insert(credentials).values({
    id: credential.credentialId,
    memberId,
    publicKey: credential.publicKey,
    alg: credential.alg,
    signCount: credential.signCount,
    backedUp: credential.backedUp,
  });
  logger.info({ memberId, backedUp: credential.backedUp }, "passkey registered");
}

/** After a verified sign-in: advance the clone counter and note the visit. */
export async function noteCredentialUse(
  id: string,
  signCount: number,
  backedUp: boolean,
): Promise<void> {
  await db
    .update(credentials)
    .set({ signCount, backedUp, lastUsedAt: new Date() })
    .where(eq(credentials.id, id));
}

/**
 * Drop one of your own passkeys. Removing the last one is allowed while Google
 * sign-in is still there to fall back on; once it goes, this needs a guard.
 */
export async function removeCredential(memberId: string, id: string): Promise<void> {
  await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.memberId, memberId)));
  logger.info({ memberId }, "passkey removed");
}

/** Whether this member can sign in without Google yet. */
export async function hasPasskey(memberId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.memberId, memberId))
    .limit(1);
  return Boolean(row);
}

/** How many passkeys each member holds — the gate on retiring Google sign-in. */
export async function passkeyCounts(): Promise<Map<string, number>> {
  const rows = await db
    .select({ memberId: credentials.memberId, count: sql<number>`count(*)::int` })
    .from(credentials)
    .groupBy(credentials.memberId);
  return new Map(rows.map((r) => [r.memberId, r.count]));
}

export async function getMember(id: string): Promise<Member | null> {
  const [m] = await db.select().from(members).where(eq(members.id, id));
  return m ?? null;
}

export async function listMembers(): Promise<Member[]> {
  return db.select().from(members).orderBy(asc(members.joinedAt));
}

/** Legacy email invites, still honoured by Google sign-in until it goes. */
export async function listAllowlist() {
  return db.select().from(allowlist).orderBy(asc(allowlist.createdAt));
}

export function isFounder(member: Member): boolean {
  // Founders predate invite links, so they all still have an address. A member
  // who joined by link has none and is never a founder by this route.
  return member.email != null && env.FOUNDING_MEMBERS.includes(member.email);
}

/**
 * Store the member's own profile picture, overriding the Google one at
 * display time. Type is sniffed from the bytes — the upload's claimed MIME
 * type is never trusted, since these bytes are served back to browsers.
 */
export async function setAvatar(memberId: string, bytes: Buffer): Promise<void> {
  if (bytes.byteLength === 0) throw new DataError("That file looks empty.");
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    throw new DataError("Keep the picture under 512 KB.");
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) throw new DataError("Use a JPEG, PNG, or WebP image.");

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(avatars)
      .values({ memberId, contentType, data: bytes, updatedAt: now })
      .onConflictDoUpdate({
        target: avatars.memberId,
        set: { contentType, data: bytes, updatedAt: now },
      });
    await tx.update(members).set({ avatarUpdatedAt: now }).where(eq(members.id, memberId));
  });
  logger.info({ memberId, contentType, bytes: bytes.byteLength }, "avatar uploaded");
}

/** Drop the uploaded picture; the member falls back to their Google one. */
export async function clearAvatar(memberId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(avatars).where(eq(avatars.memberId, memberId));
    await tx.update(members).set({ avatarUpdatedAt: null }).where(eq(members.id, memberId));
  });
  logger.info({ memberId }, "avatar removed");
}

export async function getAvatar(
  memberId: string,
): Promise<{ contentType: string; data: Buffer } | null> {
  const [row] = await db.select().from(avatars).where(eq(avatars.memberId, memberId));
  return row ?? null;
}

// ---------- invite links ----------

/**
 * Mint a link for someone to join with — personal by default, or an open one
 * the whole group can use. Returns the code, which is also stored, so the
 * founder can copy the same link again later.
 */
export async function mintInvite(
  inviterId: string,
  label: string,
  opts?: { isOpen?: boolean },
): Promise<string> {
  const inviter = await getMember(inviterId);
  if (!inviter || !isFounder(inviter)) {
    throw new DataError("Only founding members can invite people.");
  }
  const trimmed = label.trim();
  if (!trimmed) throw new DataError("Say who the invite is for.");
  if (trimmed.length > 40) throw new DataError("Keep the name under 40 characters.");

  const isOpen = opts?.isOpen ?? false;
  const code = newInviteCode();
  const now = new Date();
  await db.insert(invites).values({
    codeHash: hashInviteCode(code),
    code,
    label: trimmed,
    isOpen,
    invitedBy: inviterId,
    expiresAt: expiresAtFrom(now, isOpen),
  });
  logger.info({ invitedBy: inviterId, label: trimmed, isOpen }, "invite link minted");
  return code;
}

export async function listInvites(): Promise<InviteRow[]> {
  return db.select().from(invites).orderBy(desc(invites.createdAt));
}

/** Look an invite up by the code from a link. Callers check its state. */
export async function findInvite(code: string): Promise<InviteRow | null> {
  const [row] = await db
    .select()
    .from(invites)
    .where(eq(invites.codeHash, hashInviteCode(code)));
  return row ?? null;
}

export async function revokeInvite(founderId: string, codeHash: string): Promise<void> {
  const founder = await getMember(founderId);
  if (!founder || !isFounder(founder)) {
    throw new DataError("Only founding members can revoke invites.");
  }
  // Spent personal invites stay: they record who let whom in. An open link is
  // revoked whether or not anyone has walked through it — that is how you shut
  // the door.
  await db
    .delete(invites)
    .where(
      and(eq(invites.codeHash, codeHash), or(isNull(invites.usedAt), eq(invites.isOpen, true))),
    );
  logger.info({ founderId }, "invite link revoked");
}

/**
 * Accept an invite: create the member, store the passkey that just proved
 * itself, and spend the link — one transaction, so two people opening the same
 * link race safely and exactly one of them ends up at the table.
 */
export async function joinWithInvite(input: {
  code: string;
  memberId: string;
  name: string;
  /** Chosen at sign-up; the column default (english) covers the rest. */
  lingo?: string;
  credential: {
    credentialId: string;
    publicKey: Buffer;
    alg: number;
    signCount: number;
    backedUp: boolean;
  };
}): Promise<Member> {
  const name = input.name.trim();
  if (name.length < 2) throw new DataError("Pick a name with at least two characters.");
  if (name.length > 40) throw new DataError("Keep the name under 40 characters.");

  const codeHash = hashInviteCode(input.code);
  const now = new Date();

  return db.transaction(async (tx) => {
    // Names are how @mentions find people (lib/mentions.ts), so they have to be
    // distinct — email used to do this quietly and no longer can.
    const [clash] = await tx
      .select({ id: members.id })
      .from(members)
      .where(sql`lower(${members.name}) = lower(${name})`);
    if (clash) throw new DataError("Someone at the table already goes by that name.");

    const [invite] = await tx
      .select()
      .from(invites)
      .where(eq(invites.codeHash, codeHash))
      .for("update");
    if (!invite) throw new DataError("That invite link isn't valid.");
    if (inviteState(invite, now) !== "live") {
      throw new DataError("That invite link has already been used or has expired.");
    }

    const [member] = await tx
      .insert(members)
      .values({ id: input.memberId, email: null, name, lingo: input.lingo ?? "english" })
      .returning();
    await tx.insert(credentials).values({
      id: input.credential.credentialId,
      memberId: member.id,
      publicKey: input.credential.publicKey,
      alg: input.credential.alg,
      signCount: input.credential.signCount,
      backedUp: input.credential.backedUp,
    });
    // useCount is what spends a personal link; an open one just keeps count.
    await tx
      .update(invites)
      .set({ usedAt: now, usedBy: member.id, useCount: invite.useCount + 1 })
      .where(eq(invites.codeHash, codeHash));

    logger.info({ memberId: member.id, invitedBy: invite.invitedBy }, "member joined by invite");
    return member;
  });
}

// ---------- markets: reads ----------

function buildView(
  market: Market,
  rows: LedgerRow[],
  memberById: Map<string, Member>,
  viewerId: string,
): MarketView {
  const positions = replay(rows);
  const participants = positionsToParticipants(positions, memberById);
  let yesPoolC = 0;
  let noPoolC = 0;
  for (const pos of positions.values()) {
    yesPoolC += pos.yesC;
    noPoolC += pos.noC;
  }
  const mine = positions.get(viewerId);
  const myStakeC = mine ? exposure(mine) : 0;
  return {
    market,
    creator: memberById.get(market.creatorId)!,
    yesPoolC,
    noPoolC,
    participants,
    mySide: myStakeC > 0 ? (mine!.yesC > 0 ? "yes" : "no") : null,
    myStakeC,
  };
}

export async function listMarkets(viewerId: string): Promise<{
  open: MarketView[];
  resolved: MarketView[];
  /** Open markets the viewer hasn't joined, ranked by lib/recommend. */
  forYou: RecommendedMarket[];
}> {
  const all = await db.select().from(markets).orderBy(desc(markets.createdAt));
  const memberById = await membersById();
  const rowsByMarket = await marketLedger(all.map((m) => m.id));
  const views = all.map((m) => buildView(m, rowsByMarket.get(m.id) ?? [], memberById, viewerId));
  const open = views.filter((v) => v.market.status === "open");
  const resolved = views
    .filter((v) => v.market.status !== "open")
    .sort((a, b) => (b.market.resolvedAt?.getTime() ?? 0) - (a.market.resolvedAt?.getTime() ?? 0));
  const forYou = await recommendFor(viewerId, open, all, rowsByMarket, memberById);
  return { open, resolved, forYou };
}

function reasonLabel(reason: Reason, memberById: Map<string, Member>): string {
  switch (reason.kind) {
    case "hot":
      return `🔥 ${reason.recentActions} bets in 2 days`;
    case "pool":
      return `${piesText(reason.poolC)} on the line`;
    case "contested":
      return "dead heat";
    case "friends": {
      const names = reason.memberIds.map(
        (id) => memberById.get(id)?.name.split(" ")[0] ?? "someone",
      );
      return `${names.join(" & ")} ${names.length === 1 ? "is" : "are"} in`;
    }
    case "topic":
      return "your kind of bet";
    case "fresh":
      return "just opened";
    case "unseen":
      return "you haven't looked";
    case "endorsed":
      return `👍 ${reason.upvotes} upvotes`;
    case "watching":
      return "you're watching";
  }
}

/**
 * Feed lib/recommend from data `listMarkets` already loaded, plus the viewer's
 * slice of the view log. Everything is derived at read time — no scores or
 * profiles are ever stored.
 */
async function recommendFor(
  viewerId: string,
  open: MarketView[],
  all: Market[],
  rowsByMarket: Map<string, LedgerRow[]>,
  memberById: Map<string, Member>,
): Promise<RecommendedMarket[]> {
  const viewed = await db
    .select({ marketId: marketViews.marketId })
    .from(marketViews)
    .where(eq(marketViews.memberId, viewerId));
  const reactions = await reactionsByMarket(open.map((v) => v.market.id));

  const candidates: CandidateMarket[] = open.map((v) => {
    const reacted = reactions.get(v.market.id) ?? [];
    return {
      id: v.market.id,
      creatorId: v.market.creatorId,
      question: v.market.question,
      createdAt: v.market.createdAt,
      yesPoolC: v.yesPoolC,
      noPoolC: v.noPoolC,
      stakes: v.participants.map((p) => ({
        memberId: p.member.id,
        side: p.side,
        stakeC: p.stakeC,
      })),
      actions: (rowsByMarket.get(v.market.id) ?? [])
        .filter((r) => r.kind === "bet" || r.kind === "switch")
        .map((r) => ({ memberId: r.memberId, at: r.at })),
      upvoterIds: reacted.filter((r) => r.kind === "upvote").map((r) => r.memberId),
      watcherIds: reacted.filter((r) => r.kind === "watch").map((r) => r.memberId),
    };
  });
  const history: MarketHistory[] = all.map((m) => ({
    id: m.id,
    creatorId: m.creatorId,
    question: m.question,
    participantIds: [...replay(rowsByMarket.get(m.id) ?? [])]
      .filter(([, pos]) => exposure(pos) > 0)
      .map(([memberId]) => memberId),
  }));

  const viewById = new Map(open.map((v) => [v.market.id, v]));
  return recommend({
    viewerId,
    now: new Date(),
    candidates,
    history,
    viewedMarketIds: new Set(viewed.map((r) => r.marketId)),
  }).map((rec) => ({
    view: viewById.get(rec.marketId)!,
    reasons: rec.reasons.slice(0, 2).map((r) => reasonLabel(r, memberById)),
  }));
}

export async function getMarketView(
  marketId: string,
  viewerId: string,
): Promise<{
  view: MarketView;
  activity: ActivityItem[];
  settlements: ActivityItem[];
  comments: CommentView[];
  /** Distinct members who have opened this prediction. */
  seenBy: number;
  /** Members who upvoted / are watching, oldest reaction first. */
  upvoters: Member[];
  watchers: Member[];
} | null> {
  const [market] = await db.select().from(markets).where(eq(markets.id, marketId));
  if (!market) return null;
  const memberById = await membersById();
  const rows = (await marketLedger([marketId])).get(marketId) ?? [];
  const view = buildView(market, rows, memberById, viewerId);
  const items: ActivityItem[] = rows.map((row) => ({
    row,
    member: memberById.get(row.memberId)!,
    market,
  }));
  const commentRows = await db
    .select()
    .from(comments)
    .where(eq(comments.marketId, marketId))
    .orderBy(asc(comments.id));
  const [seen] = await db
    .select({ seenBy: sql<number>`count(distinct ${marketViews.memberId})::int` })
    .from(marketViews)
    .where(eq(marketViews.marketId, marketId));
  const reacted = (await reactionsByMarket([marketId])).get(marketId) ?? [];
  const reactors = (kind: ReactionKind) =>
    reacted
      .filter((r) => r.kind === kind)
      .map((r) => memberById.get(r.memberId))
      .filter((m): m is Member => !!m);
  return {
    view,
    activity: items.filter((i) => i.row.kind === "bet" || i.row.kind === "switch").reverse(),
    settlements: items.filter((i) => i.row.kind === "payout" || i.row.kind === "refund"),
    comments: await toCommentViews(commentRows, memberById),
    seenBy: seen.seenBy,
    upvoters: reactors("upvote"),
    watchers: reactors("watch"),
  };
}

/**
 * Append "this member opened this prediction" to the view log, throttled so a
 * refresh spree counts once. Fired from the market page after real navigation
 * (never on link prefetch — see components/record-view.tsx).
 */
export async function recordMarketView(memberId: string, marketId: string): Promise<void> {
  const [last] = await db
    .select()
    .from(marketViews)
    .where(and(eq(marketViews.memberId, memberId), eq(marketViews.marketId, marketId)))
    .orderBy(desc(marketViews.id))
    .limit(1);
  if (last && Date.now() - last.at.getTime() < 5 * 60_000) return;
  await db.insert(marketViews).values({ memberId, marketId });
}

/**
 * Set or clear one member's upvote/watch on a prediction. Idempotent — the
 * client sends the state it wants, so a double-tap can't flip it back.
 * Resolved predictions keep their reactions but stop accepting new ones.
 */
export async function setReaction(
  memberId: string,
  marketId: string,
  kind: ReactionKind,
  on: boolean,
): Promise<void> {
  const [market] = await db.select().from(markets).where(eq(markets.id, marketId));
  if (!market) throw new DataError("Prediction not found.");
  if (on) {
    requireOpen(market);
    await db.insert(marketReactions).values({ memberId, marketId, kind }).onConflictDoNothing();
  } else {
    await db
      .delete(marketReactions)
      .where(
        and(
          eq(marketReactions.memberId, memberId),
          eq(marketReactions.marketId, marketId),
          eq(marketReactions.kind, kind),
        ),
      );
  }
  logger.info({ memberId, marketId, kind, on }, "reaction set");
}

export async function recentActivity(limit = 12): Promise<ActivityItem[]> {
  const rows = await db
    .select()
    .from(ledger)
    .where(inArray(ledger.kind, ["bet", "switch", "payout", "refund"]))
    .orderBy(desc(ledger.id))
    .limit(limit);
  const memberById = await membersById();
  const marketIds = [...new Set(rows.map((r) => r.marketId).filter((x): x is string => !!x))];
  const marketRows = marketIds.length
    ? await db.select().from(markets).where(inArray(markets.id, marketIds))
    : [];
  const marketById = new Map(marketRows.map((m) => [m.id, m]));
  return rows.map((row) => ({
    row,
    member: memberById.get(row.memberId)!,
    market: row.marketId ? (marketById.get(row.marketId) ?? null) : null,
  }));
}

// ---------- markets: writes ----------

export async function createMarket(
  creatorId: string,
  question: string,
  criteria: string,
): Promise<string> {
  const q = question.trim();
  const c = criteria.trim();
  if (q.length < 5) throw new DataError("Give the prediction a real question.");
  if (q.length > 200) throw new DataError("Keep the question under 200 characters.");
  if (c.length < 5) {
    throw new DataError("Spell out how this will be resolved — future-you will thank you.");
  }
  if (c.length > 2000) throw new DataError("Keep resolution criteria under 2000 characters.");
  const id = randomUUID();
  await db.insert(markets).values({ id, creatorId, question: q, criteria: c });
  logger.info({ marketId: id, creatorId }, "market created");
  return id;
}

export async function placeBet(
  memberId: string,
  marketId: string,
  side: Side,
  pies: number,
): Promise<void> {
  if (!Number.isInteger(pies) || pies < 1) {
    throw new DataError("A bet must be a whole number of pies, at least 1.");
  }
  const amountC = toCents(pies);
  const maxC = toCents(env.MAX_STAKE_PIES);

  await db.transaction(async (tx) => {
    requireOpen(await lockMarket(tx, marketId));
    const pos = replay(await stakeRows(tx, marketId)).get(memberId) ?? { yesC: 0, noC: 0 };

    const oppStakeC = side === "yes" ? pos.noC : pos.yesC;
    if (oppStakeC > 0) {
      throw new DataError("You're on the other side of this one. Switch sides first.");
    }
    if (exposure(pos) + amountC > maxC) {
      throw new DataError(`Max exposure is ${env.MAX_STAKE_PIES} pies per prediction.`);
    }
    // No balance check: members have an infinite bank. Net can go negative;
    // the per-market exposure cap is the only brake.

    await tx.insert(ledger).values({
      memberId,
      marketId,
      kind: "bet",
      side,
      amountC,
      balanceDeltaC: -amountC,
    });
  });
  logger.info({ memberId, marketId, side, amountC }, "bet placed");
}

export async function switchSides(memberId: string, marketId: string): Promise<void> {
  let switched: { from: Side; stakeC: number } | undefined;
  await db.transaction(async (tx) => {
    requireOpen(await lockMarket(tx, marketId));
    const pos = replay(await stakeRows(tx, marketId)).get(memberId);
    const stakeC = pos ? exposure(pos) : 0;
    if (!pos || stakeC === 0) throw new DataError("You have no bet to switch.");

    const from: Side = pos.yesC > 0 ? "yes" : "no";
    await tx.insert(ledger).values({
      memberId,
      marketId,
      kind: "switch",
      side: otherSide(from),
      amountC: stakeC,
      balanceDeltaC: 0,
      note: `Switched ${from.toUpperCase()} → ${otherSide(from).toUpperCase()}`,
    });
    switched = { from, stakeC };
  });
  if (switched) {
    logger.info(
      {
        memberId,
        marketId,
        from: switched.from,
        to: otherSide(switched.from),
        stakeC: switched.stakeC,
      },
      "sides switched",
    );
  }
}

export async function resolveMarket(
  marketId: string,
  resolverId: string,
  outcome: Side | "refunded",
  note: string,
): Promise<void> {
  let settled: { rows: number; totalC: number; autoRefunded: boolean } | undefined;
  await db.transaction(async (tx) => {
    const market = await lockMarket(tx, marketId);
    if (market.creatorId !== resolverId) {
      throw new DataError("Only the creator can resolve this prediction.");
    }
    if (market.status !== "open") throw new DataError("Already resolved — resolution is final.");

    const positions = replay(await stakeRows(tx, marketId));

    let resolutionNote = note.trim();

    if (outcome === "refunded") {
      const refunds = refundAll(positions);
      settled = {
        rows: refunds.size,
        totalC: [...refunds.values()].reduce((s, c) => s + c, 0),
        autoRefunded: false,
      };
      for (const [mid, amountC] of refunds) {
        await tx.insert(ledger).values({
          memberId: mid,
          marketId,
          kind: "refund",
          amountC,
          balanceDeltaC: amountC,
          note: "Market voided — stake returned",
        });
      }
    } else {
      const result = settle(positions, outcome);
      settled = {
        rows: result.payoutsC.size,
        totalC: result.totalPoolC,
        autoRefunded: result.autoRefunded,
      };
      if (result.autoRefunded) {
        resolutionNote = [
          resolutionNote,
          "Nobody held the winning side, so all stakes were returned.",
        ]
          .filter(Boolean)
          .join(" ");
        for (const [mid, amountC] of result.payoutsC) {
          await tx.insert(ledger).values({
            memberId: mid,
            marketId,
            kind: "refund",
            amountC,
            balanceDeltaC: amountC,
            note: "Winning side was empty — stake returned",
          });
        }
      } else {
        for (const [mid, amountC] of result.payoutsC) {
          await tx.insert(ledger).values({
            memberId: mid,
            marketId,
            kind: "payout",
            side: outcome,
            amountC,
            balanceDeltaC: amountC,
            note: `Share of the ${result.totalPoolC / 100}-pie pool`,
          });
        }
      }
    }

    await tx
      .update(markets)
      .set({
        status: outcome,
        resolvedAt: new Date(),
        resolutionNote: resolutionNote || null,
      })
      .where(eq(markets.id, marketId));
  });
  logger.info(
    {
      marketId,
      resolverId,
      outcome,
      poolC: settled?.totalC ?? 0,
      ledgerRows: settled?.rows ?? 0,
      autoRefunded: settled?.autoRefunded ?? false,
    },
    "market resolved",
  );
}

// ---------- member accounting ----------

export async function netOf(memberId: string): Promise<number> {
  const [row] = await db
    .select({ bal: sql<number>`coalesce(sum(${ledger.balanceDeltaC}), 0)::int` })
    .from(ledger)
    .where(eq(ledger.memberId, memberId));
  return row.bal;
}

export async function memberLedger(memberId: string): Promise<ActivityItem[]> {
  const rows = await db
    .select()
    .from(ledger)
    .where(eq(ledger.memberId, memberId))
    .orderBy(desc(ledger.id));
  const memberById = await membersById();
  const marketIds = [...new Set(rows.map((r) => r.marketId).filter((x): x is string => !!x))];
  const marketRows = marketIds.length
    ? await db.select().from(markets).where(inArray(markets.id, marketIds))
    : [];
  const marketById = new Map(marketRows.map((m) => [m.id, m]));
  return rows.map((row) => ({
    row,
    member: memberById.get(row.memberId)!,
    market: row.marketId ? (marketById.get(row.marketId) ?? null) : null,
  }));
}

/** One member's outcome in every resolved market they took part in. */
export async function memberResults(memberId: string): Promise<MarketResult[]> {
  const resolved = await db
    .select()
    .from(markets)
    .where(inArray(markets.status, ["yes", "no", "refunded"]))
    .orderBy(desc(markets.resolvedAt));
  const rowsByMarket = await marketLedger(resolved.map((m) => m.id));

  const results: MarketResult[] = [];
  for (const market of resolved) {
    const outcome = marketOutcomes(rowsByMarket.get(market.id) ?? []).get(memberId);
    if (!outcome) continue;
    results.push(toResult(market, outcome));
  }
  return results;
}

// ---------- leaderboard ----------

export async function leaderboard(): Promise<{ ranked: MemberStats[]; unranked: MemberStats[] }> {
  const allMembers = await listMembers();
  const stats = new Map<string, MemberStats>(
    allMembers.map((m) => [
      m.id,
      {
        member: m,
        netC: 0,
        committedC: 0,
        resolvedCount: 0,
        wins: 0,
        losses: 0,
        wageredC: 0,
        profitC: 0,
        roi: null,
        ranked: false,
        biggestWinC: 0,
        biggestLossC: 0,
      },
    ]),
  );

  const balances = await db
    .select({
      memberId: ledger.memberId,
      bal: sql<number>`coalesce(sum(${ledger.balanceDeltaC}), 0)::int`,
    })
    .from(ledger)
    .groupBy(ledger.memberId);
  for (const b of balances) {
    const s = stats.get(b.memberId);
    if (s) s.netC = b.bal;
  }

  const allMarkets = await db.select().from(markets);
  const rowsByMarket = await marketLedger(allMarkets.map((m) => m.id));

  for (const market of allMarkets) {
    for (const [memberId, outcome] of marketOutcomes(rowsByMarket.get(market.id) ?? [])) {
      const s = stats.get(memberId);
      if (!s) continue;

      if (market.status === "open") {
        s.committedC += outcome.stakeC;
        continue;
      }
      // Voided or auto-refunded: stake came back, no skill signal.
      if (market.status === "refunded" || outcome.refundC > 0) continue;

      const profitC = outcome.payoutC - outcome.stakeC;
      s.resolvedCount += 1;
      s.wageredC += outcome.stakeC;
      s.profitC += profitC;
      if (outcome.payoutC > 0) s.wins += 1;
      else s.losses += 1;
      s.biggestWinC = Math.max(s.biggestWinC, profitC);
      s.biggestLossC = Math.min(s.biggestLossC, profitC);
    }
  }

  const all = [...stats.values()];
  for (const s of all) {
    s.roi = s.wageredC > 0 ? s.profitC / s.wageredC : null;
    s.ranked = s.resolvedCount >= env.RANKED_MIN_RESOLVED;
  }
  const ranked = all
    .filter((s) => s.ranked)
    .sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0) || b.profitC - a.profitC);
  const unranked = all
    .filter((s) => !s.ranked)
    .sort((a, b) => b.resolvedCount - a.resolvedCount || b.profitC - a.profitC);
  return { ranked, unranked };
}

// ---------- inbox ----------
// Derived, not stored: "what happened that concerns me" is computed from
// markets + ledger. Read state is a single per-member timestamp cursor.

export type InboxItem =
  | { kind: "new_market"; at: Date; unread: boolean; market: Market; actor: Member }
  | { kind: "activity"; at: Date; unread: boolean; market: Market; actor: Member; row: LedgerRow }
  | {
      kind: "resolved";
      at: Date;
      unread: boolean;
      market: Market;
      actor: Member;
      myProfitC: number | null;
    }
  | {
      kind: "comment";
      at: Date;
      unread: boolean;
      market: Market;
      actor: Member;
      commentId: number;
      body: string;
    }
  | {
      kind: "mention";
      at: Date;
      unread: boolean;
      actor: Member;
      commentId: number;
      body: string;
      /** Where I was tagged: exactly one of these is set. */
      market: Market | null;
      bill: { id: string; label: string } | null;
    };

export async function inbox(
  memberId: string,
  limit = 50,
): Promise<{ items: InboxItem[]; unreadCount: number }> {
  const me = await getMember(memberId);
  if (!me) return { items: [], unreadCount: 0 };
  const seenAt = me.inboxSeenAt?.getTime() ?? 0;

  const memberById = await membersById();
  const allMarkets = await db.select().from(markets);
  const marketById = new Map(allMarkets.map((m) => [m.id, m]));
  const rowsByMarket = await marketLedger(allMarkets.map((m) => m.id));

  // Markets that concern me: I created them, I hold/held a stake, or I hit
  // watch — that's exactly what watching promises.
  const mine = new Set<string>();
  for (const market of allMarkets) {
    if (market.creatorId === memberId) mine.add(market.id);
    else if (
      (rowsByMarket.get(market.id) ?? []).some((r) => r.memberId === memberId && r.kind === "bet")
    ) {
      mine.add(market.id);
    }
  }
  const watching = await db
    .select({ marketId: marketReactions.marketId })
    .from(marketReactions)
    .where(and(eq(marketReactions.memberId, memberId), eq(marketReactions.kind, "watch")));
  for (const w of watching) mine.add(w.marketId);

  const items: InboxItem[] = [];

  for (const market of allMarkets) {
    const creator = memberById.get(market.creatorId)!;

    // Someone opened a new prediction.
    if (market.creatorId !== memberId) {
      items.push({
        kind: "new_market",
        at: market.createdAt,
        unread: market.createdAt.getTime() > seenAt,
        market,
        actor: creator,
      });
    }

    if (!mine.has(market.id)) continue;

    // Friends moving on a market I'm in (or created).
    for (const row of rowsByMarket.get(market.id) ?? []) {
      if (row.memberId === memberId) continue;
      if (row.kind !== "bet" && row.kind !== "switch") continue;
      items.push({
        kind: "activity",
        at: row.at,
        unread: row.at.getTime() > seenAt,
        market,
        actor: memberById.get(row.memberId)!,
        row,
      });
    }

    // The verdict, with my result if I had a stake.
    if (market.status !== "open" && market.resolvedAt && market.creatorId !== memberId) {
      const outcome = marketOutcomes(rowsByMarket.get(market.id) ?? []).get(memberId);
      const myProfitC = outcome ? toResult(market, outcome).profitC : null;
      items.push({
        kind: "resolved",
        at: market.resolvedAt,
        unread: market.resolvedAt.getTime() > seenAt,
        market: marketById.get(market.id)!,
        actor: creator,
        myProfitC,
      });
    }
  }

  // Table talk: comments on predictions that concern me, and — on predictions
  // or bills — comments that tag me. Both derive straight from the comment
  // and mention rows; a comment that tags me shows once, as the mention.
  const commentRows = await db.select().from(comments).orderBy(asc(comments.id));
  const myMentions = commentRows.length
    ? await db.select().from(commentMentions).where(eq(commentMentions.memberId, memberId))
    : [];
  const taggedIn = new Set(myMentions.map((m) => m.commentId));
  const wantsBillLabel = commentRows.some(
    (c) => c.billId && taggedIn.has(c.id) && c.authorId !== memberId,
  );
  const billLabelById = wantsBillLabel ? await billLabels() : new Map<string, string>();

  for (const c of commentRows) {
    if (c.authorId === memberId) continue;
    const base = {
      at: c.at,
      unread: c.at.getTime() > seenAt,
      actor: memberById.get(c.authorId)!,
      commentId: c.id,
      body: c.body,
    };
    if (taggedIn.has(c.id)) {
      items.push({
        kind: "mention",
        ...base,
        market: c.marketId ? (marketById.get(c.marketId) ?? null) : null,
        bill: c.billId ? { id: c.billId, label: billLabelById.get(c.billId) ?? "a bill" } : null,
      });
    } else if (c.marketId && mine.has(c.marketId)) {
      items.push({ kind: "comment", ...base, market: marketById.get(c.marketId)! });
    }
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  const trimmed = items.slice(0, limit);
  return {
    items: trimmed,
    unreadCount: items.filter((i) => i.unread).length,
  };
}

export async function setLingo(memberId: string, lingo: string): Promise<void> {
  await db.update(members).set({ lingo }).where(eq(members.id, memberId));
}

export async function markInboxSeen(memberId: string): Promise<void> {
  await db.update(members).set({ inboxSeenAt: new Date() }).where(eq(members.id, memberId));
}

// ---------- split bills ----------
// Real money (INR/THB), fully separate from the pie ledger. Bills are
// append-only revisions (see schema); the current state of a bill is its
// latest revision, and every balance below is derived by replay at read time.
// The pure math lives in lib/split.ts.

export interface BillEntryView {
  member: Member;
  paidC: number;
  owedC: number;
  participant: boolean;
}

export interface BillView {
  id: string;
  kind: BillKind;
  onDate: string;
  description: string;
  currency: Currency;
  split: SplitMode;
  totalC: number;
  entries: BillEntryView[];
  createdBy: Member;
  createdAt: Date;
  /** Who last touched it, when it isn't the creator's original. */
  editedBy: Member | null;
  editedAt: Date | null;
}

export interface CurrencyBalances {
  currency: Currency;
  /** Nonzero nets, biggest creditor first. Positive = the group owes them. */
  nets: { member: Member; netC: number }[];
  /** Shortest who-pays-whom plan that clears those nets. */
  plan: (Transfer & { from: Member; to: Member })[];
}

export interface BillsOverview {
  bills: BillView[];
  balances: CurrencyBalances[];
}

export interface BillInput {
  kind?: BillKind;
  onDate: string;
  description: string;
  currency: Currency;
  split: SplitMode;
  entries: BillEntryInput[];
}

function requireBillInput(input: BillInput): BillInput {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onDate)) throw new DataError("Pick a date for the bill.");
  const description = input.description.trim();
  if ((input.kind ?? "expense") === "expense" && description.length === 0) {
    throw new DataError("Say what the bill was for.");
  }
  if (description.length > 200) throw new DataError("Keep the description under 200 characters.");
  return { ...input, description };
}

/** Latest revision per bill, oldest first; callers filter deleted ones. */
async function currentRevisions(): Promise<{
  current: BillRevisionRow[];
  firstByBill: Map<string, BillRevisionRow>;
  revisionCount: Map<string, number>;
}> {
  const rows = await db.select().from(billRevisions).orderBy(asc(billRevisions.id));
  const latest = new Map<string, BillRevisionRow>();
  const firstByBill = new Map<string, BillRevisionRow>();
  const revisionCount = new Map<string, number>();
  for (const row of rows) {
    latest.set(row.billId, row);
    if (!firstByBill.has(row.billId)) firstByBill.set(row.billId, row);
    revisionCount.set(row.billId, (revisionCount.get(row.billId) ?? 0) + 1);
  }
  return { current: [...latest.values()], firstByBill, revisionCount };
}

export async function billsOverview(): Promise<BillsOverview> {
  const memberById = await membersById();
  const { current, firstByBill, revisionCount } = await currentRevisions();
  const live = current.filter((r) => !r.deleted);

  const entryRows = live.length
    ? await db
        .select()
        .from(billEntries)
        .where(
          inArray(
            billEntries.revisionId,
            live.map((r) => r.id),
          ),
        )
        .orderBy(asc(billEntries.id))
    : [];
  const entriesByRevision = new Map<number, BillEntryRow[]>();
  for (const row of entryRows) {
    const list = entriesByRevision.get(row.revisionId) ?? [];
    list.push(row);
    entriesByRevision.set(row.revisionId, list);
  }

  const views: BillView[] = live.map((rev) => {
    const rows = entriesByRevision.get(rev.id) ?? [];
    const first = firstByBill.get(rev.billId)!;
    const edited = (revisionCount.get(rev.billId) ?? 1) > 1;
    return {
      id: rev.billId,
      kind: rev.kind,
      onDate: rev.onDate,
      description: rev.description,
      currency: rev.currency,
      split: rev.split,
      totalC: rows.reduce((sum, e) => sum + e.paidC, 0),
      entries: rows.map((e) => ({
        member: memberById.get(e.memberId)!,
        paidC: e.paidC,
        owedC: e.owedC,
        participant: e.participant,
      })),
      createdBy: memberById.get(first.editorId)!,
      createdAt: first.at,
      editedBy: edited ? (memberById.get(rev.editorId) ?? null) : null,
      editedAt: edited ? rev.at : null,
    };
  });
  views.sort(
    (a, b) => b.onDate.localeCompare(a.onDate) || b.createdAt.getTime() - a.createdAt.getTime(),
  );

  const netsByCurrency = nets(
    views.map((v) => ({
      currency: v.currency,
      entries: v.entries.map((e) => ({ memberId: e.member.id, paidC: e.paidC, owedC: e.owedC })),
    })),
  );
  const balances: CurrencyBalances[] = [...netsByCurrency]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, net]) => ({
      currency,
      nets: [...net]
        .filter(([, netC]) => netC !== 0)
        .map(([memberId, netC]) => ({ member: memberById.get(memberId)!, netC }))
        .sort((a, b) => b.netC - a.netC || a.member.name.localeCompare(b.member.name)),
      plan: settleUpPlan(net).map((t) => ({
        ...t,
        from: memberById.get(t.fromId)!,
        to: memberById.get(t.toId)!,
      })),
    }));

  return { bills: views, balances };
}

export interface MemberSplitView {
  /** Outstanding per currency; positive = the group owes them. Zero = square. */
  balances: { currency: Currency; netC: number }[];
  /** Bills they paid on or had a share covered, newest first, with their line. */
  bills: { bill: BillView; line: MemberBillLine }[];
}

/** One member's slice of the split bills — assembly over the pure lib/split. */
export async function memberSplit(memberId: string): Promise<MemberSplitView> {
  const { bills } = await billsOverview();
  const forNets = bills.map((b) => ({
    currency: b.currency,
    entries: b.entries.map((e) => ({ memberId: e.member.id, paidC: e.paidC, owedC: e.owedC })),
  }));
  return {
    balances: memberNets(forNets, memberId),
    bills: bills.flatMap((bill, i) => {
      const line = memberBillLine(forNets[i].entries, memberId);
      return line ? [{ bill, line }] : [];
    }),
  };
}

/**
 * Insert one revision (plus its entries) for a bill — the single write shape
 * behind add, edit, and delete. Validation happens in lib/split.ts; its
 * errors carry member-facing messages, so they surface as rule violations.
 */
async function appendRevision(
  editorId: string,
  billId: string,
  input: BillInput,
  opts?: { deleted?: boolean },
): Promise<void> {
  const checked = requireBillInput(input);
  let entryValues: ReturnType<typeof buildEntries> = [];
  if (!opts?.deleted) {
    try {
      entryValues = buildEntries(checked.split, checked.entries);
    } catch (err) {
      if (err instanceof SplitError) throw new DataError(err.message);
      throw err;
    }
  }

  await db.transaction(async (tx) => {
    const [bill] = await tx.select().from(bills).where(eq(bills.id, billId)).for("update");
    if (!bill) throw new DataError("Bill not found.");
    const [revision] = await tx
      .insert(billRevisions)
      .values({
        billId,
        editorId,
        deleted: opts?.deleted ?? false,
        kind: checked.kind ?? "expense",
        onDate: checked.onDate,
        description: checked.description,
        currency: checked.currency,
        split: checked.split,
      })
      .returning();
    if (entryValues.length > 0) {
      await tx.insert(billEntries).values(
        entryValues.map((e) => ({
          revisionId: revision.id,
          memberId: e.memberId,
          paidC: e.paidC,
          owedC: e.owedC,
          participant: e.participant,
        })),
      );
    }
  });
}

export async function addBill(memberId: string, input: BillInput): Promise<string> {
  const id = randomUUID();
  await db.insert(bills).values({ id });
  await appendRevision(memberId, id, input);
  logger.info({ billId: id, memberId, kind: input.kind ?? "expense" }, "bill added");
  return id;
}

/** Anyone in the group can edit any bill; the revision trail keeps it honest. */
export async function editBill(memberId: string, billId: string, input: BillInput): Promise<void> {
  await appendRevision(memberId, billId, input);
  logger.info({ billId, memberId }, "bill edited");
}

export async function deleteBill(memberId: string, billId: string): Promise<void> {
  const [last] = await db
    .select()
    .from(billRevisions)
    .where(eq(billRevisions.billId, billId))
    .orderBy(desc(billRevisions.id))
    .limit(1);
  if (!last) throw new DataError("Bill not found.");
  await appendRevision(
    memberId,
    billId,
    {
      kind: last.kind,
      onDate: last.onDate,
      description: last.description,
      currency: last.currency,
      split: last.split,
      entries: [],
    },
    { deleted: true },
  );
  logger.info({ billId, memberId }, "bill deleted");
}

/** "X paid Y back" — recorded as a settlement bill so replay cancels the debt. */
export async function recordSettlement(
  memberId: string,
  input: {
    payerId: string;
    receiverId: string;
    currency: Currency;
    amountC: number;
    onDate: string;
  },
): Promise<string> {
  if (input.payerId === input.receiverId) {
    throw new DataError("A payment needs two different people.");
  }
  if (!Number.isInteger(input.amountC) || input.amountC <= 0) {
    throw new DataError("Enter the amount that was paid back.");
  }
  return addBill(memberId, {
    kind: "settlement",
    onDate: input.onDate,
    description: "",
    currency: input.currency,
    split: "custom",
    entries: [
      { memberId: input.payerId, paidC: input.amountC, participant: false },
      { memberId: input.receiverId, paidC: 0, participant: true, owedC: input.amountC },
    ],
  });
}

// ---------- comments ----------
// Table talk on predictions and bills. Append-only like the ledger; mentions
// in the body are resolved against member names at write time (lib/mentions.ts)
// and snapshotted as comment_mentions rows. The inbox derives "you were
// tagged" from those rows at read time — comments store facts, never
// notifications.

export interface CommentView {
  id: number;
  at: Date;
  author: Member;
  body: string;
  /** Members tagged in the body — for highlighting and inbox mentions. */
  mentions: Member[];
}

async function toCommentViews(
  rows: CommentRow[],
  memberById: Map<string, Member>,
): Promise<CommentView[]> {
  if (rows.length === 0) return [];
  const mentionRows = await db
    .select()
    .from(commentMentions)
    .where(
      inArray(
        commentMentions.commentId,
        rows.map((r) => r.id),
      ),
    );
  const mentionsByComment = new Map<number, Member[]>();
  for (const row of mentionRows) {
    const member = memberById.get(row.memberId);
    if (!member) continue;
    const list = mentionsByComment.get(row.commentId) ?? [];
    list.push(member);
    mentionsByComment.set(row.commentId, list);
  }
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    author: memberById.get(row.authorId)!,
    body: row.body,
    mentions: mentionsByComment.get(row.id) ?? [],
  }));
}

/** Every bill's comments in one go, keyed by bill id, oldest first. */
export async function billComments(): Promise<Record<string, CommentView[]>> {
  const rows = await db
    .select()
    .from(comments)
    .where(isNotNull(comments.billId))
    .orderBy(asc(comments.id));
  const views = await toCommentViews(rows, await membersById());
  const byBill: Record<string, CommentView[]> = {};
  rows.forEach((row, i) => {
    const list = byBill[row.billId!] ?? [];
    list.push(views[i]);
    byBill[row.billId!] = list;
  });
  return byBill;
}

/** Latest description per bill, for inbox lines about bill comments. */
async function billLabels(): Promise<Map<string, string>> {
  const { current } = await currentRevisions();
  return new Map(current.map((rev) => [rev.billId, rev.description || "a payment"]));
}

export async function addComment(
  authorId: string,
  target: { marketId?: string; billId?: string },
  body: string,
): Promise<void> {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new DataError("Write the comment first.");
  if (trimmed.length > 1000) throw new DataError("Keep the comment under 1000 characters.");
  const marketId = target.marketId ?? null;
  const billId = target.billId ?? null;
  if (marketId) {
    const [market] = await db.select().from(markets).where(eq(markets.id, marketId));
    if (!market) throw new DataError("Prediction not found.");
  } else if (billId) {
    const [bill] = await db.select().from(bills).where(eq(bills.id, billId));
    if (!bill) throw new DataError("Bill not found.");
  } else {
    throw new DataError("A comment goes on a prediction or a bill.");
  }
  const mentionIds = parseMentions(trimmed, await listMembers());
  await db.transaction(async (tx) => {
    const [comment] = await tx
      .insert(comments)
      .values({ authorId, marketId, billId, body: trimmed })
      .returning();
    if (mentionIds.length > 0) {
      await tx
        .insert(commentMentions)
        .values(mentionIds.map((memberId) => ({ commentId: comment.id, memberId })));
    }
  });
  logger.info({ authorId, marketId, billId, mentions: mentionIds.length }, "comment added");
}
