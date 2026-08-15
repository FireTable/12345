CREATE TABLE "aliases" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"alias" varchar(128) NOT NULL,
	"canonical" varchar(128) NOT NULL,
	"type" varchar(32) DEFAULT 'ENTITY' NOT NULL,
	"source" varchar(32) DEFAULT 'PRESET' NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aliases_alias_unique" UNIQUE("alias")
);
--> statement-breakpoint
CREATE TABLE "vocabularies" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"type" varchar(32) NOT NULL,
	"name" varchar(128) NOT NULL,
	"full_name" varchar(255),
	"parent_name" varchar(128),
	"meta_json" text,
	"description" text,
	"is_standard" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_aliases_alias" ON "aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "idx_aliases_canonical" ON "aliases" USING btree ("canonical");--> statement-breakpoint
CREATE INDEX "idx_aliases_type" ON "aliases" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_vocabularies_type" ON "vocabularies" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_vocabularies_name" ON "vocabularies" USING btree ("name");