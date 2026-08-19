-- Rows minted before codes were stored hold only a hash, so their links can
-- never be shown again and nothing can be done with the row. They go, which
-- kills any link already sent from one of them.
DELETE FROM "invites" WHERE "code" IS NULL;
--> statement-breakpoint
ALTER TABLE "invites" DROP CONSTRAINT "invites_used_by_members_id_fk";--> statement-breakpoint
-- Dropping code_hash takes the old primary key with it.
ALTER TABLE "invites" DROP COLUMN "code_hash";--> statement-breakpoint
ALTER TABLE "invites" DROP COLUMN "used_at";--> statement-breakpoint
ALTER TABLE "invites" DROP COLUMN "used_by";--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD PRIMARY KEY ("code");
