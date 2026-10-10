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
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = sch AND table_name = 'tickets'
    ) THEN
      EXECUTE format('ALTER TABLE %I.tickets ADD COLUMN IF NOT EXISTS sla_hours integer', sch);
      EXECUTE format('ALTER TABLE %I.tickets ADD COLUMN IF NOT EXISTS stability_risk boolean', sch);
      EXECUTE format('ALTER TABLE %I.tickets ADD COLUMN IF NOT EXISTS canonical_subject varchar(255)', sch);
      EXECUTE format('ALTER TABLE %I.tickets ADD COLUMN IF NOT EXISTS event_type varchar(128)', sch);
    END IF;
  END LOOP;
END $$;
