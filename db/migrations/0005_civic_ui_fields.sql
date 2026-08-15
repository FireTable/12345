CREATE TABLE "review_queue" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ticket_id" varchar(64) NOT NULL,
	"reason" varchar(128) DEFAULT 'LOW_CONFIDENCE' NOT NULL,
	"confidence" integer,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"operator" varchar(64),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "themes" ALTER COLUMN "category" SET DEFAULT '城市管理';--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "pattern_type" varchar(32);--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "ai_confidence" integer;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "first_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "last_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "handling_status" varchar(16) DEFAULT '未处理';--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "handling_progress" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "handling_owner" varchar(64);--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "handling_eta" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "features_json" text;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "radar_json" text;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "trend_pct" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "source_category" varchar(64);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "urgency" varchar(16) DEFAULT 'NORMAL';--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "address" varchar(255);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "confidence" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "primary_theme_id" varchar(64);--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_review_queue_status" ON "review_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_review_queue_ticket_id" ON "review_queue" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_themes_pattern_type" ON "themes" USING btree ("pattern_type");