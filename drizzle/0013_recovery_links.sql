CREATE TABLE "recoveries" (
	"code" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"minted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_minted_by_members_id_fk" FOREIGN KEY ("minted_by") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recoveries_member_idx" ON "recoveries" USING btree ("member_id");