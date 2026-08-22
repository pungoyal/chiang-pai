// Demo data for local development: one trip, a few members, open predictions
// with positions, and settled history so every screen has something to show.
// Run with: pnpm seed   (uses .env; run migrations first)

import { randomUUID } from "node:crypto";
import {
  addBill,
  createMarket,
  createTrip,
  ensureMember,
  placeBet,
  resolveMarket,
  switchSides,
} from "../lib/data.ts";
import { db } from "../lib/db/index.ts";
import { memberships } from "../lib/db/schema.ts";

async function main() {
  const mk = async (email: string, name: string) => {
    const { member } = await ensureMember(email, name, { termsAccepted: true });
    return member;
  };

  const priya = await mk("priya@example.com", "Priya");
  const arjun = await mk("arjun@example.com", "Arjun");
  const divya = await mk("divya@example.com", "Divya");
  const kiran = await mk("kiran@example.com", "Kiran");

  const trip = await createTrip(priya.id, {
    name: "Chiang Mai, Diwali",
    destination: "TH",
    startsOn: "2026-11-06",
    endsOn: "2026-11-10",
  });
  for (const m of [arjun, divya, kiran]) {
    await db.insert(memberships).values({
      tripId: trip.id,
      memberId: m.id,
      invitedWith: `seed-${randomUUID().slice(0, 8)}`,
    });
  }
  const t = trip.id;

  // Settled 1: who books first.
  const booked = await createMarket(
    t,
    priya.id,
    "Will everyone have flights booked by the end of September?",
    "Every member posts a confirmed booking screenshot in the group by 30 Sept 23:59 IST. One missing resolves NO.",
  );
  await placeBet(priya.id, booked, "yes", 4);
  await placeBet(arjun.id, booked, "no", 6);
  await placeBet(divya.id, booked, "yes", 6);
  await placeBet(kiran.id, booked, "no", 4);
  await resolveMarket(booked, priya.id, "no", "Kiran booked on 3 October. Classic.");

  // Settled 2: with a side switch and a loss for the switcher.
  const visa = await createMarket(
    t,
    arjun.id,
    "Will Thailand still be visa-free for us on the day we land?",
    "Resolves by the rule in force at Suvarnabhumi immigration on 6 Nov. Any stamp without a fee is YES.",
  );
  await placeBet(divya.id, visa, "yes", 8);
  await placeBet(kiran.id, visa, "yes", 2);
  await placeBet(priya.id, visa, "no", 5);
  await switchSides(kiran.id, visa);
  await resolveMarket(
    visa,
    arjun.id,
    "yes",
    "30-day visa-free. Kiran switched at the worst moment.",
  );

  // Settled 3: voided.
  const karaoke = await createMarket(
    t,
    divya.id,
    "Will Arjun sing more than three songs at the Nimman karaoke bar?",
    "Full songs only, judged by me at closing time.",
  );
  await placeBet(priya.id, karaoke, "yes", 3);
  await placeBet(arjun.id, karaoke, "no", 3);
  await resolveMarket(
    karaoke,
    divya.id,
    "refunded",
    "Bar was shut for a private party. No contest.",
  );

  // Open predictions.
  const late = await createMarket(
    t,
    kiran.id,
    "Will Priya be the last to reach the airport?",
    "By the group's own timestamps in chat. Last member through the departure doors resolves YES.",
  );
  await placeBet(kiran.id, late, "yes", 5);
  await placeBet(priya.id, late, "no", 7);
  await placeBet(arjun.id, late, "no", 3);

  const tuk = await createMarket(
    t,
    priya.id,
    "Will anyone get a tuk-tuk from the Night Bazaar to the hotel for under 100 baht?",
    "One ride, whole group or not, under 100 THB after bargaining, receipt or witness. Grab doesn't count.",
  );
  await placeBet(arjun.id, tuk, "yes", 2);

  await createMarket(
    t,
    divya.id,
    "Will anyone actually make the 5 AM Doi Suthep alms round?",
    "Being at the temple steps by 5:15 with a geotagged photo counts. Big talk in the chat does not.",
  );

  await addBill(t, priya.id, {
    onDate: "2026-11-06",
    description: "Hotel deposit, Nimman",
    currency: "thb",
    split: "equal",
    entries: [
      { memberId: priya.id, paidC: 1_200_000, participant: true },
      { memberId: arjun.id, paidC: 0, participant: true },
      { memberId: divya.id, paidC: 0, participant: true },
      { memberId: kiran.id, paidC: 0, participant: true },
    ],
  });

  console.log(`seeded trip ${trip.id}: priya@ / arjun@ / divya@ / kiran@ (example.com)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
