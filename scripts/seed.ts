// Demo data for local development: a few members, open markets with positions,
// and settled history so every screen has something to show.
// Run with: npm run seed   (uses .env; run migrations first)

import { createMarket, ensureMember, placeBet, resolveMarket, switchSides } from "../lib/data.ts";

async function main() {
  const mk = async (email: string, name: string) => {
    const m = await ensureMember(email, name, { bypassAllowlist: true });
    if (!m) throw new Error(`could not create ${email}`);
    return m;
  };

  const priya = await mk("priya@example.com", "Priya");
  const arjun = await mk("arjun@example.com", "Arjun");
  const divya = await mk("divya@example.com", "Divya");
  const kiran = await mk("kiran@example.com", "Kiran");

  // Settled market 1: the Sunday dosa queue.
  const dosa = await createMarket(
    priya.id,
    "Will the Vidyarthi Bhavan queue reach the footpath by 9 AM on Sunday?",
    "I'll be there at 9:00 AM sharp and count people waiting outside the door, photo as evidence. Queue touching the footpath resolves YES; shorter resolves NO.",
  );
  await placeBet(priya.id, dosa, "yes", 4);
  await placeBet(arjun.id, dosa, "no", 6);
  await placeBet(divya.id, dosa, "yes", 6);
  await placeBet(kiran.id, dosa, "no", 4);
  await resolveMarket(
    dosa,
    priya.id,
    "yes",
    "Queue was halfway down the road at 8:50 already. Photo in the group chat.",
  );

  // Settled market 2: with a side switch and a loss for the switcher.
  const rain = await createMarket(
    arjun.id,
    "Will it rain in Jayanagar before Sunday midnight?",
    "Any rain visible from my 4th Block terrace before Sunday 23:59 counts, however brief. A wet road counts. I'm the observer.",
  );
  await placeBet(divya.id, rain, "yes", 8);
  await placeBet(kiran.id, rain, "yes", 2);
  await placeBet(priya.id, rain, "no", 5);
  await switchSides(kiran.id, rain);
  await resolveMarket(
    rain,
    arjun.id,
    "yes",
    "Proper downpour on Saturday evening. Kiran switched at the worst possible moment.",
  );

  // Settled market 3: voided.
  const karaoke = await createMarket(
    divya.id,
    "Will Arjun sing more than three songs at karaoke on Friday?",
    "Full songs only, judged by me at closing time.",
  );
  await placeBet(priya.id, karaoke, "yes", 3);
  await placeBet(arjun.id, karaoke, "no", 3);
  await resolveMarket(
    karaoke,
    divya.id,
    "refunded",
    "Power cut at the venue all evening. No karaoke, no contest — swalpa adjust maadi.",
  );

  // Open markets.
  const silkBoard = await createMarket(
    kiran.id,
    "Will crossing Silk Board take more than 45 minutes at 6 PM tomorrow?",
    "I'll screenshot Google Maps at 6:00 PM sharp for the BTM-to-HSR route over the junction. An estimate of 46 minutes or more resolves YES.",
  );
  await placeBet(kiran.id, silkBoard, "yes", 5);
  await placeBet(priya.id, silkBoard, "no", 7);
  await placeBet(arjun.id, silkBoard, "no", 3);

  const activa = await createMarket(
    priya.id,
    "Will Divya's Activa start on the first try on Monday morning?",
    "First attempt only, witnessed by at least one other member. Engine catching and staying on for 5 seconds counts.",
  );
  await placeBet(arjun.id, activa, "yes", 2);

  await createMarket(
    divya.id,
    "Will anyone in the group actually make the 6 AM Lalbagh walk on Saturday?",
    "Being inside a Lalbagh gate by 6:15 AM counts, geotagged photo as evidence. Big talk in the group chat does not count.",
  );

  console.log("seeded namma demo adda: priya@ / arjun@ / divya@ / kiran@ (example.com)");
  process.exit(0);
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
