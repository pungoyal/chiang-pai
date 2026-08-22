// All reads and pie-moving writes. Every mutation runs in a transaction,
// locks the rows it checks, and only ever appends to the ledger.
//
// Everything a member does happens on a trip, and every read and write here
// is scoped to one: a function that takes a `tripId` answers for that trip's
// roster and record alone, and a function that takes a market or bill id
// finds the trip through it. Membership is checked here, not in the UI —
// every action is reachable by anyone who can POST.

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { MAX_AVATAR_BYTES, sniffImageType } from "./avatar.ts";
import { db } from "./db/index.ts";
import {
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
  type MembershipRole,
  type MembershipRow,
  marketReactions,
  markets,
  marketViews,
  members,
  memberships,
  type PhraseRow,
  phrases,
  type ReactionKind,
  type RecoveryRow,
  recoveries,
  type Trip,
  trips,
} from "./db/schema.ts";
import { normalizeEmail } from "./email.ts";
import { exposure, otherSide, type Position, refundAll, type Side, settle } from "./engine.ts";
import { env } from "./env.ts";
import { expiresAtFrom, inviteState, newInviteCode } from "./invites.ts";
import { logger } from "./logger.ts";
import { parseMentions } from "./mentions.ts";
import { MAX_PHRASE_NAME, MAX_PHRASES, type SavedPhrase, uniqueSlug } from "./phrases.ts";
import { toCents } from "./pies.ts";
import { type CandidateMarket, type MarketHistory, recommend } from "./recommend.ts";
import {
  newRecoveryCode,
  recoveryExpiresAt,
  recoveryState,
  visibleRecoveries,
} from "./recovery.ts";
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
import {
  type MarketResult,
  marketOutcomes,
  type Rivalry,
  replay,
  rivalries,
  type Superlative,
  summarizeResults,
  superlatives,
  toResult,
} from "./stats.ts";
import { clampUtterance, type Side as TalkSide, worthSaying } from "./talk.ts";
import { TripError, type TripInput, tripConfig, tripCurrencies } from "./trips.ts";
import type { VerifiedRegistration } from "./webauthn.ts";

export type { ReactionKind, SavedPhrase };
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
  upvotes: number;
  watchers: number;
  commentCount: number;
}

export interface ActivityItem {
  row: LedgerRow;
  member: Member;
  market: Market | null;
}

export interface MemberStats {
  member: Member;
  role: MembershipRole;
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

/**
 * Everyone who has ever been on the trip, keyed by id — including members who
 * since deleted their account, whose scrubbed row still has to render beside
 * the pies they won. `membersOf` is the live roster.
 */
async function membersById(tripId: string): Promise<Map<string, Member>> {
  const rows = await db
    .select({ member: members })
    .from(memberships)
    .innerJoin(members, eq(members.id, memberships.memberId))
    .where(eq(memberships.tripId, tripId));
  return new Map(rows.map((r) => [r.member.id, r.member]));
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

/** Comment tallies for the given markets, keyed by market. */
async function commentCountByMarket(marketIds: string[]): Promise<Map<string, number>> {
  const byMarket = new Map<string, number>();
  if (marketIds.length === 0) return byMarket;
  const rows = await db
    .select({ marketId: comments.marketId, n: sql<number>`count(*)::int` })
    .from(comments)
    .where(inArray(comments.marketId, marketIds))
    .groupBy(comments.marketId);
  for (const row of rows) byMarket.set(row.marketId!, row.n);
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

// ---------- trips ----------

export interface TripContext {
  trip: Trip;
  membership: MembershipRow;
}

export async function getTrip(id: string): Promise<Trip | null> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, id));
  return trip ?? null;
}

/** The trip and the member's seat on it, or null when they have none. */
export async function tripFor(memberId: string, tripId: string): Promise<TripContext | null> {
  const [row] = await db
    .select({ trip: trips, membership: memberships })
    .from(memberships)
    .innerJoin(trips, eq(trips.id, memberships.tripId))
    .where(and(eq(memberships.tripId, tripId), eq(memberships.memberId, memberId)));
  return row ?? null;
}

/** The membership check every scoped write makes. */
async function requireMembership(tripId: string, memberId: string): Promise<TripContext> {
  const ctx = await tripFor(memberId, tripId);
  if (!ctx) throw new DataError("You're not on this trip.");
  return ctx;
}

async function requireOrganiser(tripId: string, memberId: string): Promise<TripContext> {
  const ctx = await requireMembership(tripId, memberId);
  if (ctx.membership.role !== "organiser") {
    throw new DataError("Only an organiser of this trip can do that.");
  }
  return ctx;
}

export function isOrganiser(ctx: { membership: { role: MembershipRole } }): boolean {
  return ctx.membership.role === "organiser";
}

export interface TripSummary {
  trip: Trip;
  role: MembershipRole;
  memberCount: number;
  openCount: number;
}

/** Every trip the member is on, newest first. */
export async function listTrips(memberId: string): Promise<TripSummary[]> {
  const rows = await db
    .select({ trip: trips, role: memberships.role })
    .from(memberships)
    .innerJoin(trips, eq(trips.id, memberships.tripId))
    .where(eq(memberships.memberId, memberId))
    .orderBy(desc(trips.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.trip.id);
  const counts = await db
    .select({ tripId: memberships.tripId, n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(inArray(memberships.tripId, ids))
    .groupBy(memberships.tripId);
  const opens = await db
    .select({ tripId: markets.tripId, n: sql<number>`count(*)::int` })
    .from(markets)
    .where(and(inArray(markets.tripId, ids), eq(markets.status, "open")))
    .groupBy(markets.tripId);
  const countBy = new Map(counts.map((c) => [c.tripId, c.n]));
  const openBy = new Map(opens.map((c) => [c.tripId, c.n]));
  return rows.map((r) => ({
    trip: r.trip,
    role: r.role,
    memberCount: countBy.get(r.trip.id) ?? 0,
    openCount: openBy.get(r.trip.id) ?? 0,
  }));
}

/**
 * Open a trip. Whoever creates it is its first organiser; there is nothing
 * else to be on it until they share a link.
 */
export async function createTrip(creatorId: string, input: TripInput): Promise<Trip> {
  let config: ReturnType<typeof tripConfig>;
  try {
    config = tripConfig(input);
  } catch (err) {
    if (err instanceof TripError) throw new DataError(err.message);
    throw err;
  }
  const id = randomUUID();
  const trip = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(trips)
      .values({ id, createdBy: creatorId, ...config })
      .returning();
    await tx.insert(memberships).values({ tripId: id, memberId: creatorId, role: "organiser" });
    return created;
  });
  logger.info({ tripId: id, creatorId, destination: config.destination }, "trip created");
  return trip;
}

/** Change the trip's name, dates, or cap. Organisers only; the pair is fixed. */
export async function updateTrip(
  actorId: string,
  tripId: string,
  input: Omit<TripInput, "destination" | "homeLanguage" | "homeCurrency">,
): Promise<Trip> {
  const { trip } = await requireOrganiser(tripId, actorId);
  let config: ReturnType<typeof tripConfig>;
  try {
    config = tripConfig({
      ...input,
      destination: trip.destination,
      homeLanguage: trip.homeLanguage,
      homeCurrency: trip.homeCurrency,
    });
  } catch (err) {
    if (err instanceof TripError) throw new DataError(err.message);
    throw err;
  }
  const [updated] = await db
    .update(trips)
    .set({
      name: config.name,
      startsOn: config.startsOn,
      endsOn: config.endsOn,
      maxStakePies: config.maxStakePies,
    })
    .where(eq(trips.id, tripId))
    .returning();
  logger.info({ tripId, actorId }, "trip updated");
  return updated;
}

/** The live roster, in the order they joined. */
export async function membersOf(tripId: string): Promise<(Member & { role: MembershipRole })[]> {
  const rows = await db
    .select({ member: members, role: memberships.role })
    .from(memberships)
    .innerJoin(members, eq(members.id, memberships.memberId))
    .where(and(eq(memberships.tripId, tripId), isNull(members.deletedAt)))
    .orderBy(asc(memberships.joinedAt));
  return rows.map((r) => ({ ...r.member, role: r.role }));
}

/**
 * Make somebody an organiser, or stop them being one. Organisers only, and
 * never down to none: a trip with no organiser is one nobody can be invited
 * to and no lost passkey can be recovered from. The rows are locked for the
 * check, so two people demoting each other at once cannot both pass it.
 */
export async function setRole(
  actorId: string,
  tripId: string,
  memberId: string,
  role: MembershipRole,
): Promise<void> {
  await requireOrganiser(tripId, actorId);
  await db.transaction(async (tx) => {
    const organisers = await tx
      .select({ memberId: memberships.memberId })
      .from(memberships)
      .where(and(eq(memberships.tripId, tripId), eq(memberships.role, "organiser")))
      .for("update");
    if (
      role === "member" &&
      organisers.length <= 1 &&
      organisers.some((o) => o.memberId === memberId)
    ) {
      throw new DataError(
        "Someone has to be able to invite. Make another member an organiser first.",
      );
    }
    const updated = await tx
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.tripId, tripId), eq(memberships.memberId, memberId)))
      .returning({ memberId: memberships.memberId });
    if (updated.length === 0) throw new DataError("No such member on this trip.");
    logger.warn({ actorId, tripId, memberId, role }, "role changed");
  });
}

// ---------- accounts ----------

/**
 * Called on every Google sign-in. Returns the member, creating them on first
 * arrival. There is no allowlist any more: anyone can make an account, and
 * an account is nothing until a trip has it. There is no starting grant:
 * every member has an infinite bank, and their number is lifetime net.
 */
export async function ensureMember(
  email: string,
  name: string | null,
  opts?: { termsAccepted?: boolean },
): Promise<{ member: Member; created: boolean }> {
  const normalized = normalizeEmail(email);
  const [existing] = await db.select().from(members).where(eq(members.email, normalized));
  if (existing) {
    if (existing.deletedAt) throw new DataError("That account was deleted.");
    return { member: existing, created: false };
  }

  try {
    const [created] = await db
      .insert(members)
      .values({
        id: randomUUID(),
        email: normalized,
        name: name ?? normalized,
        termsAcceptedAt: opts?.termsAccepted ? new Date() : null,
      })
      .returning();
    logger.info({ memberId: created.id }, "member joined");
    return { member: created, created: true };
  } catch {
    // Concurrent first sign-in: the unique email constraint fired; re-read.
    logger.debug({ email: normalized }, "concurrent first sign-in, re-reading member");
    const [raced] = await db.select().from(members).where(eq(members.email, normalized));
    if (!raced) throw new DataError("Something went wrong signing you in. Try again.");
    return { member: raced, created: false };
  }
}

function checkName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new DataError("Pick a name with at least two characters.");
  if (name.length > 40) throw new DataError("Keep the name under 40 characters.");
  return name;
}

/**
 * An account from nothing but a passkey: for whoever starts a trip without
 * a Google account. The member id was minted at step one of the ceremony and
 * carried in the sealed challenge (lib/auth.ts), so the key and the row agree.
 */
export async function createAccount(input: {
  memberId: string;
  name: string;
  lingo?: string;
  credential: VerifiedRegistration;
}): Promise<Member> {
  const name = checkName(input.name);
  return db.transaction(async (tx) => {
    const [member] = await tx
      .insert(members)
      .values({
        id: input.memberId,
        email: null,
        name,
        lingo: input.lingo ?? "english",
        termsAcceptedAt: new Date(),
      })
      .returning();
    await tx.insert(credentials).values(credentialRow(member.id, input.credential));
    logger.info({ memberId: member.id }, "account created with a passkey");
    return member;
  });
}

export async function acceptTerms(memberId: string): Promise<void> {
  await db
    .update(members)
    .set({ termsAcceptedAt: new Date() })
    .where(and(eq(members.id, memberId), isNull(members.termsAcceptedAt)));
}

export async function setName(memberId: string, raw: string): Promise<void> {
  const name = checkName(raw);
  // Names are how @mentions find people (lib/mentions.ts), so they have to be
  // distinct on every trip this member shares a table with.
  const mine = await db
    .select({ tripId: memberships.tripId })
    .from(memberships)
    .where(eq(memberships.memberId, memberId));
  if (mine.length > 0) {
    const [clash] = await db
      .select({ id: members.id })
      .from(memberships)
      .innerJoin(members, eq(members.id, memberships.memberId))
      .where(
        and(
          inArray(
            memberships.tripId,
            mine.map((m) => m.tripId),
          ),
          sql`lower(${members.name}) = lower(${name})`,
          sql`${members.id} <> ${memberId}`,
        ),
      )
      .limit(1);
    if (clash) throw new DataError("Someone on one of your trips already goes by that name.");
  }
  await db.update(members).set({ name }).where(eq(members.id, memberId));
  logger.info({ memberId }, "member renamed");
}

/**
 * Delete an account. The row stays — the ledger, bills, and comments it is
 * named on are append-only, and a payout to a departed member is still a
 * payout — but everything that identified them goes in one transaction:
 * name, address, picture, passkeys, seats, kept phrases, reactions, and the
 * view log. Nothing signs in as them again.
 */
export async function deleteAccount(memberId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(credentials).where(eq(credentials.memberId, memberId));
    await tx.delete(avatars).where(eq(avatars.memberId, memberId));
    await tx.delete(phrases).where(eq(phrases.memberId, memberId));
    await tx.delete(marketReactions).where(eq(marketReactions.memberId, memberId));
    await tx.delete(marketViews).where(eq(marketViews.memberId, memberId));
    await tx.delete(recoveries).where(eq(recoveries.memberId, memberId));
    await tx.delete(memberships).where(eq(memberships.memberId, memberId));
    await tx
      .update(members)
      .set({
        name: "Departed member",
        email: null,
        image: null,
        lingo: "english",
        avatarUpdatedAt: null,
        deletedAt: new Date(),
      })
      .where(eq(members.id, memberId));
  });
  logger.warn({ memberId }, "account deleted");
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

/** The row a verified registration becomes, shared by "add" and "join". */
function credentialRow(memberId: string, credential: VerifiedRegistration) {
  return {
    id: credential.credentialId,
    memberId,
    publicKey: credential.publicKey,
    alg: credential.alg,
    signCount: credential.signCount,
    backedUp: credential.backedUp,
  };
}

export async function addCredential(
  memberId: string,
  credential: VerifiedRegistration,
): Promise<void> {
  await db.insert(credentials).values(credentialRow(memberId, credential));
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
 * Drop one of your own passkeys — unless it is the only way you can still get
 * in. A member who joined by link has no address, so no Google sign-in to
 * fall back on, and removing their last credential would leave them needing
 * an organiser to mint them a recovery link to undo one click.
 */
export async function removeCredential(memberId: string, id: string): Promise<void> {
  const member = await getMember(memberId);
  if (member && member.email == null) {
    const held = await listCredentials(memberId);
    if (held.length <= 1) {
      throw new DataError("That's your only way in. Add another passkey before removing this one.");
    }
  }
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

/** Who on the trip holds at least one passkey. */
export async function passkeyHolders(tripId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ memberId: credentials.memberId })
    .from(credentials)
    .innerJoin(memberships, eq(memberships.memberId, credentials.memberId))
    .where(eq(memberships.tripId, tripId));
  return new Set(rows.map((r) => r.memberId));
}

/** What the passkey manager renders. Key material never leaves this module. */
export async function listPasskeySummaries(memberId: string) {
  const held = await listCredentials(memberId);
  return held.map((c) => ({
    id: c.id,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
    backedUp: c.backedUp,
  }));
}

/** A member by id — null once they have deleted their account. */
export async function getMember(id: string): Promise<Member | null> {
  const [m] = await db.select().from(members).where(eq(members.id, id));
  return m && !m.deletedAt ? m : null;
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

/** Drop the uploaded picture; the member falls back to their monogram. */
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
 * Mint a link for someone to join a trip with — personal by default, or an
 * open one the whole group can use. Returns the code, which is also stored,
 * so the organiser can copy the same link again later.
 */
export async function mintInvite(
  tripId: string,
  inviterId: string,
  label: string,
  opts?: { isOpen?: boolean },
): Promise<string> {
  await requireOrganiser(tripId, inviterId);
  const trimmed = label.trim();
  if (!trimmed) throw new DataError("Say who the invite is for.");
  if (trimmed.length > 40) throw new DataError("Keep the name under 40 characters.");

  const isOpen = opts?.isOpen ?? false;
  const code = newInviteCode();
  await db.insert(invites).values({
    code,
    tripId,
    label: trimmed,
    isOpen,
    invitedBy: inviterId,
    expiresAt: expiresAtFrom(new Date(), isOpen),
  });
  logger.info({ tripId, invitedBy: inviterId, label: trimmed, isOpen }, "invite link minted");
  return code;
}

export async function listInvites(tripId: string): Promise<InviteRow[]> {
  return db
    .select()
    .from(invites)
    .where(eq(invites.tripId, tripId))
    .orderBy(desc(invites.createdAt));
}

/** Look an invite up by the code from a link. Callers check its state. */
export async function findInvite(code: string): Promise<InviteRow | null> {
  const [row] = await db.select().from(invites).where(eq(invites.code, code));
  return row ?? null;
}

export async function revokeInvite(actorId: string, code: string): Promise<void> {
  const invite = await findInvite(code);
  if (!invite) return;
  await requireOrganiser(invite.tripId, actorId);
  // Spent personal invites stay on the record. An open link is shut whether or
  // not anyone has walked through it — that is the point of the button.
  await db
    .delete(invites)
    .where(and(eq(invites.code, code), or(eq(invites.useCount, 0), eq(invites.isOpen, true))));
  logger.info({ actorId, tripId: invite.tripId }, "invite link revoked");
}

/**
 * What somebody holding a link sees before they decide: the trip, how many
 * are on it, and a taste of the board. Public by design — the link is the
 * invitation, and seeing the table is what makes people sit down at it.
 */
export interface TripPreview {
  trip: Trip;
  memberCount: number;
  organiser: Member | null;
  /** Open questions, newest first, capped. */
  questions: string[];
  names: string[];
}

export async function tripPreview(tripId: string): Promise<TripPreview | null> {
  const trip = await getTrip(tripId);
  if (!trip) return null;
  const roster = await membersOf(tripId);
  const open = await db
    .select({ question: markets.question })
    .from(markets)
    .where(and(eq(markets.tripId, tripId), eq(markets.status, "open")))
    .orderBy(desc(markets.createdAt))
    .limit(4);
  return {
    trip,
    memberCount: roster.length,
    organiser: roster.find((m) => m.role === "organiser") ?? roster[0] ?? null,
    questions: open.map((m) => m.question),
    names: roster.slice(0, 6).map((m) => m.name),
  };
}

/** Everyone on a trip, and the name rule: distinct, case-insensitively. */
async function requireDistinctName(tx: Tx, tripId: string, name: string, exceptId?: string) {
  const [clash] = await tx
    .select({ id: members.id })
    .from(memberships)
    .innerJoin(members, eq(members.id, memberships.memberId))
    .where(
      and(
        eq(memberships.tripId, tripId),
        sql`lower(${members.name}) = lower(${name})`,
        exceptId ? sql`${members.id} <> ${exceptId}` : undefined,
      ),
    );
  if (clash) throw new DataError("Someone on this trip already goes by that name.");
}

/** Spend a link inside a transaction: checked live, row locked, count bumped. */
async function spendInvite(tx: Tx, code: string): Promise<InviteRow> {
  const [invite] = await tx.select().from(invites).where(eq(invites.code, code)).for("update");
  if (!invite) throw new DataError("That invite link isn't valid.");
  if (inviteState(invite, new Date()) !== "live") {
    throw new DataError("That invite link has already been used or has expired.");
  }
  // useCount is what spends a personal link; an open one just keeps count.
  await tx
    .update(invites)
    .set({ useCount: invite.useCount + 1 })
    .where(eq(invites.code, code));
  return invite;
}

/**
 * Accept an invite as somebody new: create the member, store the passkey that
 * just proved itself, seat them, and spend the link — one transaction, so two
 * people opening the same link race safely and exactly one of them ends up
 * at the table.
 */
export async function joinWithInvite(input: {
  code: string;
  memberId: string;
  name: string;
  /** Chosen at sign-up; the column default (english) covers the rest. */
  lingo?: string;
  credential: VerifiedRegistration;
}): Promise<{ member: Member; tripId: string }> {
  const name = checkName(input.name);
  return db.transaction(async (tx) => {
    const invite = await spendInvite(tx, input.code);
    await requireDistinctName(tx, invite.tripId, name);
    const [member] = await tx
      .insert(members)
      .values({
        id: input.memberId,
        email: null,
        name,
        lingo: input.lingo ?? "english",
        termsAcceptedAt: new Date(),
      })
      .returning();
    await tx.insert(credentials).values(credentialRow(member.id, input.credential));
    await tx.insert(memberships).values({
      tripId: invite.tripId,
      memberId: member.id,
      invitedWith: invite.code,
    });
    logger.info(
      { memberId: member.id, tripId: invite.tripId, invitedBy: invite.invitedBy },
      "member joined by invite",
    );
    return { member, tripId: invite.tripId };
  });
}

/**
 * Accept an invite as somebody who already has an account — a member of one
 * trip opening the link to another. Seats them and spends the link; opening
 * a link to a trip they are already on costs nothing and spends nothing.
 */
export async function joinTripWithInvite(memberId: string, code: string): Promise<string> {
  const member = await getMember(memberId);
  if (!member) throw new DataError("Sign in first.");
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(invites).where(eq(invites.code, code)).for("update");
    if (!invite) throw new DataError("That invite link isn't valid.");
    const already = await tx
      .select({ tripId: memberships.tripId })
      .from(memberships)
      .where(and(eq(memberships.tripId, invite.tripId), eq(memberships.memberId, memberId)));
    if (already.length > 0) return invite.tripId;
    await spendInvite(tx, code);
    await requireDistinctName(tx, invite.tripId, member.name);
    await tx.insert(memberships).values({
      tripId: invite.tripId,
      memberId,
      invitedWith: invite.code,
    });
    logger.info({ memberId, tripId: invite.tripId }, "member joined another trip by invite");
    return invite.tripId;
  });
}

// ---------- recovery links ----------
//
// The way back to a seat, for a member who has lost every passkey they held.
// Everything here is deliberately narrower than the invite equivalent above,
// because the link is worth incomparably more: it does not create a member, it
// *becomes* one. See lib/recovery.ts for the reasoning; what this file adds is
// that nothing is ever done quietly — every mint, revoke, and use is a warn,
// and listRecoveries() feeds a notice every member of the trip can read.

/** Whose seat, who vouched, and what the table is told about it. */
export interface RecoveryView {
  row: RecoveryRow;
  member: Member;
  /** Null when it came from the console rather than from an organiser. */
  mintedBy: Member | null;
}

/** Whether `actorId` organises a trip that `memberId` is on. */
async function organisesWith(actorId: string, memberId: string): Promise<boolean> {
  const [row] = await db
    .select({ tripId: memberships.tripId })
    .from(memberships)
    .where(
      and(
        eq(memberships.memberId, actorId),
        eq(memberships.role, "organiser"),
        inArray(
          memberships.tripId,
          db
            .select({ tripId: memberships.tripId })
            .from(memberships)
            .where(eq(memberships.memberId, memberId)),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function createRecovery(memberId: string, mintedBy: string | null): Promise<string> {
  const member = await getMember(memberId);
  if (!member) throw new DataError("No such member.");

  const code = newRecoveryCode();
  const now = new Date();
  await db.transaction(async (tx) => {
    // One live link per member: minting a second shuts the first, so there is
    // never more than one key to the same seat in flight. Unused links that
    // simply ran out go at the same time — nobody came, so nothing is lost.
    await tx
      .delete(recoveries)
      .where(
        and(
          isNull(recoveries.usedAt),
          or(eq(recoveries.memberId, memberId), lte(recoveries.expiresAt, now)),
        ),
      );
    await tx.insert(recoveries).values({
      code,
      memberId,
      mintedBy,
      expiresAt: recoveryExpiresAt(now),
    });
  });
  // Warn, not info: this is the one action in the app that hands one member's
  // account to whoever is holding a URL.
  logger.warn({ memberId, mintedBy }, "recovery link minted");
  return code;
}

/**
 * Mint a link that lets someone add a passkey to `memberId`'s seat. An
 * organiser of a trip they share, and the real check is the one the code
 * cannot make: that the organiser knows, out of band, who they are talking to.
 */
export async function mintRecovery(actorId: string, memberId: string): Promise<string> {
  if (!(await organisesWith(actorId, memberId))) {
    throw new DataError("Only an organiser of a trip they're on can mint a recovery link.");
  }
  return createRecovery(memberId, actorId);
}

/**
 * The failsafe, and the only path that skips the organiser check: for when no
 * organiser can sign in either. Reachable exclusively from
 * scripts/recovery-link.ts — whoever runs it already holds DATABASE_URL and
 * could write the credentials row by hand, so this grants nothing new; it
 * only makes it survivable. Never call it from a server action.
 */
export async function mintRecoveryFromConsole(memberId: string): Promise<string> {
  return createRecovery(memberId, null);
}

/** Look a recovery link up by its code. Callers check its state. */
export async function findRecovery(code: string): Promise<RecoveryRow | null> {
  const [row] = await db.select().from(recoveries).where(eq(recoveries.code, code));
  return row ?? null;
}

/**
 * What a trip's members page announces: links still open for anyone on the
 * trip, and ones walked through in the last week. Read by every member, not
 * just organisers — being seen is the check on this whole mechanism.
 */
export async function listRecoveries(
  tripId: string,
): Promise<{ live: RecoveryView[]; used: RecoveryView[] }> {
  const memberById = await membersById(tripId);
  if (memberById.size === 0) return { live: [], used: [] };
  const rows = await db
    .select()
    .from(recoveries)
    .where(inArray(recoveries.memberId, [...memberById.keys()]))
    .orderBy(desc(recoveries.createdAt));
  const { live, used } = visibleRecoveries(rows, new Date());
  const view = (row: RecoveryRow): RecoveryView | null => {
    const member = memberById.get(row.memberId);
    return member ? { row, member, mintedBy: memberById.get(row.mintedBy ?? "") ?? null } : null;
  };
  return {
    live: live.map(view).filter((v) => v != null),
    used: used.map(view).filter((v) => v != null),
  };
}

/**
 * Shut a live link. An organiser who shares a trip can, and so can the member
 * it names — if a link is minted for your seat and you never asked for one,
 * you are the person who most needs to be able to stop it.
 */
export async function revokeRecovery(actorId: string, code: string): Promise<void> {
  const row = await findRecovery(code);
  if (!row) return;
  if (actorId !== row.memberId && !(await organisesWith(actorId, row.memberId))) {
    throw new DataError("Only an organiser, or whoever the link is for, can shut it.");
  }
  await db.delete(recoveries).where(and(eq(recoveries.code, code), isNull(recoveries.usedAt)));
  logger.warn({ actorId, memberId: row.memberId }, "recovery link shut");
}

/**
 * Walk through a recovery link: attach the passkey that just proved itself to
 * the seat the link names, and spend the link — one transaction with the row
 * locked, so two people holding the same URL cannot both come through.
 *
 * Existing passkeys are deliberately left alone. If the member still holds a
 * working one, they keep it, they see the new arrival on their own page, and
 * they can remove it — which is the difference between a recovery and a
 * takeover being undoable.
 */
export async function recoverWithLink(input: {
  code: string;
  memberId: string;
  credential: VerifiedRegistration;
}): Promise<Member> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(recoveries)
      .where(eq(recoveries.code, input.code))
      .for("update");
    if (!row) throw new DataError("That recovery link isn't valid.");
    if (recoveryState(row, new Date()) !== "live") {
      throw new DataError("That recovery link has already been used or has expired.");
    }
    // The ceremony was started for one seat; the row has to still name it.
    if (row.memberId !== input.memberId) {
      throw new DataError("That recovery link isn't valid.");
    }

    const [member] = await tx.select().from(members).where(eq(members.id, row.memberId));
    if (!member || member.deletedAt) throw new DataError("That seat is gone.");

    await tx.insert(credentials).values(credentialRow(member.id, input.credential));
    await tx.update(recoveries).set({ usedAt: new Date() }).where(eq(recoveries.code, input.code));

    logger.warn(
      { memberId: member.id, mintedBy: row.mintedBy },
      "seat recovered — a new passkey was added through a recovery link",
    );
    return member;
  });
}

// ---------- markets: reads ----------

function buildView(
  market: Market,
  rows: LedgerRow[],
  memberById: Map<string, Member>,
  viewerId: string,
  reactions: MarketReactionRow[],
  commentCount: number,
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
    upvotes: reactions.filter((r) => r.kind === "upvote").length,
    watchers: reactions.filter((r) => r.kind === "watch").length,
    commentCount,
  };
}

export async function listMarkets(
  tripId: string,
  viewerId: string,
): Promise<{
  open: MarketView[];
  resolved: MarketView[];
  /** Open markets the viewer hasn't joined, ranked by lib/recommend. */
  forYou: MarketView[];
}> {
  const all = await db
    .select()
    .from(markets)
    .where(eq(markets.tripId, tripId))
    .orderBy(desc(markets.createdAt));
  const memberById = await membersById(tripId);
  const rowsByMarket = await marketLedger(all.map((m) => m.id));
  const reactions = await reactionsByMarket(all.map((m) => m.id));
  const commentCounts = await commentCountByMarket(all.map((m) => m.id));
  const views = all.map((m) =>
    buildView(
      m,
      rowsByMarket.get(m.id) ?? [],
      memberById,
      viewerId,
      reactions.get(m.id) ?? [],
      commentCounts.get(m.id) ?? 0,
    ),
  );
  const open = views.filter((v) => v.market.status === "open");
  const resolved = views
    .filter((v) => v.market.status !== "open")
    .sort((a, b) => (b.market.resolvedAt?.getTime() ?? 0) - (a.market.resolvedAt?.getTime() ?? 0));
  const forYou = await recommendFor(viewerId, open, all, rowsByMarket, reactions);
  return { open, resolved, forYou };
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
  reactions: Map<string, MarketReactionRow[]>,
): Promise<MarketView[]> {
  const viewed = await db
    .select({ marketId: marketViews.marketId })
    .from(marketViews)
    .where(eq(marketViews.memberId, viewerId));

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
  }).map((rec) => viewById.get(rec.marketId)!);
}

export async function getMarket(marketId: string): Promise<Market | null> {
  const [market] = await db.select().from(markets).where(eq(markets.id, marketId));
  return market ?? null;
}

export async function getMarketView(
  marketId: string,
  viewerId: string,
): Promise<{
  trip: Trip;
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
  const market = await getMarket(marketId);
  if (!market) return null;
  const ctx = await tripFor(viewerId, market.tripId);
  if (!ctx) return null;
  const memberById = await membersById(market.tripId);
  const rows = (await marketLedger([marketId])).get(marketId) ?? [];
  const commentRows = await db
    .select()
    .from(comments)
    .where(eq(comments.marketId, marketId))
    .orderBy(asc(comments.id));
  const reacted = (await reactionsByMarket([marketId])).get(marketId) ?? [];
  const view = buildView(market, rows, memberById, viewerId, reacted, commentRows.length);
  const items: ActivityItem[] = rows.map((row) => ({
    row,
    member: memberById.get(row.memberId)!,
    market,
  }));
  const [seen] = await db
    .select({ seenBy: sql<number>`count(distinct ${marketViews.memberId})::int` })
    .from(marketViews)
    .where(eq(marketViews.marketId, marketId));
  const reactors = (kind: ReactionKind) =>
    reacted
      .filter((r) => r.kind === kind)
      .map((r) => memberById.get(r.memberId))
      .filter((m): m is Member => !!m);
  return {
    trip: ctx.trip,
    view,
    activity: items.filter((i) => i.row.kind === "bet" || i.row.kind === "switch").reverse(),
    // Only the settlement that stands: anything before the last reopen was
    // handed back and is no longer where the pool went.
    settlements: items
      .slice(items.findLastIndex((i) => i.row.kind === "reversal") + 1)
      .filter((i) => i.row.kind === "payout" || i.row.kind === "refund"),
    comments: await toCommentViews(commentRows, memberById),
    seenBy: seen.seenBy,
    upvoters: reactors("upvote"),
    watchers: reactors("watch"),
  };
}

/**
 * The public face of one resolved prediction — what a member shares to the
 * group chat. Question, verdict, who called it and what they took home.
 * Reachable by URL alone, so it carries first names and pies and nothing
 * else; the trip stays private.
 */
export interface MarketCard {
  trip: { id: string; name: string; destination: string };
  question: string;
  status: Market["status"];
  resolvedAt: Date | null;
  poolC: number;
  winners: { name: string; profitC: number }[];
  losers: { name: string; profitC: number }[];
}

export async function marketCard(marketId: string): Promise<MarketCard | null> {
  const market = await getMarket(marketId);
  if (!market) return null;
  const trip = await getTrip(market.tripId);
  if (!trip) return null;
  const memberById = await membersById(market.tripId);
  const rows = (await marketLedger([marketId])).get(marketId) ?? [];
  const outcomes = marketOutcomes(rows);
  const lines = [...outcomes]
    .map(([memberId, o]) => ({
      name: memberById.get(memberId)?.name ?? "Someone",
      profitC: toResult(market, o).profitC,
      noContest: toResult(market, o).noContest,
    }))
    .filter((l) => !l.noContest || market.status === "open");
  return {
    trip: { id: trip.id, name: trip.name, destination: trip.destination },
    question: market.question,
    status: market.status,
    resolvedAt: market.resolvedAt,
    poolC: [...outcomes.values()].reduce((s, o) => s + o.stakeC, 0),
    winners: lines.filter((l) => l.profitC > 0).sort((a, b) => b.profitC - a.profitC),
    losers: lines.filter((l) => l.profitC < 0).sort((a, b) => a.profitC - b.profitC),
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
  const market = await getMarket(marketId);
  if (!market) throw new DataError("Prediction not found.");
  await requireMembership(market.tripId, memberId);
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

export async function recentActivity(tripId: string, limit = 12): Promise<ActivityItem[]> {
  const rows = await db
    .select()
    .from(ledger)
    .where(
      and(
        eq(ledger.tripId, tripId),
        inArray(ledger.kind, ["bet", "switch", "payout", "refund", "reversal"]),
      ),
    )
    .orderBy(desc(ledger.id))
    .limit(limit);
  const memberById = await membersById(tripId);
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
  tripId: string,
  creatorId: string,
  question: string,
  criteria: string,
): Promise<string> {
  await requireMembership(tripId, creatorId);
  const q = question.trim();
  const c = criteria.trim();
  if (q.length < 5) throw new DataError("Give the prediction a real question.");
  if (q.length > 200) throw new DataError("Keep the question under 200 characters.");
  if (c.length < 5) {
    throw new DataError("Spell out how this will be resolved — future-you will thank you.");
  }
  if (c.length > 2000) throw new DataError("Keep resolution criteria under 2000 characters.");
  const id = randomUUID();
  await db.insert(markets).values({ id, tripId, creatorId, question: q, criteria: c });
  logger.info({ marketId: id, tripId, creatorId }, "market created");
  return id;
}

export async function placeBet(
  memberId: string,
  marketId: string,
  side: Side,
  pies: number,
): Promise<void> {
  if (!Number.isInteger(pies) || pies < 1) {
    throw new DataError("A call must be a whole number of pies, at least 1.");
  }
  const amountC = toCents(pies);

  await db.transaction(async (tx) => {
    const market = await lockMarket(tx, marketId);
    requireOpen(market);
    const { trip } = await requireMembership(market.tripId, memberId);
    const maxC = toCents(trip.maxStakePies);
    const pos = replay(await stakeRows(tx, marketId)).get(memberId) ?? { yesC: 0, noC: 0 };

    const oppStakeC = side === "yes" ? pos.noC : pos.yesC;
    if (oppStakeC > 0) {
      throw new DataError("You're on the other side of this one. Switch sides first.");
    }
    if (exposure(pos) + amountC > maxC) {
      throw new DataError(`Max exposure is ${trip.maxStakePies} pies per prediction.`);
    }
    // No balance check: members have an infinite bank. Net can go negative;
    // the per-market exposure cap is the only brake.

    await tx.insert(ledger).values({
      tripId: market.tripId,
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
    const market = await lockMarket(tx, marketId);
    requireOpen(market);
    const pos = replay(await stakeRows(tx, marketId)).get(memberId);
    const stakeC = pos ? exposure(pos) : 0;
    if (!pos || stakeC === 0) throw new DataError("You have no call to switch.");

    const from: Side = pos.yesC > 0 ? "yes" : "no";
    await tx.insert(ledger).values({
      tripId: market.tripId,
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
    const tripId = market.tripId;

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
          tripId,
          memberId: mid,
          marketId,
          kind: "refund",
          amountC,
          balanceDeltaC: amountC,
          note: "Prediction voided — pies returned",
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
          "Nobody held the winning side, so all pies were returned.",
        ]
          .filter(Boolean)
          .join(" ");
        for (const [mid, amountC] of result.payoutsC) {
          await tx.insert(ledger).values({
            tripId,
            memberId: mid,
            marketId,
            kind: "refund",
            amountC,
            balanceDeltaC: amountC,
            note: "Winning side was empty — pies returned",
          });
        }
      } else {
        for (const [mid, amountC] of result.payoutsC) {
          await tx.insert(ledger).values({
            tripId,
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

/**
 * Take a resolution back, so the table can settle it again.
 *
 * Resolving is the creator's call, but a wrong call is everybody's problem and
 * the creator is often the one who got it wrong — so this is an organiser's,
 * the same hands that invite and recover. Nothing is deleted: the payouts and
 * refunds are handed in as `reversal` rows, which is what leaves the ledger
 * append-only and the trail readable. Stakes are never touched — the bet and
 * switch rows still replay to the same positions — so whoever backed what
 * still backs it, and re-resolving pays the same pool out to whoever is right
 * this time. Like a recovery link, reopening is loud: it goes in the log.
 */
export async function reopenMarket(marketId: string, actorId: string): Promise<void> {
  let handedBack = { rows: 0, totalC: 0 };
  let wasStatus = "";
  await db.transaction(async (tx) => {
    const market = await lockMarket(tx, marketId);
    await requireOrganiser(market.tripId, actorId);
    if (market.status === "open") throw new DataError("This prediction is already open.");
    wasStatus = market.status;

    // What each member is still holding from the resolution: everything paid
    // out or refunded, less whatever an earlier reopen already took back.
    const rows = await tx
      .select()
      .from(ledger)
      .where(
        and(eq(ledger.marketId, marketId), inArray(ledger.kind, ["payout", "refund", "reversal"])),
      )
      .orderBy(asc(ledger.id));
    const outstanding = new Map<string, number>();
    for (const row of rows) {
      const delta = row.kind === "reversal" ? -row.amountC : row.amountC;
      outstanding.set(row.memberId, (outstanding.get(row.memberId) ?? 0) + delta);
    }

    for (const [memberId, amountC] of outstanding) {
      if (amountC === 0) continue;
      await tx.insert(ledger).values({
        tripId: market.tripId,
        memberId,
        marketId,
        kind: "reversal",
        amountC,
        balanceDeltaC: -amountC,
        note: "Resolution reopened — settlement handed back",
      });
      handedBack = { rows: handedBack.rows + 1, totalC: handedBack.totalC + amountC };
    }

    await tx
      .update(markets)
      .set({ status: "open", resolvedAt: null, resolutionNote: null })
      .where(eq(markets.id, marketId));
  });
  logger.warn(
    {
      marketId,
      actorId,
      wasStatus,
      ledgerRows: handedBack.rows,
      handedBackC: handedBack.totalC,
    },
    "market reopened",
  );
}

// ---------- member accounting ----------

export async function netOf(tripId: string, memberId: string): Promise<number> {
  const [row] = await db
    .select({ bal: sql<number>`coalesce(sum(${ledger.balanceDeltaC}), 0)::int` })
    .from(ledger)
    .where(and(eq(ledger.tripId, tripId), eq(ledger.memberId, memberId)));
  return row.bal;
}

export async function memberLedger(tripId: string, memberId: string): Promise<ActivityItem[]> {
  const rows = await db
    .select()
    .from(ledger)
    .where(and(eq(ledger.tripId, tripId), eq(ledger.memberId, memberId)))
    .orderBy(desc(ledger.id));
  const memberById = await membersById(tripId);
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
export async function memberResults(tripId: string, memberId: string): Promise<MarketResult[]> {
  const resolved = await db
    .select()
    .from(markets)
    .where(and(eq(markets.tripId, tripId), inArray(markets.status, ["yes", "no", "refunded"])))
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

export async function leaderboard(
  tripId: string,
): Promise<{ ranked: MemberStats[]; unranked: MemberStats[] }> {
  const roster = await membersOf(tripId);
  const stats = new Map<string, MemberStats>(
    roster.map((m) => [
      m.id,
      {
        member: m,
        role: m.role,
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
    .where(eq(ledger.tripId, tripId))
    .groupBy(ledger.memberId);
  for (const b of balances) {
    const s = stats.get(b.memberId);
    if (s) s.netC = b.bal;
  }

  const allMarkets = await db.select().from(markets).where(eq(markets.tripId, tripId));
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

/**
 * The season in one read: the table, the rivalries, the biggest swings, and
 * how many claims were settled. What the recap page and its share card show.
 */
export interface TripRecap {
  trip: Trip;
  table: MemberStats[];
  rivalries: Rivalry[];
  biggestWin: (Superlative & { member: Member; market: Market }) | null;
  biggestLoss: (Superlative & { member: Member; market: Market }) | null;
  resolvedCount: number;
  openCount: number;
  totalPoolC: number;
  memberById: Map<string, Member>;
}

export async function tripRecap(tripId: string): Promise<TripRecap | null> {
  const trip = await getTrip(tripId);
  if (!trip) return null;
  const [{ ranked, unranked }, memberById] = await Promise.all([
    leaderboard(tripId),
    membersById(tripId),
  ]);
  const allMarkets = await db.select().from(markets).where(eq(markets.tripId, tripId));
  const rowsByMarket = await marketLedger(allMarkets.map((m) => m.id));
  const marketById = new Map(allMarkets.map((m) => [m.id, m]));

  const perMarket = allMarkets
    .filter((m) => m.status !== "open")
    .map((m) => ({ status: m.status, outcomes: marketOutcomes(rowsByMarket.get(m.id) ?? []) }));
  const results = allMarkets
    .filter((m) => m.status !== "open")
    .flatMap((m) =>
      [...marketOutcomes(rowsByMarket.get(m.id) ?? [])].map(([memberId, o]) => ({
        memberId,
        result: toResult(m, o),
      })),
    );
  const { biggestWin, biggestLoss } = superlatives(results);
  const dress = (s: Superlative | null) =>
    s && memberById.get(s.memberId) && marketById.get(s.marketId)
      ? { ...s, member: memberById.get(s.memberId)!, market: marketById.get(s.marketId)! }
      : null;
  let totalPoolC = 0;
  for (const { outcomes } of perMarket) {
    for (const o of outcomes.values()) totalPoolC += o.stakeC;
  }
  return {
    trip,
    table: [...ranked, ...unranked].sort((a, b) => b.profitC - a.profitC || b.netC - a.netC),
    rivalries: rivalries(perMarket),
    biggestWin: dress(biggestWin),
    biggestLoss: dress(biggestLoss),
    resolvedCount: perMarket.filter((m) => m.status !== "refunded").length,
    openCount: allMarkets.length - perMarket.length,
    totalPoolC,
    memberById,
  };
}

// ---------- inbox ----------
// Derived, not stored: "what happened that concerns me" is computed from
// markets + ledger. Read state is a single per-membership timestamp cursor.

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
      actor: Member;
      commentId: number;
      body: string;
      /** Where the talk is: exactly one of these is set. */
      market: Market | null;
      bill: { id: string; label: string } | null;
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
  tripId: string,
  memberId: string,
  limit = 50,
): Promise<{ items: InboxItem[]; unreadCount: number }> {
  const ctx = await tripFor(memberId, tripId);
  if (!ctx) return { items: [], unreadCount: 0 };
  const seenAt = ctx.membership.inboxSeenAt?.getTime() ?? 0;

  const memberById = await membersById(tripId);
  const allMarkets = await db.select().from(markets).where(eq(markets.tripId, tripId));
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
  const watching = allMarkets.length
    ? await db
        .select({ marketId: marketReactions.marketId })
        .from(marketReactions)
        .where(
          and(
            eq(marketReactions.memberId, memberId),
            eq(marketReactions.kind, "watch"),
            inArray(
              marketReactions.marketId,
              allMarkets.map((m) => m.id),
            ),
          ),
        )
    : [];
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

  // Table talk: comments on predictions that concern me, comments anywhere
  // I've joined the thread myself, and — on predictions or bills — comments
  // that tag me. All derive straight from the comment and mention rows; a
  // comment that tags me shows once, as the mention.
  const tripBills = await db.select({ id: bills.id }).from(bills).where(eq(bills.tripId, tripId));
  const billIds = tripBills.map((b) => b.id);
  const marketIds = allMarkets.map((m) => m.id);
  const commentRows =
    marketIds.length || billIds.length
      ? await db
          .select()
          .from(comments)
          .where(
            or(
              marketIds.length ? inArray(comments.marketId, marketIds) : undefined,
              billIds.length ? inArray(comments.billId, billIds) : undefined,
            ),
          )
          .orderBy(asc(comments.id))
      : [];
  const myMentions = commentRows.length
    ? await db
        .select()
        .from(commentMentions)
        .where(
          and(
            eq(commentMentions.memberId, memberId),
            inArray(
              commentMentions.commentId,
              commentRows.map((c) => c.id),
            ),
          ),
        )
    : [];
  const taggedIn = new Set(myMentions.map((m) => m.commentId));
  const talkedMarkets = new Set<string>();
  const talkedBills = new Set<string>();
  for (const c of commentRows) {
    if (c.authorId !== memberId) continue;
    if (c.marketId) talkedMarkets.add(c.marketId);
    if (c.billId) talkedBills.add(c.billId);
  }
  const wantsBillLabel = commentRows.some(
    (c) => c.billId && c.authorId !== memberId && (taggedIn.has(c.id) || talkedBills.has(c.billId)),
  );
  const billLabelById = wantsBillLabel ? await billLabels(tripId) : new Map<string, string>();
  const billOf = (billId: string) => ({ id: billId, label: billLabelById.get(billId) ?? "a bill" });

  for (const c of commentRows) {
    if (c.authorId === memberId) continue;
    const actor = memberById.get(c.authorId);
    if (!actor) continue;
    const base = {
      at: c.at,
      unread: c.at.getTime() > seenAt,
      actor,
      commentId: c.id,
      body: c.body,
    };
    if (taggedIn.has(c.id)) {
      items.push({
        kind: "mention",
        ...base,
        market: c.marketId ? (marketById.get(c.marketId) ?? null) : null,
        bill: c.billId ? billOf(c.billId) : null,
      });
    } else if (c.marketId && (mine.has(c.marketId) || talkedMarkets.has(c.marketId))) {
      items.push({ kind: "comment", ...base, market: marketById.get(c.marketId)!, bill: null });
    } else if (c.billId && talkedBills.has(c.billId)) {
      items.push({ kind: "comment", ...base, market: null, bill: billOf(c.billId) });
    }
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  const trimmed = items.slice(0, limit);
  return {
    items: trimmed,
    unreadCount: items.filter((i) => i.unread).length,
  };
}

/** Whether anything is unread on any of the member's trips, for the header dot. */
export async function anyUnread(memberId: string): Promise<boolean> {
  const mine = await db
    .select({ tripId: memberships.tripId })
    .from(memberships)
    .where(eq(memberships.memberId, memberId));
  for (const { tripId } of mine) {
    const { unreadCount } = await inbox(tripId, memberId, 1);
    if (unreadCount > 0) return true;
  }
  return false;
}

export async function setLingo(memberId: string, lingo: string): Promise<void> {
  await db.update(members).set({ lingo }).where(eq(members.id, memberId));
}

export async function markInboxSeen(tripId: string, memberId: string): Promise<void> {
  await db
    .update(memberships)
    .set({ inboxSeenAt: new Date() })
    .where(and(eq(memberships.tripId, tripId), eq(memberships.memberId, memberId)));
}

// ---------- split bills ----------
// Real money, fully separate from the pie ledger. Bills are append-only
// revisions (see schema); the current state of a bill is its latest revision,
// and every balance below is derived by replay at read time. The pure math
// lives in lib/split.ts.

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

function requireBillInput(trip: Trip, input: BillInput): BillInput {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.onDate)) throw new DataError("Pick a date for the bill.");
  const description = input.description.trim();
  if ((input.kind ?? "expense") === "expense" && description.length === 0) {
    throw new DataError("Say what the bill was for.");
  }
  if (description.length > 200) throw new DataError("Keep the description under 200 characters.");
  // The trip decided its money when it was created; a bill in anything else
  // is a stale form, not a choice.
  if (!tripCurrencies(trip).includes(input.currency)) {
    throw new DataError("That currency isn't one this trip spends.");
  }
  return { ...input, description };
}

/** Latest revision per bill on a trip, oldest first; callers filter deleted ones. */
async function currentRevisions(tripId: string): Promise<{
  current: BillRevisionRow[];
  firstByBill: Map<string, BillRevisionRow>;
  revisionCount: Map<string, number>;
}> {
  const rows = await db
    .select({ rev: billRevisions })
    .from(billRevisions)
    .innerJoin(bills, eq(bills.id, billRevisions.billId))
    .where(eq(bills.tripId, tripId))
    .orderBy(asc(billRevisions.id));
  const latest = new Map<string, BillRevisionRow>();
  const firstByBill = new Map<string, BillRevisionRow>();
  const revisionCount = new Map<string, number>();
  for (const { rev: row } of rows) {
    latest.set(row.billId, row);
    if (!firstByBill.has(row.billId)) firstByBill.set(row.billId, row);
    revisionCount.set(row.billId, (revisionCount.get(row.billId) ?? 0) + 1);
  }
  return { current: [...latest.values()], firstByBill, revisionCount };
}

export async function billsOverview(tripId: string): Promise<BillsOverview> {
  const memberById = await membersById(tripId);
  const { current, firstByBill, revisionCount } = await currentRevisions(tripId);
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
      currency: rev.currency as Currency,
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
export async function memberSplit(tripId: string, memberId: string): Promise<MemberSplitView> {
  const { bills } = await billsOverview(tripId);
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
  trip: Trip,
  editorId: string,
  billId: string,
  input: BillInput,
  opts?: { deleted?: boolean },
): Promise<void> {
  const checked = requireBillInput(trip, input);
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
    if (!bill || bill.tripId !== trip.id) throw new DataError("Bill not found.");
    if (entryValues.length > 0) {
      // Every line names somebody at this table.
      const roster = await tx
        .select({ memberId: memberships.memberId })
        .from(memberships)
        .where(eq(memberships.tripId, trip.id));
      const seated = new Set(roster.map((r) => r.memberId));
      if (entryValues.some((e) => !seated.has(e.memberId))) {
        throw new DataError("Everyone on a bill has to be on the trip.");
      }
    }
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

export async function addBill(tripId: string, memberId: string, input: BillInput): Promise<string> {
  const { trip } = await requireMembership(tripId, memberId);
  const id = randomUUID();
  await db.insert(bills).values({ id, tripId });
  await appendRevision(trip, memberId, id, input);
  logger.info({ billId: id, tripId, memberId, kind: input.kind ?? "expense" }, "bill added");
  return id;
}

async function billTrip(billId: string, memberId: string): Promise<Trip> {
  const [bill] = await db.select().from(bills).where(eq(bills.id, billId));
  if (!bill) throw new DataError("Bill not found.");
  const { trip } = await requireMembership(bill.tripId, memberId);
  return trip;
}

/** Anyone on the trip can edit any bill; the revision trail keeps it honest. */
export async function editBill(memberId: string, billId: string, input: BillInput): Promise<void> {
  const trip = await billTrip(billId, memberId);
  await appendRevision(trip, memberId, billId, input);
  logger.info({ billId, memberId }, "bill edited");
}

export async function deleteBill(memberId: string, billId: string): Promise<void> {
  const trip = await billTrip(billId, memberId);
  const [last] = await db
    .select()
    .from(billRevisions)
    .where(eq(billRevisions.billId, billId))
    .orderBy(desc(billRevisions.id))
    .limit(1);
  if (!last) throw new DataError("Bill not found.");
  await appendRevision(
    trip,
    memberId,
    billId,
    {
      kind: last.kind,
      onDate: last.onDate,
      description: last.description,
      currency: last.currency as Currency,
      split: last.split,
      entries: [],
    },
    { deleted: true },
  );
  logger.info({ billId, memberId }, "bill deleted");
}

/** "X paid Y back" — recorded as a settlement bill so replay cancels the debt. */
export async function recordSettlement(
  tripId: string,
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
  return addBill(tripId, memberId, {
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
// in the body are resolved against the trip's names at write time
// (lib/mentions.ts) and snapshotted as comment_mentions rows. The inbox
// derives "you were tagged" from those rows at read time — comments store
// facts, never notifications.

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

/** Every bill's comments on a trip in one go, keyed by bill id, oldest first. */
export async function billComments(tripId: string): Promise<Record<string, CommentView[]>> {
  const rows = await db
    .select({ c: comments })
    .from(comments)
    .innerJoin(bills, eq(bills.id, comments.billId))
    .where(and(eq(bills.tripId, tripId), isNotNull(comments.billId)))
    .orderBy(asc(comments.id));
  const views = await toCommentViews(
    rows.map((r) => r.c),
    await membersById(tripId),
  );
  const byBill: Record<string, CommentView[]> = {};
  rows.forEach(({ c: row }, i) => {
    const list = byBill[row.billId!] ?? [];
    list.push(views[i]);
    byBill[row.billId!] = list;
  });
  return byBill;
}

/** Latest description per bill, for inbox lines about bill comments. */
async function billLabels(tripId: string): Promise<Map<string, string>> {
  const { current } = await currentRevisions(tripId);
  return new Map(current.map((rev) => [rev.billId, rev.description || "a payment"]));
}

export async function addComment(
  authorId: string,
  target: { marketId?: string; billId?: string },
  body: string,
): Promise<{ tripId: string }> {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new DataError("Write the comment first.");
  if (trimmed.length > 1000) throw new DataError("Keep the comment under 1000 characters.");
  const marketId = target.marketId ?? null;
  const billId = target.billId ?? null;
  let tripId: string;
  if (marketId) {
    const market = await getMarket(marketId);
    if (!market) throw new DataError("Prediction not found.");
    tripId = market.tripId;
  } else if (billId) {
    const [bill] = await db.select().from(bills).where(eq(bills.id, billId));
    if (!bill) throw new DataError("Bill not found.");
    tripId = bill.tripId;
  } else {
    throw new DataError("A comment goes on a prediction or a bill.");
  }
  await requireMembership(tripId, authorId);
  const mentionIds = parseMentions(trimmed, await membersOf(tripId));
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
  return { tripId };
}

// ---------- kept phrases ----------
// The trip's phrasebook: a phrase one member kept is there for the whole
// table to play, because "we are eight, one vegetarian" is everybody's
// sentence. Only whoever kept it can drop it.

function toPhrase(row: PhraseRow): SavedPhrase {
  return {
    id: row.id,
    slug: row.slug,
    side: row.side,
    heard: row.heard,
    said: row.said,
    roman: row.roman ?? undefined,
    literal: row.literal ?? undefined,
    language: row.language,
    tag: row.tag,
    keptBy: row.memberId,
  };
}

/** The trip's phrasebook, newest first — the order they were kept in. */
export async function listPhrases(tripId: string): Promise<SavedPhrase[]> {
  const rows = await db
    .select()
    .from(phrases)
    .where(eq(phrases.tripId, tripId))
    .orderBy(desc(phrases.createdAt), desc(phrases.id));
  return rows.map(toPhrase);
}

export interface PhraseInput {
  /** What the member typed. The slug is made from it, not sent by the browser. */
  name: string;
  side: TalkSide;
  heard: string;
  said: string;
  roman?: string;
  literal?: string;
  /** Named by the pair, on the server — the browser asserts no language. */
  language: string;
  tag: string;
}

/**
 * Keep one turn under a name. The slug is decided here, against the slugs the
 * trip already holds and inside the transaction that inserts, so two taps in
 * the same second get two phrases rather than one collision.
 */
export async function savePhrase(
  tripId: string,
  memberId: string,
  input: PhraseInput,
): Promise<SavedPhrase> {
  await requireMembership(tripId, memberId);
  const name = input.name.trim().slice(0, MAX_PHRASE_NAME);
  const said = input.said.trim().slice(0, 600);
  if (!worthSaying(said)) throw new DataError("There's nothing here to keep.");
  return await db.transaction(async (tx) => {
    const held = await tx
      .select({ slug: phrases.slug })
      .from(phrases)
      .where(eq(phrases.tripId, tripId));
    if (held.length >= MAX_PHRASES) {
      throw new DataError(`This trip has kept ${MAX_PHRASES} phrases. Drop one to keep another.`);
    }
    const slug = uniqueSlug(
      name,
      held.map((row) => row.slug),
    );
    if (!slug) throw new DataError("Give it a name you'll recognise later.");
    const [row] = await tx
      .insert(phrases)
      .values({
        id: randomUUID(),
        tripId,
        memberId,
        slug,
        side: input.side,
        heard: clampUtterance(input.heard),
        said,
        roman: input.roman?.trim().slice(0, 600) || null,
        literal: input.literal?.trim().slice(0, 600) || null,
        language: input.language,
        tag: input.tag,
      })
      .returning();
    logger.info({ tripId, memberId, slug, language: input.language }, "phrase kept");
    return toPhrase(row);
  });
}

/** Theirs alone to delete — whoever kept it, or an organiser of the trip. */
export async function deletePhrase(memberId: string, id: string): Promise<{ tripId: string }> {
  const [row] = await db.select().from(phrases).where(eq(phrases.id, id));
  if (!row) throw new DataError("That phrase is already gone.");
  if (row.memberId !== memberId) {
    const ctx = await tripFor(memberId, row.tripId);
    if (!ctx || !isOrganiser(ctx)) throw new DataError("Only whoever kept it can drop it.");
  }
  await db.delete(phrases).where(eq(phrases.id, id));
  logger.info({ memberId, slug: row.slug }, "phrase dropped");
  return { tripId: row.tripId };
}

// ---------- the numbers that decide what happens next ----------
//
// What a founder reads once a week. Derived, like everything else: trips
// opened, how many people each brought, and — the number the whole loop
// turns on — how many people who arrived by somebody's link went on to open
// a trip of their own.

export interface PlatformStats {
  members: number;
  trips: number;
  /** Trips with at least two members. */
  tripsWithCompany: number;
  /** Members per trip, over trips with company. */
  meanRoster: number;
  /** Members who arrived by invite and later created a trip. */
  invitedThenFounded: number;
  invited: number;
  marketsOpen: number;
  marketsResolved: number;
  billsLogged: number;
  phrasesKept: number;
}

export async function platformStats(): Promise<PlatformStats> {
  const [m] = await db
    .select({ n: sql<number>`count(*) filter (where ${members.deletedAt} is null)::int` })
    .from(members);
  const [t] = await db.select({ n: sql<number>`count(*)::int` }).from(trips);
  const rosters = await db
    .select({ tripId: memberships.tripId, n: sql<number>`count(*)::int` })
    .from(memberships)
    .groupBy(memberships.tripId);
  const withCompany = rosters.filter((r) => r.n >= 2);
  const invitedRows = await db
    .selectDistinct({ memberId: memberships.memberId })
    .from(memberships)
    .where(isNotNull(memberships.invitedWith));
  const founders = await db.selectDistinct({ memberId: trips.createdBy }).from(trips);
  const founderSet = new Set(founders.map((f) => f.memberId));
  const [mk] = await db
    .select({
      open: sql<number>`count(*) filter (where ${markets.status} = 'open')::int`,
      resolved: sql<number>`count(*) filter (where ${markets.status} <> 'open')::int`,
    })
    .from(markets);
  const [b] = await db.select({ n: sql<number>`count(*)::int` }).from(bills);
  const [p] = await db.select({ n: sql<number>`count(*)::int` }).from(phrases);
  return {
    members: m.n,
    trips: t.n,
    tripsWithCompany: withCompany.length,
    meanRoster: withCompany.length
      ? withCompany.reduce((s, r) => s + r.n, 0) / withCompany.length
      : 0,
    invitedThenFounded: invitedRows.filter((r) => founderSet.has(r.memberId)).length,
    invited: invitedRows.length,
    marketsOpen: mk.open,
    marketsResolved: mk.resolved,
    billsLogged: b.n,
    phrasesKept: p.n,
  };
}
