# Chiang Pai

A private, zero-sum prediction market for one fixed group of friends. Virtual
pies (π) only, no house: winners split exactly what losers put in, everything
is on the record, and over time the leaderboard reveals who can actually
predict things.

## The game

- Any member opens a **prediction** (binary question + explicit resolution
  criteria) and later resolves it **YES**, **NO**, or **void**.
- Bet either side, up to `MAX_STAKE_PIES` exposure per prediction; a **switch**
  moves your whole bet across before resolution.
- Resolution splits the entire pool pro-rata among the winning side
  (largest-remainder rounding, exactly zero-sum). Voids — and resolutions where
  nobody held the winning side — refund every bet.
- **Infinite bank**: no starting balance, no balance check; your number is
  lifetime net and it can go negative.
- The **leaderboard** ranks by ROI once you have `RANKED_MIN_RESOLVED`
  verdicts; before that you're "calibrating". No odds are ever displayed.
- The **inbox** and the home page's **"Picked for you"** rail (open predictions
  you haven't joined, ranked by heat, pool, split, table-mates, topic, and
  freshness — each pick labeled with why) are derived per request from the
  append-only `ledger` and view log. No stored notifications, scores, or
  profiles.

**The tests are the spec.** Each pure module carries its documentation as a
test file: `lib/engine.test.ts` (settlement, fuzz-tested zero-sum),
`lib/stats.test.ts` (outcomes, win/loss/ROI), `lib/recommend.test.ts` (ranking
and reason chips), `lib/pies.test.ts` (centi-pie math and formatting),
`lib/email.test.ts` (Gmail-dot canonicalization).

**Vocabulary.** UI: *prediction, bet, resolve, pool, pie*. Code and schema:
`market`, `stake`, `settle*`, `amountC`. Keep them apart.

**Lingo.** Members pick the dialect the app speaks to them in. All flavored
copy lives in [`lingo.yaml`](lingo.yaml); `english` is the reference and a
dialect missing one of its fields fails the build.

## Stack

Next.js 16 (App Router, server actions) · React 19 · TypeScript 7 ·
Tailwind CSS 4 · Google OAuth (no auth library) · Postgres 18 · Drizzle ORM ·
Biome · Vitest · pnpm 11 · Docker. Optional LLM polish of prediction drafts via
any Anthropic-compatible API.

## Local development

```sh
cp .env.example .env          # fill in FOUNDING_MEMBERS at minimum
docker compose up -d db       # Postgres on 127.0.0.1:${DB_PORT:-5566}
pnpm install
pnpm db:migrate
pnpm seed                     # optional demo data
pnpm dev                      # http://localhost:3000
```

Without Google credentials, `AUTH_DEV_LOGIN=true` enables a passwordless dev
login (any email, bypasses the invite list). **Never in production.** Full
stack in Docker instead: `docker compose up -d --build` (db → one-shot
`migrate` → app).

## Configuration

Every variable is validated in `lib/env.ts`; `.env.example` is the annotated
list. Highlights:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection (dev default matches compose) |
| `AUTH_URL` | Public base URL; Google OAuth callbacks derive from it |
| `AUTH_GOOGLE_ID/SECRET` | Google OAuth app (redirect URI `{AUTH_URL}/api/auth/callback/google`) |
| `FOUNDING_MEMBERS` | Comma-separated emails: always allowed in, and the only inviters |
| `MAX_STAKE_PIES` | Per-member exposure cap per market (default 10) |
| `RANKED_MIN_RESOLVED` | Verdicts needed to appear ranked (default 5) |
| `DB_PORT` / `APP_PORT` / `APP_BIND` / `PORT` | Database and HTTP ports |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Optional draft-polish endpoint (hidden when unset) |

Membership is invite-only. Founders mint a single-use invite link on the
members page; whoever opens it picks a name, creates a passkey, and is in —
no email and no Google account anywhere in that flow. Google sign-in still
works for members who joined before links existed, accepted only for
`FOUNDING_MEMBERS` or addresses already on the allowlist.

## Quality gates

`pnpm test` (pure logic only — no UI tests, by design) · `pnpm lint` ·
`pnpm tsc --noEmit`. Pre-commit runs all three; CI
(`.github/workflows/ci.yml`) runs them, builds an arm64 image to GHCR, and
deploys.

## Deployment (OCI over SSH)

Push to `main`: verify → build & push one arm64 GHCR image (`:short-sha` +
`:latest`) → SSH to the OCI box, pull the pinned tag, `docker compose up -d`
(one-shot `migrate` container, then `app`).

Configure a GitHub **environment named `oracle-cloud`**:

| Kind | Name | Value |
| --- | --- | --- |
| var | `OCI_HOST` | server hostname/IP |
| var | `OCI_USER` | ssh user |
| var | `OCI_SSH_PORT` | optional, defaults to 22 |
| var | `DEPLOY_DIR` | server directory holding `docker-compose.yml` + `.env` |
| secret | `OCI_SSH_KEY` | private key for the ssh user |

No registry credentials needed: the deploy job logs the server into GHCR with
its ephemeral `GITHUB_TOKEN` (`packages: read`).

One-time server setup: install Docker, create `DEPLOY_DIR` with this repo's
`docker-compose.yml` and a production `.env` (strong `AUTH_SECRET` and
`POSTGRES_PASSWORD`, real `AUTH_URL`, Google credentials, `FOUNDING_MEMBERS`),
and point your reverse proxy at `127.0.0.1:${APP_PORT:-3000}`.
