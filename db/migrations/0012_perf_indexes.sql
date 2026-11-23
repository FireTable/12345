-- 0012_perf_indexes.sql
-- 幂等性能优化迁移：
-- 1. 新增 tickets.is_missing_info 预计算列 + BEFORE INSERT/UPDATE 触发器 + 增量回填 + 部分索引，彻底消除全表 POSIX 正则扫描
-- 2. 新增 tab=pending 置顶部分索引与 (status, create_time DESC, id DESC) 复合索引
-- 3. 新增 loadClusterBundle / loadOverview / loadWorkorderStats / loadTrends 覆盖索引，大幅降低堆表 I/O
--
-- 可通过 `pnpm exec tsx scripts/db-migrate.ts` 或 `psql -v ON_ERROR_STOP=1 -f db/migrations/0012_perf_indexes.sql` 幂等执行。
-- 建议在存量大表首次迁移完成后对各租户表执行 `VACUUM ANALYZE <schema>.tickets;` 以立即刷亮 Visibility Map 获得纯 Index-Only Scan。

CREATE OR REPLACE FUNCTION public.compute_ticket_is_missing_info(
  p_status text,
  p_address text,
  p_subdistrict text,
  p_canonical_subject text,
  p_is_ecommerce boolean
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_ws constant text := E' \t\n\r\x0b\x0c\u3000\u00a0\ufeff\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f';
  v_status text;
  v_sub text;
  v_addr text;
  v_subj text;
BEGIN
  v_status := upper(btrim(coalesce(p_status, 'PENDING'), v_ws));
  IF v_status IN ('RESOLVED', 'FINISHED', 'CLOSED', '已办结', '办结') THEN
    RETURN FALSE;
  END IF;

  IF p_subdistrict IS NULL THEN
    RETURN TRUE;
  END IF;
  v_sub := btrim(p_subdistrict, v_ws);
  IF v_sub = '' THEN
    RETURN TRUE;
  END IF;

  IF p_address IS NULL THEN
    RETURN TRUE;
  END IF;
  v_addr := btrim(p_address, v_ws);
  IF v_addr = '' OR v_addr = v_sub OR (coalesce(p_is_ecommerce, false) AND char_length(v_addr) <= 6) THEN
    RETURN TRUE;
  END IF;

  IF p_canonical_subject IS NULL THEN
    RETURN TRUE;
  END IF;
  v_subj := btrim(p_canonical_subject, v_ws);
  IF v_subj = '' THEN
    RETURN TRUE;
  END IF;

  IF lower(v_subj) = ANY (ARRAY[
    '涉事方', '相关主体', '未知', '不详', '无', '空', 'null', 'undefined', 'n/a',
    '市民', '车主', '商家', '商铺', '店铺', '店主', '单位', '某单位', '某店铺',
    '某商家', '某公司', '某企业', '某工厂', '某餐厅', '某餐馆', '买家', '卖家',
    '消费者', '顾客', '客户', '客服', '外包客服', '平台客服', '当事人', '反映人',
    '诉求人', '投诉人', '业主', '租客', '物业', '部门', '相关单位', '相关部门',
    '涉事单位', '涉事店铺', '涉事商家', '涉事主体', '涉事车辆', '车辆', '司机',
    '小贩', '摊贩', '咨询市民', '催办诉求人', '无名', '不知名'
  ]) THEN
    RETURN TRUE;
  END IF;

  IF v_subj ~ '(?:涉事方|责任主体|责任对象)$'
     OR v_subj ~ '^(?:某|该|这|那|一)?(?:家|位|个)?(?:我的|涉事|相关)?(?:单位|店铺|商铺|商店|商家|公司|企业|工厂|工地|餐厅|餐馆|饭店|超市|物业|快递|物流|商品|客服|卖家|买家|车主|市民|车辆)$' THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.trg_tickets_sync_missing_info()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_ecommerce boolean := (TG_NARGS > 0 AND lower(coalesce(TG_ARGV[0], 'false')) = 'true');
BEGIN
  NEW.is_missing_info := public.compute_ticket_is_missing_info(
    NEW.status,
    NEW.address,
    NEW.subdistrict,
    NEW.canonical_subject,
    v_is_ecommerce
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  sch text;
  has_regions boolean;
  cfg_text text;
  cfg_json jsonb;
  is_ecom boolean;
  ecom_arg text;
  needs_backfill boolean;
  did_ddl_or_update boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'regions'
  ) INTO has_regions;

  FOR sch IN
    SELECT nspname
    FROM pg_namespace
    WHERE nspname = 'public' OR nspname LIKE 'region\_%' ESCAPE '\'
    ORDER BY nspname
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = sch AND table_name = 'tickets'
    ) THEN
      is_ecom := false;
      cfg_text := NULL;
      did_ddl_or_update := false;

      IF has_regions THEN
        SELECT r.category_config_json
        INTO cfg_text
        FROM public.regions r
        WHERE r.schema_name = sch
        LIMIT 1;

        IF cfg_text IS NOT NULL AND btrim(cfg_text) <> '' THEN
          BEGIN
            cfg_json := cfg_text::jsonb;
            IF coalesce(cfg_json->'domainProfile'->>'domainType', cfg_json->>'domainType', '') = 'ECOMMERCE_CS' THEN
              is_ecom := true;
            END IF;
          EXCEPTION WHEN others THEN
            IF cfg_text LIKE '%"domainType":"ECOMMERCE_CS"%'
               OR cfg_text LIKE '%"domainType": "ECOMMERCE_CS"%' THEN
              is_ecom := true;
            END IF;
          END;
        ELSIF NOT EXISTS (SELECT 1 FROM public.regions r WHERE r.schema_name = sch)
              AND sch ILIKE '%ecom%' THEN
          is_ecom := true;
        END IF;
      ELSIF sch ILIKE '%ecom%' THEN
        is_ecom := true;
      END IF;

      ecom_arg := CASE WHEN is_ecom THEN 'true' ELSE 'false' END;

      -- 仅当列尚不存在，或触发器缺失/域参数(gov vs ecom)发生变化时才执行存量回填，避免重复跑 db-migrate 时全表扫描
      SELECT NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = sch AND table_name = 'tickets' AND column_name = 'is_missing_info'
      ) INTO needs_backfill;

      IF NOT needs_backfill THEN
        SELECT NOT EXISTS (
          SELECT 1
          FROM pg_trigger tg
          JOIN pg_class c ON c.oid = tg.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = sch
            AND c.relname = 'tickets'
            AND tg.tgname = 'trg_tickets_sync_missing_info'
            AND NOT tg.tgisinternal
            AND tg.tgargs = (convert_to(ecom_arg, 'UTF8') || '\x00'::bytea)
        ) INTO needs_backfill;
      END IF;

      -- 1. 确保 updated_at 与 is_missing_info 列存在
      EXECUTE format(
        'ALTER TABLE %I.tickets ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now()',
        sch
      );
      EXECUTE format(
        'ALTER TABLE %I.tickets ADD COLUMN IF NOT EXISTS is_missing_info boolean NOT NULL DEFAULT false',
        sch
      );

      -- 2. 需要回填时：先卸旧触发器，仅回填发生变化的存量行，再挂载固化了 is_ecommerce 参数的触发器
      IF needs_backfill THEN
        did_ddl_or_update := true;
        EXECUTE format(
          'DROP TRIGGER IF EXISTS trg_tickets_sync_missing_info ON %I.tickets',
          sch
        );
        EXECUTE format(
          'UPDATE %I.tickets
             SET is_missing_info = public.compute_ticket_is_missing_info(status, address, subdistrict, canonical_subject, %L::boolean)
           WHERE is_missing_info IS DISTINCT FROM public.compute_ticket_is_missing_info(status, address, subdistrict, canonical_subject, %L::boolean)',
          sch, is_ecom, is_ecom
        );
        EXECUTE format(
          'CREATE TRIGGER trg_tickets_sync_missing_info
             BEFORE INSERT OR UPDATE OF status, address, subdistrict, canonical_subject, is_missing_info
             ON %I.tickets
             FOR EACH ROW
             EXECUTE FUNCTION public.trg_tickets_sync_missing_info(%L)',
          sch, ecom_arg
        );
      END IF;

      -- 3. missing_info 部分索引（消除正则全表扫描）
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_tickets_missing_info_ct
           ON %I.tickets (create_time DESC, id DESC)
           WHERE is_missing_info = true',
        sch
      );

      -- 4. tab=pending 与状态筛选排序索引
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_tickets_status_create_time_id_desc
           ON %I.tickets (status, create_time DESC, id DESC)
           INCLUDE (is_fake_closure)',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_tickets_reopened_updated_at
           ON %I.tickets (updated_at DESC NULLS LAST, create_time DESC, id DESC)
           WHERE status = ''REOPENED''',
        sch
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_tickets_fake_closure_pending
           ON %I.tickets (updated_at DESC NULLS LAST, create_time DESC, id DESC)
           WHERE is_fake_closure IS TRUE AND status IN (''PENDING'', ''REOPENED'')',
        sch
      );

      -- 5. loadClusterBundle 关联覆盖索引（ticket_themes INNER JOIN tickets 走 Index-Only Scan）
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_tickets_id_subd_status
           ON %I.tickets (id)
           INCLUDE (subdistrict, status)',
        sch
      );

      -- 6. loadOverview / loadWorkorderStats / loadTrends 统一统计覆盖索引
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_tickets_stats_cover
           ON %I.tickets (create_time)
           INCLUDE (subdistrict, source_category, status, urgency, confidence, primary_theme_id, closed_at, is_fake_closure, is_missing_info)',
        sch
      );

      IF did_ddl_or_update THEN
        EXECUTE format('ANALYZE %I.tickets', sch);
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = sch AND table_name = 'themes'
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = sch AND tablename = 'themes' AND indexname = 'idx_themes_created_at'
      ) THEN
        EXECUTE format(
          'CREATE INDEX IF NOT EXISTS idx_themes_created_at ON %I.themes (created_at)',
          sch
        );
        EXECUTE format('ANALYZE %I.themes', sch);
      END IF;
    END IF;
  END LOOP;
END $$;
