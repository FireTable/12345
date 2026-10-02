import postgres from "postgres";

/**
 * PostgreSQL 多租户 Schema 隔离核心管理器
 * 负责在指定 Schema 下自动化创建、初始化与销毁标准政务 12345 业务数据表
 */

export interface CreateRegionParams {
  id: string; // e.g. "shunde", "gz_haizhu"
  name: string; // e.g. "顺德区", "海珠区"
  city: string; // e.g. "佛山市", "广州市"
  province?: string; // e.g. "广东省"
  schemaName: string; // e.g. "region_shunde"
  svgMapPath?: string;
  categoryConfigJson?: string;
  description?: string;
  isDefault?: boolean;
  geojsonBoundary?: string;
}

/**
 * 确保 public.regions 表存在
 */
export async function ensurePublicRegionsTable(sql: postgres.Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS public.regions (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(128) NOT NULL,
      city VARCHAR(128) NOT NULL,
      province VARCHAR(128) NOT NULL DEFAULT '广东省',
      schema_name VARCHAR(64) NOT NULL UNIQUE,
      svg_map_path VARCHAR(255),
      category_config_json TEXT,
      geojson_boundary TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
      is_default BOOLEAN NOT NULL DEFAULT false,
      description TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
  `;
  await sql`ALTER TABLE public.regions ADD COLUMN IF NOT EXISTS geojson_boundary TEXT;`;
  await sql`CREATE INDEX IF NOT EXISTS idx_regions_city ON public.regions (city);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_regions_status ON public.regions (status);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_regions_schema_name ON public.regions (schema_name);`;
}

/**
 * 在目标 Schema 中构建所有标准业务数据表及索引
 */
export async function createTenantTables(sql: postgres.Sql, schemaName: string) {
  // 1. 创建独立 Schema 命名空间
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);

  // 2. 在该 Schema 下执行 DDL 建表脚本
  await sql.begin(async (tx) => {
    // 设置会话级别的 search_path，严格限制在当前目标 schema 下建表
    await tx.unsafe(`SET LOCAL search_path TO "${schemaName}", public;`);

    // 2.1 工单主表 tickets
    await tx`
      CREATE TABLE IF NOT EXISTS tickets (
        id VARCHAR(64) PRIMARY KEY,
        ticket_no VARCHAR(64) NOT NULL UNIQUE,
        title TEXT,
        summarize_title TEXT,
        content TEXT NOT NULL,
        masked_content TEXT,
        citizen_name VARCHAR(64),
        citizen_phone VARCHAR(64),
        province VARCHAR(64),
        city VARCHAR(64),
        district VARCHAR(64),
        subdistrict VARCHAR(64),
        source_category VARCHAR(64),
        ingest_district VARCHAR(64),
        ingest_subdistrict VARCHAR(64),
        ingest_category VARCHAR(64),
        urgency VARCHAR(16) DEFAULT 'NORMAL',
        sla_hours INTEGER,
        stability_risk BOOLEAN,
        canonical_subject VARCHAR(255),
        event_type VARCHAR(128),
        address VARCHAR(255),
        confidence INTEGER,
        primary_theme_id VARCHAR(64),
        channel VARCHAR(64) DEFAULT '市民服务热线',
        status VARCHAR(32) DEFAULT 'PENDING',
        create_time TIMESTAMP WITH TIME ZONE,
        closed_at TIMESTAMP WITH TIME ZONE,
        closure_status VARCHAR(32),
        is_fake_closure BOOLEAN DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
      );
    `;
    await tx`CREATE INDEX IF NOT EXISTS idx_tickets_ticket_no ON tickets (ticket_no);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_tickets_subdistrict ON tickets (subdistrict);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_tickets_create_time ON tickets (create_time);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_tickets_closed_at ON tickets (closed_at);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_tickets_urgency ON tickets (urgency);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_tickets_source_category ON tickets (source_category);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_tickets_primary_theme_id ON tickets (primary_theme_id);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_tickets_status_create_time ON tickets (status, create_time);`;

    // 2.2 多频主题聚类表 themes
    await tx`
      CREATE TABLE IF NOT EXISTS themes (
        id VARCHAR(64) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        canonical_subject VARCHAR(255) NOT NULL,
        canonical_location VARCHAR(255) NOT NULL,
        event_type VARCHAR(128) NOT NULL,
        category VARCHAR(64) DEFAULT '城市管理',
        risk_level VARCHAR(32) DEFAULT 'LOW' NOT NULL,
        risk_reason TEXT,
        ticket_count INTEGER DEFAULT 0 NOT NULL,
        time_span_hours INTEGER DEFAULT 1 NOT NULL,
        ai_summary TEXT,
        recommended_action TEXT,
        pattern_type VARCHAR(32),
        civic_mode VARCHAR(16),
        ai_confidence INTEGER,
        first_at TIMESTAMP WITH TIME ZONE,
        last_at TIMESTAMP WITH TIME ZONE,
        handling_status VARCHAR(16) DEFAULT 'PENDING',
        handling_progress INTEGER DEFAULT 0,
        handling_owner VARCHAR(64),
        handling_eta TIMESTAMP WITH TIME ZONE,
        features_json TEXT,
        radar_json TEXT,
        trend_pct INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
      );
    `;
    await tx`CREATE INDEX IF NOT EXISTS idx_themes_risk_level ON themes (risk_level);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_themes_subject ON themes (canonical_subject);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_themes_pattern_type ON themes (pattern_type);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_themes_ticket_count ON themes (ticket_count);`;

    // 2.3 工单-多频主题关联表 ticket_themes
    await tx`
      CREATE TABLE IF NOT EXISTS ticket_themes (
        ticket_id VARCHAR(64) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        theme_id VARCHAR(64) NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        PRIMARY KEY (ticket_id, theme_id)
      );
    `;
    await tx`CREATE INDEX IF NOT EXISTS idx_tt_ticket_id ON ticket_themes (ticket_id);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_tt_theme_id ON ticket_themes (theme_id);`;

    // 2.4 人工复核队列 review_queue
    await tx`
      CREATE TABLE IF NOT EXISTS review_queue (
        id VARCHAR(64) PRIMARY KEY,
        ticket_id VARCHAR(64) NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        reason VARCHAR(128) DEFAULT 'LOW_CONFIDENCE' NOT NULL,
        confidence INTEGER,
        status VARCHAR(32) DEFAULT 'PENDING' NOT NULL,
        operator VARCHAR(64),
        note TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        reviewed_at TIMESTAMP WITH TIME ZONE
      );
    `;
    await tx`CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue (status);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_review_queue_ticket_id ON review_queue (ticket_id);`;

    // 2.5 官方标准政务词汇表 vocabularies
    await tx`
      CREATE TABLE IF NOT EXISTS vocabularies (
        id VARCHAR(64) PRIMARY KEY,
        type VARCHAR(32) NOT NULL,
        name VARCHAR(128) NOT NULL,
        full_name VARCHAR(255),
        parent_name VARCHAR(128),
        meta_json TEXT,
        description TEXT,
        is_standard BOOLEAN DEFAULT true NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
      );
    `;
    await tx`CREATE INDEX IF NOT EXISTS idx_vocabularies_type ON vocabularies (type);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_vocabularies_name ON vocabularies (name);`;

    // 2.6 别名知识库表 aliases
    await tx`
      CREATE TABLE IF NOT EXISTS aliases (
        id VARCHAR(64) PRIMARY KEY,
        alias VARCHAR(128) NOT NULL UNIQUE,
        canonical VARCHAR(128) NOT NULL,
        type VARCHAR(32) DEFAULT 'ENTITY' NOT NULL,
        source VARCHAR(32) DEFAULT 'PRESET' NOT NULL,
        usage_count INTEGER DEFAULT 0 NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
      );
    `;
    await tx`CREATE INDEX IF NOT EXISTS idx_aliases_alias ON aliases (alias);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_aliases_canonical ON aliases (canonical);`;
    await tx`CREATE INDEX IF NOT EXISTS idx_aliases_type ON aliases (type);`;

    // 2.7 异步任务进度表 task_progress
    await tx`
      CREATE TABLE IF NOT EXISTS task_progress (
        task_id VARCHAR(128) PRIMARY KEY,
        status VARCHAR(32) DEFAULT 'PENDING' NOT NULL,
        stage VARCHAR(32) DEFAULT 'EXTRACTING' NOT NULL,
        stage_text TEXT DEFAULT '准备就绪' NOT NULL,
        percent INTEGER DEFAULT 0 NOT NULL,
        total INTEGER DEFAULT 0 NOT NULL,
        processed INTEGER DEFAULT 0 NOT NULL,
        extracted_count INTEGER DEFAULT 0 NOT NULL,
        theme_count INTEGER DEFAULT 0 NOT NULL,
        review_count INTEGER DEFAULT 0 NOT NULL,
        failed_count INTEGER DEFAULT 0 NOT NULL,
        error TEXT,
        region_id VARCHAR(64),
        heartbeat_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
      );
    `;
    await tx`CREATE INDEX IF NOT EXISTS idx_task_progress_status ON task_progress (status);`;
  });
}

/**
 * 完整新建一个地区站点（在 public.regions 注册并初始化独立 Schema）
 */
export async function registerRegion(sql: postgres.Sql, params: CreateRegionParams) {
  await ensurePublicRegionsTable(sql);

  // 1. 初始化独立 Schema 及数据表
  await createTenantTables(sql, params.schemaName);

  // 2. 若设为默认，先重置其他站点的 is_default
  if (params.isDefault) {
    await sql`UPDATE public.regions SET is_default = false WHERE is_default = true;`;
  }

  // 3. 注册到花名册
  await sql`
    INSERT INTO public.regions (
      id, name, city, province, schema_name, svg_map_path, geojson_boundary, category_config_json, description, is_default, status, updated_at
    ) VALUES (
      ${params.id},
      ${params.name},
      ${params.city},
      ${params.province || "广东省"},
      ${params.schemaName},
      ${params.svgMapPath || null},
      ${params.geojsonBoundary || null},
      ${params.categoryConfigJson || null},
      ${params.description || null},
      ${params.isDefault ?? false},
      'ACTIVE',
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      city = EXCLUDED.city,
      province = EXCLUDED.province,
      schema_name = EXCLUDED.schema_name,
      svg_map_path = COALESCE(EXCLUDED.svg_map_path, public.regions.svg_map_path),
      geojson_boundary = COALESCE(EXCLUDED.geojson_boundary, public.regions.geojson_boundary),
      category_config_json = COALESCE(EXCLUDED.category_config_json, public.regions.category_config_json),
      description = EXCLUDED.description,
      is_default = EXCLUDED.is_default,
      status = 'ACTIVE',
      updated_at = now();
  `;
}

/**
 * 物理销毁一个地区 Schema 及其所有数据
 */
export async function destroyRegionTenant(sql: postgres.Sql, regionId: string) {
  const [region] = await sql<Array<{ schema_name: string }>>`
    SELECT schema_name FROM public.regions WHERE id = ${regionId};
  `;
  if (!region) return false;

  await sql.unsafe(`DROP SCHEMA IF EXISTS "${region.schema_name}" CASCADE;`);
  await sql`DELETE FROM public.regions WHERE id = ${regionId};`;
  return true;
}
