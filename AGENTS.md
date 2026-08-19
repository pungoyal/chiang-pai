# Chiang Pai — agent notes

Private zero-sum prediction game for one friend group. Next.js 16 App Router +
server actions, Postgres via Drizzle, dependency-free Google OAuth + invite
allowlist (`lib/auth.ts`).

**Behavior is specified by the tests.** Every pure module has a `*.test.ts`
beside it: `lib/engine` (settlement), `lib/stats` (outcomes/roll-ups),
`lib/recommend` (For-you ranking), `lib/pies` (money math), `lib/email`
(canonicalization), `lib/webauthn` + `lib/cbor` (passkey verification),
`lib/avatar` (monograms), `lib/invites` (invite codes). Read the test before
changing a module; change them together.

## Commands (pnpm 11)

- `pnpm dev` — dev server (needs `docker compose up -d db` and a `.env`)
- `pnpm test` — vitest, pure logic only; never add UI/component/page tests
- `pnpm lint` / `pnpm format` — Biome (2-space, 100 cols, double quotes)
- `pnpm tsc --noEmit` — typecheck
- `pnpm db:generate` / `pnpm db:migrate` — new Drizzle migration after editing
  `lib/db/schema.ts` / apply (also run by the `migrate` compose service)
- `pnpm seed` — demo data (dev only)
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
- Infinite bank: no grant, net can go negative; the per-market exposure cap
  (`MAX_STAKE_PIES`) is the only brake — never gate betting UI on balance.
- Inbox and the For-you rail are derived at read time. Stored state is only
  `members.inbox_seen_at` plus raw view rows; views are recorded by a client
  effect (`components/record-view.tsx`) so link prefetches never count.
- `lib/env.ts` is the only file reading `process.env` (zod-validated).
- Relative imports in `lib/` and `scripts/` carry explicit `.ts` extensions so
  plain `node scripts/*.ts` runs (Node type stripping).
- Every flavored string lives in `lingo.yaml`, never in a component; all
  lingos must define exactly `english`'s fields (generator enforces). Buttons,
  nav, and rule errors stay plain in every lingo.
- Emails go through `normalizeEmail` (`lib/email.ts`) before any lookup or
  write — Gmail ignores dots.
- New members join by single-use invite link: a founder mints a code, only its
  SHA-256 is stored (`lib/invites.ts`), and accepting it creates the member,
  their passkey, and spends the link in one transaction. `members.email` is
  nullable because of it — a link-joined member has no address at all. The
  email `allowlist` survives only for members who predate links.
- Names must be distinct: `@mentions` resolve against them (`lib/mentions.ts`)
  and email used to disambiguate.
- Two ways in: passkeys (`lib/webauthn.ts`, pure and verified on `node:crypto`)
  and Google, which passkeys are replacing. Nothing identifying is stored for a
  passkey — a credential id, a public key, a counter; the aaguid and the
  attestation statement are deliberately ignored. Challenges live in a signed
  cookie (`lib/auth.ts`), single use.
- Avatars are an upload or a generated monogram — initials on a gradient seeded
  by member id, never the name, so a rename keeps the same face. Nothing reads
  `members.image` any more.
- Vocabulary: UI says *prediction/bet/resolve/pool/pie*; code says
  `market/stake/settle*/amountC`. Don't half-rename either side.
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
