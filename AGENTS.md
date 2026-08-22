# Chiang Pai — agent notes

The app for the trip that actually happens: friend groups open a *trip*, join
by link, and play a zero-sum play-money prediction game about the trip itself,
with split bills and a two-way interpreter beside it. Next.js 16 App Router +
server actions, Postgres via Drizzle, dependency-free passkeys + Google OAuth
(`lib/auth.ts`). Multi-tenant: everything hangs off a `trips` row.

**Behavior is specified by the tests.** Every pure module has a `*.test.ts`
beside it: `lib/engine` (settlement), `lib/stats` (outcomes/roll-ups),
`lib/recommend` (For-you ranking), `lib/pies` (money math), `lib/email`
(canonicalization), `lib/webauthn` + `lib/cbor` (passkey verification),
`lib/avatar` (monograms), `lib/invites` (invite codes), `lib/recovery`
(recovery links), `lib/talk` (the language pair, turn-taking, voice choice),
`lib/phrases` (kept phrases: slugs and which voice says one again),
`lib/trips` (what a trip is: its two currencies, its phase, its rules),
`lib/starters` (the first predictions a trip offers).
Read the test before changing a module; change them together.

## Commands (pnpm 11)

- `pnpm dev` — dev server (needs `docker compose up -d db` and a `.env`)
- `pnpm dev:https` — same on `0.0.0.0` over self-signed TLS, which is the only
  way to reach `/talk` from a phone: the microphone needs a secure context and
  a LAN address is not one
- `pnpm test` — vitest, pure logic only; never add UI/component/page tests
- `pnpm lint` / `pnpm format` — Biome (2-space, 100 cols, double quotes)
- `pnpm tsc --noEmit` — typecheck
- `pnpm db:generate` / `pnpm db:migrate` — new Drizzle migration after editing
  `lib/db/schema.ts` / apply (also run by the `migrate` compose service)
- `pnpm seed` — demo data (dev only)
- `pnpm stats` — the go-to-market numbers (trips, rosters, founding rate),
  derived straight from the database
- `pnpm recovery:link "<name or id>"` — break-glass recovery link, straight
  against the database, for when no organiser can sign in either
- `pnpm lingo:gen` — compile `lingo.yaml` → `lib/lingo.data.ts` (`dev` and
  `build` run it for you)

Pre-commit (husky): biome on staged files, tsc, full test suite.

## Rules

- The `ledger` is append-only; balances, positions, pools, results are derived
  by replay. `market_views` (page-open telemetry) is append-only too. Never
  store a balance, score, or profile.
- Pure math lives in tested modules (`engine`, `stats`, `recommend`);
  `lib/data.ts` does I/O + assembly only. New derivation logic goes in a pure
  module with tests — `data.ts`'s import chain needs env + a DB pool, so
  inline logic there is untestable.
- Zero-sum is the invariant: payouts sum exactly to the pool
  (largest-remainder rounding, fuzz-tested).
- Pies are integer centi-pies end to end; format only at the edge (`lib/pies.ts`).
- Infinite bank: no grant, net can go negative; the per-prediction exposure
  cap (`trips.max_stake_pies`) is the only brake — never gate the call UI on
  balance.
- **A trip is the tenant and the season.** `trips` holds the name, the
  destination, the home language, the two currencies, the dates, and the cap;
  `memberships` holds who is on it and with which role. Markets, ledger rows,
  bills, invites, and phrases all carry `trip_id`; reactions, views, and
  comments reach the trip through their market or bill. Every read in
  `lib/data.ts` takes a `tripId` or finds one through an id, and every write
  checks the caller's membership there — not in the UI, which anyone can
  bypass with a POST. Pages under `/t/[tripId]` start with `requireTrip`,
  which redirects a member with no seat. A member can be on many trips; the
  leaderboard, the inbox cursor, the net, the cap are all per trip. Names are
  distinct per trip (mentions), not across the world.
- **Pies are never money, and never near money.** That is what keeps the game
  an "online social game" under India's PROGA 2025 and off the store
  questionnaires' gambling ratings: no purchase, no cash-out, no prize, and
  the app never records, links, or settles money on a prediction. A UPI link,
  a "loser pays ₹500" field, or a rupee amount on a market would cross it.
  Bills are the one place real money is named, and they are a ledger of what
  members say, never a rail. UI vocabulary is *prediction / call / resolve /
  pool / pie / points*; never *bet, wager, stake (as money), odds, payout,
  cash*. Code keeps `market/stake/settle*/amountC`. Don't half-rename either.
- Inbox and the For-you rail are derived at read time. Stored state is only
  `memberships.inbox_seen_at` plus raw view rows; views are recorded by a
  client effect (`components/record-view.tsx`) so link prefetches never count.
- The group and the leaderboard are one page (`/t/[id]/members`): a single
  ranked table, calibrating members under a divider row, with the invite and
  recovery machinery below it. Its only stats source is `leaderboard(tripId)`,
  which already replays every balance — never add a `netOf` per member beside
  it. The recap (`/t/[id]/recap`) is the season summed up — table, rivalries
  (`lib/stats` `rivalries`/`nemesisOf`), biggest swings — and the thing a trip
  shares when it is over.
- **Growth is the product's own artifacts, not a marketing surface.** Two
  pages are reachable by URL alone, on purpose: `/join/[code]` shows the table
  before anyone sits down (trip, roster names, a few open questions), and
  `/card/[marketId]` is one prediction's verdict with first names and pies,
  with an OG image for the group chat. Both carry nothing a member didn't
  choose to put on the record, and neither leaks the trip beyond its name.
  Keep them thin; never add a third without that test. `pnpm stats` reads the
  loop: trips opened, roster size, and how many who arrived by invite later
  opened a trip of their own (`memberships.invited_with`).
- 18+ and terms: a member row carries `terms_accepted_at`; sign-up forms tick
  it, Google sign-in carries the tick in a short signed cookie, and members who
  predate the gate see `TermsNudge` until they accept. `/terms` and `/privacy`
  are plain pages — written for the group, not a court; a lawyer reads them
  before scale. Account deletion (`deleteAccount`) scrubs everything
  identifying in one transaction and leaves the ledger rows under "Departed
  member", because append-only means a payout cannot vanish.
- `lib/env.ts` is the only file reading `process.env` (zod-validated).
- Relative imports in `lib/` and `scripts/` carry explicit `.ts` extensions so
  plain `node scripts/*.ts` runs (Node type stripping).
- Every flavored string lives in `lingo.yaml`, never in a component; all
  lingos must define exactly `english`'s fields (generator enforces). Buttons,
  nav, and rule errors stay plain in every lingo.
- Emails go through `normalizeEmail` (`lib/email.ts`) before any lookup or
  write — Gmail ignores dots.
- New members join a trip by invite link — personal (single use, 7 days) or
  an open group link (30 days, unlimited). A member of one trip opening a link
  to another is seated with one tap (`joinTripWithInvite`). The code is the
  row's primary key and is stored as-is, so an organiser can re-share a link; invites survive on being
  short-lived and revocable rather than unreadable (`lib/invites.ts`).
  `use_count` is the only record of acceptance — it is what spends a personal
  link. Accepting one creates the member, their passkey, and spends it in one
  transaction with the row locked.
  `members.email` is nullable because of it — a link-joined member has no
  address at all. New members pick their name and lingo at sign-up.
- Who organises is `memberships.role`, per trip. Whoever creates a trip is its
  first organiser; organisers promote and step down each other (and
  themselves) from a member's page; stepping down the last organiser is
  refused, since nobody could then invite or recover. There is no global
  admin and no `FOUNDING_MEMBERS` — anyone can make an account and a trip.
- Losing every passkey is recovered by an organiser-minted *recovery* link
  (`lib/recovery.ts`, `recoveries` table, `/recover/[code]`) — never by
  relaxing anything about sign-in. It is a separate table from `invites` on
  purpose: this link does not create a member, it *becomes* one, so it lasts
  30 minutes, spends on first use, and only one is live per member at a time.
  The check that matters is an organiser (of a trip the member shares)
  confirming out of band who is asking;
  what code contributes is that nothing happens quietly — mint, shut, and use
  are `logger.warn`, and every live and recently-used link is named on the
  trip's members page for the whole table, revocable by any organiser *and* by
  the member it names. Recovery adds a passkey and never removes one, so a member who
  still holds a key keeps it and can drop the intruder. `pnpm recovery:link`
  is the failsafe under that (`minted_by` null = console), for when no
  organiser can sign in; it needs `DATABASE_URL`, which is where the trust
  already sat.
- Names must be distinct per trip: `@mentions` resolve against them
  (`lib/mentions.ts`). Joining a trip with a clashing name is refused;
  renaming checks every trip the member is on.
- Two ways in: passkeys (`lib/webauthn.ts`, pure and verified on `node:crypto`)
  and Google, which passkeys are replacing. Nothing identifying is stored for a
  passkey — a credential id, a public key, a counter; the aaguid and the
  attestation statement are deliberately ignored. Challenges live in a signed
  cookie (`lib/auth.ts`), single use, and carry a `PasskeyPurpose` that never
  crosses: a `join` ceremony cannot be finished as a `register`, and neither
  can be finished as a `recover`.
- Avatars are an upload or a generated monogram — initials on a gradient seeded
  by member id, never the name, so a rename keeps the same face. Nothing reads
  `members.image` any more.
- Vocabulary: UI says *prediction/bet/resolve/pool/pie*; code says
  `market/stake/settle*/amountC`. Don't half-rename either side.
- `/talk` is the one page pointed *outward*, at somebody who is not in the
  group: tap a side, speak, and the phone says it in the other language.
  The conversation is not stored — no turn, no clip, no transcript. It is
  component state and dies with the tab, which is the only sensible lifetime
  for a stranger's words and why there is no session behind it.
  The one exception is a phrase a member deliberately kept: they point at a
  turn, name it, and it lands in `phrases` under a slug of that name
  (`lib/phrases.ts`), unique per trip, for the whole trip to play again and
  for the keeper (or an organiser) to delete. That is a phrasebook somebody
  wrote, not a transcript the app took — so the test for anything new here is
  whether a member asked for it by tapping, one row per tap. Never widen it
  into saving turns automatically.
  A kept phrase carries the language it is in (`language`, `tag`) because the
  pair is configuration and configuration moves: a Thai line replayed after
  the group has flown home is read by a Thai voice or by none — `voiceFor`
  refuses the voice service a side it can no longer tell the truth about,
  since that service is told a side and looks the language up itself.
  Which two languages is the trip's configuration, not code: `homeLanguage`
  and `destination` resolve through `lib/talk` `pairFor(trip)`, which returns
  null — talk tab hidden — when there is nothing to interpret. The destination
  decides the voice, the prompt, and the foreign currency; `lib/trips`
  `tripConfig` derives that currency and drops it when it is the home one, so
  a domestic trip has one currency and no bill ever asks. A new destination is
  a line in `DESTINATIONS`, plus a line in `lib/split.ts` `CURRENCY_INFO` if
  its money is new — which `resolvePair` refuses rather than discovers at the
  till. The currency column is text; the set lives in code.
  Who speaks is two settings, not one. On the device, `pickVoice` reads the
  voice's *name* for a gender — the API offers no other clue — and prefers the
  one the `Speaker` asks for, below the language and never instead of it. On
  the server, MiniMax voices are cross-lingual, so each side gets its own
  (`SPEECH_VOICE_US` / `SPEECH_VOICE_THEM`, plus pitch and speed for the local
  side); the openai flavor keeps one voice for both, having no way to tell them
  apart. Check a voice id against `POST /v1/get_voice` before setting it.
  Listening is the browser's own recogniser and nothing else: it is the only
  one there is, solid on Android Chrome and missing on some iPhones, and where
  it is missing the page says so and offers typing. Never add a server
  transcription path without a vendor that actually has one — the last one was
  configured against MiniMax, which has no ASR, and it would have failed in
  front of somebody. Speaking prefers the device's own voice and falls back to
  `SPEECH_BASE_URL`.
  Thai politeness needs the speaker's gender and this schema refuses to hold
  it, so ครับ/ค่ะ is a toggle on the page, shown only where the destination
  language has particles at all.
  A lingo is how the app talks *to a member*; the destination language is how a
  member talks to a stranger. Do not add one to `lingo.yaml` — it would owe all
  47 fields and would be roasting the wrong person.
- pnpm hoisted linker (pnpm-workspace.yaml) keeps standalone output identical
  locally and in Docker; one arm64 image serves the app and runs migrations
  (`next.config.ts` `outputFileTracingIncludes`).
- Honor pnpm's `minimumReleaseAge`: pin an older version if an install fails on
  a too-fresh package — never add exclusions without the owner's approval.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
