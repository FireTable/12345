CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname = 'public' OR nspname LIKE 'region\_%' ESCAPE '\'
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = sch AND table_name = 'tickets'
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_title_trgm ON %I.tickets USING gin (title gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_summarize_title_trgm ON %I.tickets USING gin (summarize_title gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_content_trgm ON %I.tickets USING gin (content gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_canonical_subject_trgm ON %I.tickets USING gin (canonical_subject gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_address_trgm ON %I.tickets USING gin (address gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_ticket_no_trgm ON %I.tickets USING gin (ticket_no gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_subdistrict_trgm ON %I.tickets USING gin (subdistrict gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_district_trgm ON %I.tickets USING gin (district gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_source_category_trgm ON %I.tickets USING gin (source_category gin_trgm_ops)', sch);

      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_subdistrict_create_time ON %I.tickets (subdistrict, create_time DESC)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_create_time_id_desc ON %I.tickets (create_time DESC, id DESC)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_primary_theme_create_time ON %I.tickets (primary_theme_id, create_time DESC)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_fake_closure_true ON %I.tickets (create_time DESC) WHERE is_fake_closure = true', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tickets_stability_risk_true ON %I.tickets (create_time DESC) WHERE stability_risk = true', sch);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname = 'public' OR nspname LIKE 'region\_%' ESCAPE '\'
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = sch AND table_name = 'themes'
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_themes_title_trgm ON %I.themes USING gin (title gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_themes_canonical_subject_trgm ON %I.themes USING gin (canonical_subject gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_themes_canonical_location_trgm ON %I.themes USING gin (canonical_location gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_themes_event_type_trgm ON %I.themes USING gin (event_type gin_trgm_ops)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_themes_category_trgm ON %I.themes USING gin (category gin_trgm_ops)', sch);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname = 'public' OR nspname LIKE 'region\_%' ESCAPE '\'
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = sch AND table_name = 'review_queue'
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_review_queue_status_created_at ON %I.review_queue (status, created_at DESC, id DESC)', sch);
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_review_queue_created_at_desc ON %I.review_queue (created_at DESC, id DESC)', sch);
    END IF;
  END LOOP;
END $$;
