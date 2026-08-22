// The numbers the go-to-market plan turns on, straight from the database.
// Nothing here is stored — it is the same derivation the app would make.
// Run with: pnpm stats

import { platformStats } from "../lib/data.ts";

async function main() {
  const s = await platformStats();
  const rate = s.invited ? ((100 * s.invitedThenFounded) / s.invited).toFixed(1) : "—";
  console.log(`members            ${s.members}`);
  console.log(`trips              ${s.trips}  (${s.tripsWithCompany} with ≥2 members)`);
  console.log(`mean roster        ${s.meanRoster.toFixed(1)}`);
  console.log(`invited → founded  ${s.invitedThenFounded} / ${s.invited}  (${rate}%)`);
  console.log(`predictions        ${s.marketsOpen} open, ${s.marketsResolved} resolved`);
  console.log(`bills              ${s.billsLogged}`);
  console.log(`phrases kept       ${s.phrasesKept}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
