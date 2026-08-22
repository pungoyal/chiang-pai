# Chiang Pai — go-to-market plan

*Written 22 August 2026. The research behind every claim is in `docs/research/`.*

## The one-line thesis

**The app for the trip that actually happens.** Friend groups don't fail for lack of itineraries or split apps — those are free and everywhere. They fail between "chalte hain" and booking (42% of Indian outbound trips are booked inside 7 days; "Goa plan" is a meme for the trip that never happens), and they fall out over money afterwards (1 in 5 friendships ended over a trip's money, per Experian 2025). Chiang Pai is the only product that attacks *commitment* and *awkwardness* directly: a zero-sum, play-money prediction game about the trip itself, with the bills and the interpreter riding alongside.

## Decisions already taken (22 Aug 2026)

| Decision | Choice | Why |
|---|---|---|
| Spine | Commitment game first; bills and talk supporting | Itineraries and splitting are commoditised (Airbnb, Paytm Split Bills 29 Jul 2026); the social mechanic has no incumbent |
| Market | Indian friend groups going abroad, built global-ready | 32.7M departures, Thailand +17% / Vietnam +49%, WhatsApp- and UPI-native, zero purpose-built tools |
| Price | Free; instrument; decide at day 90 | Nobody in this category grew on per-seat pricing; Indian tolerance for a ₹149/mo utility is nil |
| Name | Keep "Chiang Pai" for now | Renaming is low business value right now |
| Vocabulary | *prediction / call / pool / pie*; never *bet, wager, odds, payout* | India's PROGA 2025 and the stores pattern-match on words |
| Money | Pies are never bought, sold, or cashed out; the app never records or links money on a prediction | This is what keeps it an "online social game" under PROGA and off the gambling ratings |
| Bills | Exactly two currencies per trip (destination + home), one for domestic, set at creation, never asked again | Matches the real trip; kills the Splitwise currency confusion |
| Migration | The existing group becomes Trip #1 | Dogfood history is the first case study |
| Age | 18+, India + global terms | Avoids DPDP parental-consent machinery |

## What shipped (the product, as of this commit)

- **Multi-trip.** `trips` + `memberships`; every read and write scoped; organiser role per trip; a member on many trips; Trip #1 migrated with all history.
- **Onboarding with no install asymmetry.** Landing page → passkey or Google → open a trip → one link in the group chat. `/join/[code]` shows the table *before* anyone signs up (the Partiful trick). Existing members join another trip with one tap.
- **Trip as a season.** Dates and phase ("In 12 days", "Last day", "Home"); starter predictions for an empty table; per-trip leaderboard; rivalries and a nemesis line on every profile; a recap page with a share-as-text button.
- **The growth artifact.** `/card/[marketId]`: a public verdict card with an OG image built for WhatsApp, reachable from every resolved prediction with a share-sheet button and a `wa.me` link.
- **Legal floor.** 18+ gate at every sign-up path; `/terms` and `/privacy` drafted against PROGA 2025, DPDP 2023/Rules 2025, GDPR; account deletion that scrubs identity and keeps the append-only ledger; no third-party cookies or analytics.
- **PWA.** Manifest, icons, Apple home-screen metadata. No store needed.
- **Instrumentation.** `pnpm stats`: members, trips, mean roster, and the number that decides everything — *invited → founded* (how many people who arrived by somebody's link went on to open their own trip).

## Positioning

**For** the one friend who always ends up planning the trip,
**Chiang Pai** is the group game that makes backing out visible and settling up painless,
**unlike** Splitwise, Wanderlog, or the group chat,
**because** it turns "are you actually coming" into a call with pies on it — and the leaderboard remembers.

Tagline: *The trip that actually happens.*
Secondary: *Call who shows up, who's late, who pays. Play-money pies, real bragging rights.*

Copy rules: Hinglish is a member's choice (lingo), never the default; no crude roast outside the opt-in "unhinged" lingo; never roast a money error; "pies are never money" appears on every public surface.

## Who, exactly

**Beachhead:** 22–35, metro India (Delhi, Bengaluru, Mumbai first — two-thirds of outbound origin), a WhatsApp group of 4–10 with one planner, going to Thailand / Vietnam / Bali / Sri Lanka / Dubai / Goa in the next 8 weeks. Entry persona is **the planner**: the app is their weapon.

**Second ring:** the same groups' domestic trips (Goa, Manali, Coorg) — domestic mode already works (one currency, no talk tab).

**Third ring (after day 90):** English-speaking groups anywhere (US bachelor parties, UK lads' trips): the product is global-ready (home currency and language are per trip), only the marketing is Indian.

## The loop (and the numbers to watch)

```
planner opens trip ──► drops invite link in WhatsApp ──► 4–9 friends join (see the table first)
        ▲                                                          │
        │                                                          ▼
  a friend opens their own trip  ◄──  verdict cards / recap  ◄──  predictions resolve during the trip
```

| Metric | Source | Target by day 90 |
|---|---|---|
| Trips opened / week | `pnpm stats` | 10 seeded by day 45, 40 by day 90 |
| Members per trip (trips with ≥2) | `pnpm stats` mean roster | ≥ 4.5 |
| Invite → join conversion | invites.use_count vs memberships | ≥ 50% of personal links, ≥ 3 joins per group link |
| **Founding rate** (invited → founded) | `pnpm stats` | **≥ 15%** — the line between a product and a toy |
| Predictions resolved per trip | `pnpm stats` | ≥ 5 (the leaderboard threshold) |
| Cards shared | server log `card` route hits from non-members | ≥ 1 per resolved prediction on average |

If founding rate is under 10% at day 90, the loop is not compounding; the fix is on the card and the join preview, not on marketing.

## 90-day plan

### Days 0–7 — ship it (done in this commit, minus deploy)
- [x] Multi-trip rewrite, migration, legal pages, landing, card, recap, PWA, stats.
- [ ] **Deploy** (you): merge → push to `main`; CI builds and runs the `migrate` service against the live database. The migration was verified on a copy of the old schema with representative data. Back up the database first (`pg_dump`) — the migration is forward-only.
- [ ] Set `AUTH_URL` to the public hostname so passkeys work (they already do on the live box).
- [ ] Put a grievance email address in `app/privacy/page.tsx` (currently "the footer of any email we send" — there is no email yet).
- [ ] Google OAuth consent screen: app name, privacy URL, terms URL.

### Days 8–21 — dogfood Trip #1 and seed 3 more
- Resolve every open call on the Chiang Mai trip; share three verdict cards into the group; read what happens.
- Open a second trip for your own next plan (Diwali 6–10 Nov is the natural one); invite by group link.
- Hand-recruit 3 planners you know personally (college group, office trip, a cousin's bachelor party). Weekly 15-minute call with each. Fix what kills a trip in its first week.
- Write the first "how we ran our Chiang Mai trip on it" post (see `docs/launch/launch-hn.md`).

### Days 22–45 — 10 real trips, two loop artifacts tuned
- Post the seed messages (`docs/launch/whatsapp-seeds.md`) in 5 WhatsApp groups you are in, framed as "I built this, try it on your Diwali plan".
- r/IndiaTravel, r/bangalore, r/delhi, r/mumbai "planning a Goa/Thailand trip" threads: answer genuinely, link in profile.
- Tune the card: watch which cards get opened by non-members (route logs). The card is the ad.
- Add the two SEO pages worth writing: `/for/thailand` (visa rules as of the week, what the trip's bills look like, the starter predictions) and `/for/goa`. Not itinerary content — the "will it happen" angle.

### Days 46–70 — public launch
- **Launch HN** (Tue–Thu, 8am PT): the play-money zero-sum math, the append-only ledger, the passkey-only join, the "why not money" legal story. Engineers are the audience; the comments are the content.
- Product Hunt the same week for the backlink.
- Indian creator seeding: 10–20 micro travel/college creators at ₹2–5K each (`docs/launch/creator-brief.md`), asked to run their *own* trip's board and post the recap. Total ≤ ₹50K.
- IndieHackers / r/SideProject story post with the founding-rate number, whatever it is.

### Days 71–90 — decide
- If founding rate ≥ 15% and ≥ 5 resolved predictions per trip: keep PWA-only; start an organiser tier experiment (₹299 per trip unlocks server voice, AI polish, CSV export; Razorpay UPI) — but only as an experiment; the research says free is right for India and revenue, if any, is affiliate/card partnerships later.
- If iOS push is the measured blocker (members missing verdicts): wrap with Capacitor, submit as "Contests" not "Simulated Gambling".
- If founding rate < 10%: the card and join preview are the work, not the channel.

## Calendar

| When | What | Why |
|---|---|---|
| 1–15 Sep 2026 | Deploy, dogfood, seed 3 | Groups start planning Diwali now (60–90 days out is when fares are sane) |
| 1–10 Oct | Public launch + creator seeding | Diwali 6–10 Nov trips are being booked; NYE Goa/Thailand plans open |
| 20 Nov – 5 Dec | Second push | NYE trips booked inside a 23–25 day window |
| 15 Feb 2027 | Third push | Holi 22 Mar 2027 long weekend |

## What I could not do, and what only you can

1. **Deploy.** Pushing to `main` deploys and migrates the live box; I was told not to touch the running containers, so this commit is local. Back up, then push.
2. **An entity and a grievance address.** DPDP wants a named contact; Razorpay wants an Indian entity (sole prop + GST is enough). Neither is needed to launch free.
3. **A lawyer's read of `/terms` and `/privacy`** before the creator push. They are drafted carefully and cite the right statutes; they are not legal advice.
4. **Google OAuth app verification** if you expect >100 Google sign-ins (Google caps unverified apps). Passkeys sidestep this entirely.
5. **The name.** Deferred by your call. "Chiang Pai" works for an Indian audience (it sounds like a place and a pun); it will need a second look before the global ring.

## Risks, honestly

- **Absorption.** WhatsApp polls + Paytm splits + Airbnb group itineraries cover 80% of "coordination". The defensible 20% is the game and the group's own history; never drift into the 80%.
- **Play money fatigue.** Manifold-style drift to ~900 daily users is what happens to play money without a season. The trip *is* the season; the recap and the rivalries are the retention, and the nemesis line is the re-engagement hook. If a trip's predictions stop at 2–3, the starters need to be better.
- **Regulatory drift.** PROGA's "other stakes" hinges on *purchased*. The moment anyone proposes selling pies, cosmetic or not, the answer is no. The Supreme Court challenge is pending; the social-game carve-out is the stable ground.
- **Store risk if wrapped.** A reviewer seeing "pool" and a currency may rate it 18+ simulated gambling. Words matter; so does presenting pies as points.
- **Tone risk.** One screenshot of an "unhinged" line next to a money error is #RejectZomato. Lingo is opt-in per member and never touches rule errors — keep it that way.

## Appendix — what the research settled

- Itinerary apps: a $40/yr-per-seat graveyard (Wanderlog ~$100k/mo after 7 years; TripCase shut 2025; Troupe subsidised by JetBlue); Polarsteps (18M users) won by refusing subscriptions.
- Split apps: Splitwise's India story is an exodus over ₹149/mo; Paytm launched free unlimited splitting 29 Jul 2026.
- Pain: 1 in 4 friend groups set a budget; >50% had a money fight; 1 in 5 ended a friendship; Indian planners spend 10–40 unthanked hours; 63.7% say the trip only happened because they pushed.
- Play money retains only inside a closed group with a season (fantasy leagues, Duolingo leagues); Manifold without a season decays.
- PROGA 2025: no purchase + no cash-out = social game; operator and payment rail are the ones criminalised; subscription for access is expressly not a stake.
- Translation is a commodity (Gemini Live Translate, free, 9 Jun 2026); the moat is the group's phrasebook and bills.
- PWA first: iOS 26 opens home-screen sites standalone; zero fees; no store questionnaire.
- Pricing: nobody charges per member; the organiser pays, if anyone does, and in India, nobody does yet.
