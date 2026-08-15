CREATE INDEX IF NOT EXISTS "idx_tickets_status" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_urgency" ON "tickets" USING btree ("urgency");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_source_category" ON "tickets" USING btree ("source_category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_primary_theme_id" ON "tickets" USING btree ("primary_theme_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_status_create_time" ON "tickets" USING btree ("status","create_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_themes_ticket_count" ON "themes" USING btree ("ticket_count");
