// One-shot migration runner. Used by the `migrate` docker compose service
// (runs and exits) and by `npm run db:migrate` locally.
// Run with: node --env-file=.env scripts/migrate.ts   (env file optional)

import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { promoteConfiguredFounders } from "../lib/data.ts";
import { db } from "../lib/db/index.ts";
import { logger } from "../lib/logger.ts";

async function main() {
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  logger.info("migrations applied");

  // Who founds lives in members.is_founder, which no SQL migration can fill in
  // — it would have to read the environment. So the bootstrap is reconciled
  // here instead, in the same one-shot step, right after the column exists.
  const { promoted, founders, members } = await promoteConfiguredFounders();
  logger.info({ promoted, founders, members }, "bootstrap founders reconciled");

  // A table with members and no founders is one nobody can invite into and no
  // lost passkey can be recovered from — fixable only by hand, in SQL. It is
  // reachable exactly one way: deploying with FOUNDING_MEMBERS unset or
  // pointing at addresses nobody signed in with. Say so loudly rather than
  // letting it be discovered the day somebody needs a way back in.
  if (members > 0 && founders === 0) {
    logger.error(
      { members },
      "no founding members: set FOUNDING_MEMBERS to an address one of them signed in with and run this again",
    );
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "migration failed");
  process.exit(1);
});
