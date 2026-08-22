# Taking a friend-group travel web app to market as a solo founder (August 2026)

## 1. PWA vs native in 2026

**iOS.** Home-screen web apps get Web Push + badges since iOS 16.4; Safari 18.4 added Declarative Web Push; **iOS 26 opens every site added to the home screen standalone by default**. Still true: no `beforeinstallprompt` (ship your own "Share → Add to Home Screen" card); push only once installed; ~50 MB cache cap. EU: Apple reversed its 2024 plan to remove web apps; test on an EU device. Passkeys/WebAuthn work in Safari and installed web apps. `webkitSpeechRecognition` is flaky and absent in standalone mode (matches what `/talk` already does — say so, offer typing). No Web Share Target on iOS.

**Android.** Chrome: full install prompt, push, share target, speech recognition solid. First-class.

**Fees/review.** Web apps pay Apple nothing anywhere. Stores: 30%/15% Small Business; EU from 1 Oct 2026 a new tiered structure plus a 5% Core Technology Commission; Google Play 15% on first $1M. Plus $99/yr Apple, $25 Google.

**Wrappers.** Capacitor is the right wrapper for an existing Next.js app; the real costs are two review queues, Apple rule 4.2 (minimum functionality for thin wrappers), and mandatory IAP for any in-app paywall. **Practical read: PWA-only at launch.** Revisit Capacitor only when iOS push reliability or store discoverability is demonstrably the bottleneck.

**Precedent.** Partiful was web-first for years (links in iMessage/WhatsApp; native later). Wanderlog launched web-only (Launch HN, 2019) and added apps after traction.

## 2. Acquisition channels

**Invite-loop math.** k = invites per user × invite conversion. Benchmarks: 0.15–0.25 good, 0.4 great, ~0.7 exceptional; sustained k>1 essentially never. Group apps are structurally better: *one* host imports a whole group, and the invite *is* the product. Partiful hit 500K MAU in Q1 2025 at 400% YoY with effectively no paid marketing because non-members see the event page before signing up. **Measure**: (a) trips created → members joined per trip, (b) fraction of joined members who later *found* a new trip — the real k, and where the loop either compounds or stops. Let guests see the board before joining.

**Product Hunt.** Alive but diluted; audience is SaaS/AI builders, not friend groups. Use for a backlink and feedback. **Launch HN** is the better fit for a founder-built web app (Wanderlog chose HN over PH deliberately).

**Reddit.** r/travel, r/IndiaTravel, r/solotravel ban self-promo; what works is the "I built this for my friend group, here's what happened on our Chiang Mai trip" story in r/SideProject, r/webdev, r/india, plus genuinely answering "how do you plan a group trip" threads.

**Short video.** Travel creators are the most expensive category (India 10–50K followers ₹5–15K/Reel; 50–200K ₹15–50K/Reel). The cheap version is the NGL playbook: $50–100 to many micro-creators, <$10K total. The organic unit for a trip app is the group's own "who won the bets" recap reel: build a shareable result card so the content is made by users (how Locket grew on TikTok).

**WhatsApp-native in India.** ~89% of Indian smartphone owners use WhatsApp; the highest-conversion organic channel. The invite link's OG card is the ad; the "resolved — X won 40 pies" message is the retention hook; a WhatsApp deep link with a pre-filled message beats a generic share sheet. UPI cash referrals beat coupons 3x in India — but are irrelevant (and poisonous) for a play-money app.

**SEO.** "Trip planner with friends" is crowded. The defensible long tail: "prediction game for friends", "bets with friends no money", "trip bets app", and destination-specific pages ("Chiang Mai group trip").

**ASO.** Only if a wrapper ships.

## 3. Pricing benchmarks (2026)

| Product | Price | Model |
|---|---|---|
| Splitwise Pro | $4.99/mo, $39.99/yr; India ₹2,499/yr | freemium, daily limits |
| Wanderlog Pro | $39.99/yr | freemium |
| TripIt Pro | $49/yr | freemium |
| Polarsteps Plus | €29.99/yr | freemium + physical books |
| Strava | $79.99/yr | freemium |
| Partiful | free; ~10% + $2/ticket | take rate |
| Luma | free; Plus $59/mo | organiser SaaS |
| Spond | free; fee on payments | take rate |

Pattern: group apps charge the *organiser*. Nobody charges per member. Sensible options: free forever for the group, and a founder tier at ₹99–149/mo or a per-trip unlock (₹299 / $4.99) for voice, AI roast lingos, exports. India: Razorpay for UPI AutoPay (2% domestic, 0% on UPI under ₹2,000), Stripe for abroad; either needs an Indian entity (sole prop + GST suffices for Razorpay).

## 4. Legal/ops basics

- **Play money is the whole ballgame in India** (PROGA 2025, in force 1 May 2026). No pie purchases, no cash-out, no prizes, no rupee side-bets in the app; say so in the Terms.
- **DPDP Act 2023 + Rules (notified 13 Nov 2025; full compliance by 13 May 2027).** Notice + consent per purpose, a grievance contact, erasure when purpose ends, breach notification, and for under-18s verifiable parental consent. The cheap route is an 18+ gate.
- **GDPR** applies if any EU member joins. Voice in `/talk` is not stored — state it.
- **Cookie consent:** none needed with only strictly-necessary cookies and no third-party analytics.
- **Ship:** Privacy Policy, Terms (play-money clause, 18+, account deletion, organiser powers), one-click delete that anonymises ledger rows, a security contact.

## 5. Hosting/ops at small scale

Vercel Pro ~$20–45/mo; Railway $8–15/mo; Hetzner CX22 €5.83/mo with the existing standalone image; Oracle Always Free ARM was cut on 15 Jun 2026 (fine for staging, not the only production box). Email: Resend free 3K/mo. Push: Web Push/FCM free. LLM: Haiku-class ~$0.05 per active member per month for roast lines; TTS a few cents per `/talk` session. **Budget ≤ $0.20/active user/month all-in; $15–40/mo total to ~5K MAU.** The things that page you at 3am are DB disk and TLS renewals; put both on a managed service.

## 6. Launch playbooks (first 90 days)

- **Wanderlog (2019):** collected friends' itineraries for bubble tea, interviewed 100+ travellers, Launch HN, zero paid ads, growth via shared trips + SEO; $1K MRR at 11 months.
- **Splitwise (2011):** a viral rent calculator, then the settle-up invite loop.
- **Partiful (2020):** link-in-iMessage invites, guests see the page before joining, text blasts, campus orgs; virality via user-made events.
- **Luma:** seeded tech-community hosts; free for organisers, charge the serious ones.
- **BeReal / Locket / NGL:** daily prompt + ambassadors; a widget that made the product visible all day; $50–100 micro-creator seeding.

Common thread: the product's own artifact is the distribution; founders seeded 1–3 real communities by hand; paid channel, if any, <$10K of micro-creators; money came 1–2 years later from the organiser.

## 90-day GTM skeleton

**Days 0–14 — legal and installable.** 18+ gate; Terms with play-money clause; Privacy; delete that scrubs identity but keeps ledger rows; no third-party cookies. iOS install card; production on a $10–25/mo host; Resend, Sentry, daily DB backup. Instrument trips created, members per trip, founding rate.

**Days 15–45 — seed 10 real trips.** Own friend groups plus hand-recruited groups (college WhatsApp groups, office trip planners, r/IndiaTravel "planning a Goa trip" threads). Ship the two loop artifacts: invite OG card showing the board, and a results card that goes straight to WhatsApp. Weekly calls with each trip's organiser.

**Days 46–70 — public web launch.** Launch HN; Product Hunt for the backlink; Reddit/IndieHackers story posts; landing page targeting "bets with friends no money"; three SEO pages; ₹2–5K each to 10–20 Indian micro travel/college creators to post their own trip's board.

**Days 71–90 — decide wrapper and price.** If founding rate ≥ 0.15 and W4 trip retention is good, keep PWA-only and add a founder tier. Only if iOS push or discoverability is the measured blocker, wrap with Capacitor. Budget through day 90: ~$300 infra + ≤$500 creators + $0 ads.

Sources: Apple DMA support page and Aug 2026 EU fee newsroom post; WebKit Safari 26 features; First Round / Saxifrage k-factor benchmarks; NoGood and CNBC on Partiful; Wanderlog founder story; Stormy on NGL seeding; TechCrunch on Locket; Infobip WhatsApp statistics; Razorpay and Stripe India docs; Mondaq / EY / scrut on PROGA and DPDP Rules; InfoQ on Oracle free-tier cuts; vendor pricing pages.
