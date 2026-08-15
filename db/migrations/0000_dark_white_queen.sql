CREATE TABLE "themes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"canonical_subject" varchar(255) NOT NULL,
	"canonical_location" varchar(255) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"category" varchar(64) DEFAULT '综合民生',
	"risk_level" varchar(32) DEFAULT 'LOW' NOT NULL,
	"risk_reason" text,
	"ticket_count" integer DEFAULT 0 NOT NULL,
	"time_span_hours" integer DEFAULT 1 NOT NULL,
	"ai_summary" text,
	"recommended_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_themes" (
	"ticket_id" varchar(64) NOT NULL,
	"theme_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_themes_ticket_id_theme_id_pk" PRIMARY KEY("ticket_id","theme_id")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"ticket_no" varchar(64) NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"citizen_name" varchar(64),
	"citizen_phone" varchar(64),
	"district" varchar(64),
	"subdistrict" varchar(64),
	"channel" varchar(64) DEFAULT '市民服务热线',
	"status" varchar(32) DEFAULT 'PENDING',
	"create_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_ticket_no_unique" UNIQUE("ticket_no")
);
--> statement-breakpoint
ALTER TABLE "ticket_themes" ADD CONSTRAINT "ticket_themes_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_themes" ADD CONSTRAINT "ticket_themes_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_themes_risk_level" ON "themes" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "idx_themes_subject" ON "themes" USING btree ("canonical_subject");--> statement-breakpoint
CREATE INDEX "idx_tt_ticket_id" ON "ticket_themes" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_tt_theme_id" ON "ticket_themes" USING btree ("theme_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_ticket_no" ON "tickets" USING btree ("ticket_no");--> statement-breakpoint
CREATE INDEX "idx_tickets_subdistrict" ON "tickets" USING btree ("subdistrict");--> statement-breakpoint
CREATE INDEX "idx_tickets_create_time" ON "tickets" USING btree ("create_time");