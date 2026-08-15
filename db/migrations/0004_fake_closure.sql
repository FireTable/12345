ALTER TABLE "tickets" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "closure_status" varchar(32);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "is_fake_closure" boolean DEFAULT false;--> statement-breakpoint
CREATE INDEX "idx_tickets_closed_at" ON "tickets" USING btree ("closed_at");