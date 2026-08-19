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
  const promoted = await promoteConfiguredFounders();
  logger.info({ promoted }, "bootstrap founders reconciled");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "migration failed");
  process.exit(1);
});
