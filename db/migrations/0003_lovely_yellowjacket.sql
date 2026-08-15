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
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_review_queue_status" ON "review_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_review_queue_ticket_id" ON "review_queue" USING btree ("ticket_id");