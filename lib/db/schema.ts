import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const sideEnum = pgEnum("side", ["yes", "no"]);
export const marketStatusEnum = pgEnum("market_status", ["open", "yes", "no", "refunded"]);
export const ledgerKindEnum = pgEnum("ledger_kind", ["grant", "bet", "switch", "payout", "refund"]);

export const members = pgTable("members", {
  id: text("id").primaryKey(),
  // Nullable since invite links arrived: a member who joined by link has no
  // address anywhere in the system. Google sign-ins still fill it, until the
  // column goes entirely.
  email: text("email").unique(),
  name: text("name").notNull(),
  image: text("image"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  // The lingo the UI speaks to this member in; a lib/lingo.ts key.
  lingo: text("lingo").notNull().default("english"),
  // Inbox read cursor: events after this instant count as unread. The inbox
  // itself is derived entirely from markets + ledger — no notification rows.
  inboxSeenAt: timestamp("inbox_seen_at", { withTimezone: true }),
  // Set when the member uploaded their own picture (see `avatars`); it wins
  // over `image` and doubles as the cache-buster in the avatar URL.
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
});

// Uploaded profile pictures, one per member, overriding the Google `image`.
// The bytes live in their own table so the frequent full-members scans in
// lib/data.ts never drag image data along.
export const avatars = pgTable("avatars", {
  memberId: text("member_id")
    .primaryKey()
    .references(() => members.id),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Invite links. Two kinds: a personal one, spent by the first person to walk
// through it, and an open group link anyone in the chat can use. Both are
// readable capabilities — the code is stored so a founder can re-share what
// they already sent — and both survive on being short-lived and revocable
// instead (lib/invites.ts). Acceptance runs in the transaction that creates
// the member, with the row locked, so a personal link cannot be spent twice.
export const invites = pgTable("invites", {
  /** The code from the link, and the only name this row has. */
  code: text("code").primaryKey(),
  /** Who the inviter says this is for — a name, so the pending list reads. */
  label: text("label").notNull(),
  /** An open link never spends: anyone holding it can join until it expires. */
  isOpen: boolean("is_open").notNull().default(false),
  /** What spends a personal invite, and what counts arrivals through an open one. */
  useCount: integer("use_count").notNull().default(0),
  invitedBy: text("invited_by")
    .notNull()
    .references(() => members.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Superseded by `invites`; kept until Google sign-in goes, for members already on it. */
export const allowlist = pgTable("allowlist", {
  email: text("email").primaryKey(),
  invitedBy: text("invited_by").references(() => members.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Passkeys. A member may hold several — laptop, phone, a spare — and any one
// of them signs them in. Nothing here identifies anyone: a random credential
// id the authenticator chose, a public key, and a counter. The aaguid (which
// make and model of authenticator) is deliberately not among them.
export const credentials = pgTable(
  "credentials",
  {
    /** The authenticator's credential id, base64url — what a sign-in is looked up by. */
    id: text("id").primaryKey(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    /** SPKI DER, as node:crypto exports it (lib/webauthn.ts). */
    publicKey: bytea("public_key").notNull(),
    /** COSE algorithm: -7 (ES256) or -257 (RS256). */
    alg: integer("alg").notNull(),
    /** Authenticator's own counter; a value that goes backwards means a clone. */
    signCount: bigint("sign_count", { mode: "number" }).notNull().default(0),
    /** The key is synced to a credential manager, so losing the device isn't losing it. */
    backedUp: boolean("backed_up").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("credentials_member_idx").on(t.memberId)],
);

export const markets = pgTable("markets", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => members.id),
  question: text("question").notNull(),
  criteria: text("criteria").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  status: marketStatusEnum("status").notNull().default("open"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
});

// Append-only. Every pie movement in the system is a row here; balances and
// positions are always derived by replaying it, never stored elsewhere.
//   grant   +amount   pies issued to a member on joining
//   bet     -amount   stake committed to a market side
//   switch   0        stake moved to the other side (side = destination)
//   payout  +amount   winning share of a resolved market's pool
//   refund  +amount   stake returned (voided market or empty winning side)
export const ledger = pgTable("ledger", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  memberId: text("member_id")
    .notNull()
    .references(() => members.id),
  marketId: text("market_id").references(() => markets.id),
  kind: ledgerKindEnum("kind").notNull(),
  side: sideEnum("side"),
  amountC: integer("amount_c").notNull(),
  balanceDeltaC: integer("balance_delta_c").notNull(),
  note: text("note"),
});

// Append-only, like the ledger: one row each time a member opens a prediction
// page. Pure telemetry — never touches settlement. The "For you" ranking and
// the watcher count are derived from it at read time.
export const marketViews = pgTable(
  "market_views",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
  },
  (t) => [index("market_views_member_market_idx").on(t.memberId, t.marketId)],
);

export const marketReactionEnum = pgEnum("market_reaction", ["upvote", "watch"]);

// Raw member intent on a prediction, one row per live reaction: an `upvote`
// says "good question", a `watch` says "keep me posted". Toggling off deletes
// the row — this is presence state like `members.inbox_seen_at`, not history.
// Counts, ranking boosts, and watch-driven inbox items are derived at read
// time; nothing aggregated is ever stored.
export const marketReactions = pgTable(
  "market_reactions",
  {
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    kind: marketReactionEnum("kind").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.marketId, t.memberId, t.kind] }),
    index("market_reactions_member_idx").on(t.memberId),
  ],
);

// ---------- split bills (real money, separate from the pie ledger) ----------

export const currencyEnum = pgEnum("currency", ["inr", "thb"]);
export const billKindEnum = pgEnum("bill_kind", ["expense", "settlement"]);
export const billSplitEnum = pgEnum("bill_split", ["equal", "custom"]);

/** Identity only — everything about a bill lives in its revisions. */
export const bills = pgTable("bills", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only, in the ledger's spirit: every add, edit, or delete of a bill is
// a new full snapshot here, so any member can change any bill and the whole
// trail stays on the record. A bill's current state is its latest revision;
// `deleted: true` retires it. A `settlement` is a bill where the payer paid
// and the receiver owes — the same replay that nets expenses cancels it.
export const billRevisions = pgTable(
  "bill_revisions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    billId: text("bill_id")
      .notNull()
      .references(() => bills.id),
    editorId: text("editor_id")
      .notNull()
      .references(() => members.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    deleted: boolean("deleted").notNull().default(false),
    kind: billKindEnum("kind").notNull().default("expense"),
    // The day the money moved, as the member stated it — no timezone games.
    onDate: date("on_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    currency: currencyEnum("currency").notNull(),
    split: billSplitEnum("split").notNull().default("equal"),
  },
  (t) => [index("bill_revisions_bill_idx").on(t.billId)],
);

// One member's line on one revision. Owed shares are computed at write time by
// lib/split.ts (largest-remainder, like engine's settle) so paid and owed each
// sum to the bill total and historical bills never re-split.
export const billEntries = pgTable(
  "bill_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    revisionId: bigint("revision_id", { mode: "number" })
      .notNull()
      .references(() => billRevisions.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
    paidC: integer("paid_c").notNull().default(0),
    owedC: integer("owed_c").notNull().default(0),
    participant: boolean("participant").notNull().default(true),
  },
  (t) => [index("bill_entries_revision_idx").on(t.revisionId)],
);

// ---------- comments (on predictions and on bills) ----------

// Append-only, in the ledger's spirit: table talk stays on the record, no
// edits or deletes. Exactly one of market_id / bill_id is set (the check
// below). Mentions in the body are resolved against member names at write
// time by lib/mentions.ts and snapshotted as comment_mentions rows, so a
// later rename never rewrites who was tagged. "You were tagged" inbox items
// are derived from those rows at read time — no notification rows; the only
// read state is still members.inbox_seen_at.
export const comments = pgTable(
  "comments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    authorId: text("author_id")
      .notNull()
      .references(() => members.id),
    marketId: text("market_id").references(() => markets.id),
    billId: text("bill_id").references(() => bills.id),
    body: text("body").notNull(),
  },
  (t) => [
    index("comments_market_idx").on(t.marketId),
    index("comments_bill_idx").on(t.billId),
    check("comments_one_subject", sql`("market_id" IS NULL) <> ("bill_id" IS NULL)`),
  ],
);

export const commentMentions = pgTable(
  "comment_mentions",
  {
    commentId: bigint("comment_id", { mode: "number" })
      .notNull()
      .references(() => comments.id),
    memberId: text("member_id")
      .notNull()
      .references(() => members.id),
  },
  (t) => [
    primaryKey({ columns: [t.commentId, t.memberId] }),
    index("comment_mentions_member_idx").on(t.memberId),
  ],
);

export type Member = typeof members.$inferSelect;
export type CredentialRow = typeof credentials.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type Market = typeof markets.$inferSelect;
export type LedgerRow = typeof ledger.$inferSelect;
export type MarketViewRow = typeof marketViews.$inferSelect;
export type MarketReactionRow = typeof marketReactions.$inferSelect;
export type ReactionKind = MarketReactionRow["kind"];
export type BillRevisionRow = typeof billRevisions.$inferSelect;
export type BillEntryRow = typeof billEntries.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
