-- Trips: the one group this deploy used to be becomes Trip #1, and everything
-- it owned — markets, pies, bills, invites, kept phrases — is scoped to it.
-- Hand-finished from drizzle-kit's diff so that no row is lost: every new
-- NOT NULL column is added nullable, backfilled, then tightened.
CREATE TYPE "public"."membership_role" AS ENUM('organiser', 'member');--> statement-breakpoint
CREATE TABLE "trips" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"destination" text NOT NULL,
	"home_language" text DEFAULT 'en' NOT NULL,
	"home_currency" text NOT NULL,
	"foreign_currency" text,
	"starts_on" date,
	"ends_on" date,
	"max_stake_pies" integer DEFAULT 10 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"trip_id" text NOT NULL,
	"member_id" text NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_with" text,
	"inbox_seen_at" timestamp with time zone,
	CONSTRAINT "memberships_trip_id_member_id_pk" PRIMARY KEY("trip_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_member_idx" ON "memberships" USING btree ("member_id");--> statement-breakpoint
-- Trip #1: the group that was here. Created by the earliest founder (or the
-- earliest member), pointed at Thailand, settling in rupees — what the old
-- GROUP_DESTINATION / currency enum defaulted to. Rename it from /t/<id>.
INSERT INTO "trips" ("id", "name", "destination", "home_language", "home_currency", "foreign_currency", "created_by", "created_at")
SELECT 'chiang-mai', 'Chiang Mai', 'TH', 'en', 'inr', 'thb', m."id", m."joined_at"
FROM "members" m
ORDER BY m."is_founder" DESC, m."joined_at" ASC
LIMIT 1;--> statement-breakpoint
INSERT INTO "memberships" ("trip_id", "member_id", "role", "joined_at", "inbox_seen_at")
SELECT 'chiang-mai', m."id", CASE WHEN m."is_founder" THEN 'organiser'::"membership_role" ELSE 'member'::"membership_role" END, m."joined_at", m."inbox_seen_at"
FROM "members" m;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "trip_id" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "trip_id" text;--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "trip_id" text;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "trip_id" text;--> statement-breakpoint
ALTER TABLE "phrases" ADD COLUMN "trip_id" text;--> statement-breakpoint
UPDATE "bills" SET "trip_id" = 'chiang-mai';--> statement-breakpoint
UPDATE "invites" SET "trip_id" = 'chiang-mai';--> statement-breakpoint
UPDATE "ledger" SET "trip_id" = 'chiang-mai';--> statement-breakpoint
UPDATE "markets" SET "trip_id" = 'chiang-mai';--> statement-breakpoint
UPDATE "phrases" SET "trip_id" = 'chiang-mai';--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "trip_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "trip_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger" ALTER COLUMN "trip_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "trip_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "phrases" ALTER COLUMN "trip_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phrases" ADD CONSTRAINT "phrases_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bills_trip_idx" ON "bills" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "ledger_trip_member_idx" ON "ledger" USING btree ("trip_id","member_id");--> statement-breakpoint
CREATE INDEX "markets_trip_idx" ON "markets" USING btree ("trip_id");--> statement-breakpoint
-- Phrasebooks were per member and are now per trip, so two members' "taxi"
-- phrases would collide: the later one gets a numbered slug, as uniqueSlug
-- would have given it.
UPDATE "phrases" p SET "slug" = p."slug" || '-' || d.n
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "trip_id", "slug" ORDER BY "created_at", "id") AS n
	FROM "phrases"
) d
WHERE d."id" = p."id" AND d.n > 1;--> statement-breakpoint
DROP INDEX "phrases_member_idx";--> statement-breakpoint
DROP INDEX "phrases_member_slug_idx";--> statement-breakpoint
CREATE INDEX "phrases_trip_idx" ON "phrases" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "phrases_trip_slug_idx" ON "phrases" USING btree ("trip_id","slug");--> statement-breakpoint
-- The currency column becomes text: which two a trip spends is the trip's
-- business now, not a Postgres enum's.
ALTER TABLE "bill_revisions" ALTER COLUMN "currency" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "inbox_seen_at";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "is_founder";
