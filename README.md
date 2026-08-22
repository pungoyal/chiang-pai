# Chiang Pai

The app for the trip that actually happens. A friend group opens a **trip**,
drops one link in the group chat, and puts its arguments on the record as
zero-sum, play-money predictions about the trip itself — who books by Friday,
who's last to the airport, who gets the tuk-tuk under a hundred baht. Virtual
pies (π) only, no house: winners split exactly what losers put in, everything
is on the record, and over the trip the leaderboard reveals who can actually
predict things. Split bills and a two-way interpreter sit beside the game.

## The game

- A **trip** is the table: a name, a destination, the two currencies it
  spends (one, if domestic), optional dates, and a cap per prediction. Anyone
  can open one; they are its first **organiser**, and members arrive by link.
- Any member opens a **prediction** (binary question + explicit resolution
  criteria) and later resolves it **YES**, **NO**, or **void**. An empty trip
  offers **starters** — the questions every friend trip argues about.
- Call either side, up to the trip's cap per prediction; a **switch** moves
  your whole call across before resolution.
- Resolution splits the entire pool pro-rata among the winning side
  (largest-remainder rounding, exactly zero-sum). Voids — and resolutions where
  nobody held the winning side — refund every bet.
- **Infinite bank**: no starting balance, no balance check; your number is
  lifetime net and it can go negative.
- **The table** is one page per trip, ranked by ROI once you have
  `RANKED_MIN_RESOLVED` verdicts; before that you sit under the line,
  "calibrating". No odds are ever displayed. The **recap** sums the season up:
  the table, the rivalries, the biggest swings — and shares as text.
- A resolved prediction has a public **verdict card** (`/card/[id]`, an
  unguessable id, first names and pies only) with an image built for WhatsApp.
  Invite links show the table before anyone sits down. Those two pages are the
  whole growth loop; `pnpm stats` reads it.
- The **inbox** and the home page's **"Picked for you"** rail (open predictions
  you haven't joined, ranked by heat, pool, split, table-mates, topic, and
  freshness — each pick labeled with why) are derived per request from the
  append-only `ledger` and view log. No stored notifications, scores, or
  profiles.

**The tests are the spec.** Each pure module carries its documentation as a
test file: `lib/engine.test.ts` (settlement, fuzz-tested zero-sum),
`lib/stats.test.ts` (outcomes, win/loss/ROI), `lib/recommend.test.ts` (ranking
and reason chips), `lib/pies.test.ts` (centi-pie math and formatting),
`lib/email.test.ts` (Gmail-dot canonicalization), `lib/talk.test.ts` (the
language pair, whose turn it is, and which voice a device can speak it with),
`lib/trips.test.ts` (what a trip is), `lib/starters.test.ts`.

**Talking to locals.** `/talk` is a two-way interpreter on one phone: tap your
side, speak, and it says it out loud in the local language; hand the phone over
and it comes back in yours. Nothing is stored — the conversation lives in the
tab. The pair is the trip's — its home language and destination — and the
destination also sets the currency a new bill starts in. Kept phrases are the
trip's phrasebook.

**Vocabulary.** UI: *prediction, bet, resolve, pool, pie*. Code and schema:
`market`, `stake`, `settle*`, `amountC`. Keep them apart.

**Lingo.** Members pick the dialect the app speaks to them in. All flavored
copy lives in [`lingo.yaml`](lingo.yaml); `english` is the reference and a
dialect missing one of its fields fails the build.

## Stack

Next.js 16 (App Router, server actions) · React 19 · TypeScript 7 ·
Tailwind CSS 4 · Google OAuth (no auth library) · Postgres 18 · Drizzle ORM ·
Biome · Vitest · pnpm 11 · Docker. Optional LLM (any Anthropic-compatible API)
for prediction-draft polish and Thai interpreting; optional OpenAI-compatible
`/audio` endpoint for speech.

## Local development

```sh
cp .env.example .env          # set AUTH_SECRET at minimum
docker compose up -d db       # Postgres on 127.0.0.1:${DB_PORT:-5566}
pnpm install
pnpm db:migrate
pnpm seed                     # optional demo data
pnpm dev                      # http://localhost:3000
```

Without Google credentials, `AUTH_DEV_LOGIN=true` enables a passwordless dev
login (any email). **Never in production.** Full
stack in Docker instead: `docker compose up -d --build` (db → one-shot
`migrate` → app).

`/talk` is the one page that cannot be tested on a laptop: it wants a
microphone, and a browser only hands one over in a secure context. `localhost`
counts; a LAN address does not. So reach it from a phone with `pnpm dev:https`
(self-signed, accept the warning) and set `AUTH_URL` to the same
`https://<your-ip>:3000`. Passkeys stay off there — an IP address cannot be a
WebAuthn relying party — so sign in with the dev login.

## Configuration

Every variable is validated in `lib/env.ts`; `.env.example` is the annotated
list. Highlights:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection (dev default matches compose) |
| `AUTH_URL` | Public base URL; Google OAuth callbacks derive from it |
| `AUTH_GOOGLE_ID/SECRET` | Google OAuth app (redirect URI `{AUTH_URL}/api/auth/callback/google`) |
| `RANKED_MIN_RESOLVED` | Verdicts needed to appear ranked (default 5) |
| `DB_PORT` / `APP_PORT` / `APP_BIND` / `PORT` | Database and HTTP ports |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | Optional draft-polish and Thai interpreting endpoint (hidden when unset) |
| `SPEECH_BASE_URL` / `SPEECH_API_KEY` / `SPEECH_FLAVOR` | Optional voice for phones with none: OpenAI-compatible `/audio/speech`, or `minimax` |

Anyone can open an account (a passkey from the front page, or Google) and a
trip. Trips are invite-only: organisers mint a single-use or group invite
link on the trip's members page; whoever opens it sees the table, picks a
name, creates a passkey, and is in — no email and no Google account anywhere
in that flow. Members are 18+ and accept the terms at sign-up; accounts can be
deleted from the account page.

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
`POSTGRES_PASSWORD`, real `AUTH_URL`, Google credentials),
and point your reverse proxy at `127.0.0.1:${APP_PORT:-3000}`.
