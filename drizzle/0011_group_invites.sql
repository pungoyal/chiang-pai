ALTER TABLE "invites" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "is_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Rows that predate use_count were single-use and are spent iff used_at is set.
UPDATE "invites" SET "use_count" = 1 WHERE "used_at" IS NOT NULL;
