// The failsafe. Mints a recovery link straight against the database, for the
// one situation the app itself cannot answer: nobody who could mint one can
// sign in — every organiser has lost their passkeys too, and there is no way
// back into the table from any browser.
//
// This is not a backdoor so much as an admission of where the trust already
// sits: whoever can run this holds DATABASE_URL, and could write the
// credentials row by hand. What it adds is that they don't have to, and that
// the link it prints is spent, timed, and announced on the members page like
// any other — `minted_by` is null, and the table is told it came from here.
//
// Run with: node --env-file-if-exists=.env scripts/recovery-link.ts "Priya"
// (a member's name, or their id). Then read the URL down the phone.

import { isNull } from "drizzle-orm";
import { mintRecoveryFromConsole } from "../lib/data.ts";
import { db } from "../lib/db/index.ts";
import { members } from "../lib/db/schema.ts";
import { env } from "../lib/env.ts";
import { recoveryUrl } from "../lib/recovery.ts";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const query = process.argv[2]?.trim();
  const everyone = await db.select().from(members).where(isNull(members.deletedAt));

  if (!query) {
    console.error("Usage: node --env-file-if-exists=.env scripts/recovery-link.ts <name or id>\n");
    console.error("At the table:");
    for (const m of everyone) console.error(`  ${m.name}  (${m.id})`);
    process.exit(1);
  }

  const lower = query.toLowerCase();
  const matches = everyone.filter((m) => m.id === query || m.name.toLowerCase() === lower);
  if (matches.length === 0) fail(`No member called "${query}". Run with no argument to list them.`);
  // Names are distinct per trip (lib/mentions.ts), not across the world, so
  // this is the wrong place to assume it: handing the link to the wrong seat is unrecoverable.
  if (matches.length > 1) {
    fail(
      `More than one member matches "${query}" — pass the id instead:\n${matches.map((m) => `  ${m.name}  (${m.id})`).join("\n")}`,
    );
  }

  const member = matches[0];
  const code = await mintRecoveryFromConsole(member.id);

  console.log(`\nRecovery link for ${member.name}:\n`);
  console.log(`  ${recoveryUrl(env.AUTH_URL, code)}\n`);
  console.log("Good for thirty minutes and one passkey. Any link minted for them before this");
  console.log("one is now dead, and this one is on the members page for everyone to see.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
