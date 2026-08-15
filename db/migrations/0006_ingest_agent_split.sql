ALTER TABLE "themes" ADD COLUMN "civic_mode" varchar(16);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ingest_district" varchar(64);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ingest_subdistrict" varchar(64);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ingest_category" varchar(64);