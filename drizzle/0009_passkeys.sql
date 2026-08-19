CREATE TABLE "credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"alg" integer NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credentials_member_idx" ON "credentials" USING btree ("member_id");