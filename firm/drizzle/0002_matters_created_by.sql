ALTER TABLE "matters" ADD COLUMN "created_by" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "matters" ADD CONSTRAINT "matters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matters_created_by_idx" ON "matters" USING btree ("created_by");