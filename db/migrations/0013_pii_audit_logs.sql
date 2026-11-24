-- 0013_pii_audit_logs.sql
-- 幂等迁移：在 public schema 创建 PII 按需明文查看留痕审计表 `public.pii_audit_logs` 及查询索引。
-- 可通过 `pnpm exec tsx scripts/db-migrate.ts` 或 `psql -v ON_ERROR_STOP=1 -f db/migrations/0013_pii_audit_logs.sql` 幂等执行。

CREATE TABLE IF NOT EXISTS "public"."pii_audit_logs" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "region_id" varchar(64) NOT NULL,
  "ticket_id" varchar(64) NOT NULL,
  "ticket_no" varchar(64),
  "actor_user_id" text NOT NULL,
  "actor_name" varchar(128) NOT NULL,
  "actor_role" varchar(32) NOT NULL DEFAULT 'admin',
  "reason" text NOT NULL,
  "fields_revealed" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "ip_address" varchar(128),
  "user_agent" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pii_audit_logs_region_ticket_created"
  ON "public"."pii_audit_logs" USING btree ("region_id", "ticket_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pii_audit_logs_actor_created"
  ON "public"."pii_audit_logs" USING btree ("actor_user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pii_audit_logs_created_at"
  ON "public"."pii_audit_logs" USING btree ("created_at" DESC);
