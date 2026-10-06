import {
  pgTable,
  varchar,
  text,
  integer,
  timestamp,
  index,
  primaryKey,
  boolean,
} from "drizzle-orm/pg-core";

/**
 * 0. 区域/站点注册花名册表 (Regions Registry Table, in public schema)
 */
export const regionsTable = pgTable(
  "regions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    city: varchar("city", { length: 128 }).notNull(),
    province: varchar("province", { length: 128 }).default("广东省").notNull(),
    schemaName: varchar("schema_name", { length: 64 }).notNull().unique(),
    svgMapPath: varchar("svg_map_path", { length: 255 }),
    categoryConfigJson: text("category_config_json"),
    geojsonBoundary: text("geojson_boundary"),
    subdistrictsGeojson: text("subdistricts_geojson"),
    status: varchar("status", { length: 32 }).default("ACTIVE").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_regions_city").on(table.city),
    index("idx_regions_status").on(table.status),
    index("idx_regions_schema_name").on(table.schemaName),
  ]
);

export type RegionRecord = typeof regionsTable.$inferSelect;
export type NewRegionRecord = typeof regionsTable.$inferInsert;

/**
 * 1. 工单主表 (Tickets Table)
 */
export const ticketsTable = pgTable(
  "tickets",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ticketNo: varchar("ticket_no", { length: 64 }).notNull().unique(),
    title: text("title"),
    summarizeTitle: text("summarize_title"),
    content: text("content").notNull(),
    maskedContent: text("masked_content"),
    citizenName: varchar("citizen_name", { length: 64 }),
    citizenPhone: varchar("citizen_phone", { length: 64 }),
    province: varchar("province", { length: 64 }),
    city: varchar("city", { length: 64 }),
    district: varchar("district", { length: 64 }),
    subdistrict: varchar("subdistrict", { length: 64 }),
    sourceCategory: varchar("source_category", { length: 64 }),
    ingestDistrict: varchar("ingest_district", { length: 64 }),
    ingestSubdistrict: varchar("ingest_subdistrict", { length: 64 }),
    ingestCategory: varchar("ingest_category", { length: 64 }),
    urgency: varchar("urgency", { length: 16 }).default("NORMAL"),
    slaHours: integer("sla_hours"),
    stabilityRisk: boolean("stability_risk"),
    canonicalSubject: varchar("canonical_subject", { length: 255 }),
    eventType: varchar("event_type", { length: 128 }),
    address: varchar("address", { length: 255 }),
    confidence: integer("confidence"),
    primaryThemeId: varchar("primary_theme_id", { length: 64 }),
    channel: varchar("channel", { length: 64 }).default("市民服务热线"),
    status: varchar("status", { length: 32 }).default("PENDING"),
    createTime: timestamp("create_time", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closureStatus: varchar("closure_status", { length: 32 }),
    isFakeClosure: boolean("is_fake_closure").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_tickets_ticket_no").on(table.ticketNo),
    index("idx_tickets_subdistrict").on(table.subdistrict),
    index("idx_tickets_create_time").on(table.createTime),
    index("idx_tickets_closed_at").on(table.closedAt),
    index("idx_tickets_status").on(table.status),
    index("idx_tickets_urgency").on(table.urgency),
    index("idx_tickets_source_category").on(table.sourceCategory),
    index("idx_tickets_primary_theme_id").on(table.primaryThemeId),
    index("idx_tickets_status_create_time").on(table.status, table.createTime),
  ]
);

/**
 * 2. 多频主题聚类表 (Themes Table)
 */
export const themesTable = pgTable(
  "themes",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    canonicalSubject: varchar("canonical_subject", { length: 255 }).notNull(),
    canonicalLocation: varchar("canonical_location", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    category: varchar("category", { length: 64 }).default("城市管理"),
    riskLevel: varchar("risk_level", { length: 32 }).notNull().default("LOW"),
    riskReason: text("risk_reason"),
    ticketCount: integer("ticket_count").default(0).notNull(),
    timeSpanHours: integer("time_span_hours").default(1).notNull(),
    aiSummary: text("ai_summary"),
    recommendedAction: text("recommended_action"),
    patternType: varchar("pattern_type", { length: 32 }),
    civicMode: varchar("civic_mode", { length: 16 }),
    aiConfidence: integer("ai_confidence"),
    firstAt: timestamp("first_at", { withTimezone: true }),
    lastAt: timestamp("last_at", { withTimezone: true }),
    handlingStatus: varchar("handling_status", { length: 16 }).default("PENDING"),
    handlingProgress: integer("handling_progress").default(0),
    handlingOwner: varchar("handling_owner", { length: 64 }),
    handlingEta: timestamp("handling_eta", { withTimezone: true }),
    featuresJson: text("features_json"),
    radarJson: text("radar_json"),
    trendPct: integer("trend_pct"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_themes_risk_level").on(table.riskLevel),
    index("idx_themes_subject").on(table.canonicalSubject),
    index("idx_themes_pattern_type").on(table.patternType),
    index("idx_themes_ticket_count").on(table.ticketCount),
  ]
);

/**
 * 3. 工单-多频主题关联表 (Ticket-Theme Junction Table)
 */
export const ticketThemesTable = pgTable(
  "ticket_themes",
  {
    ticketId: varchar("ticket_id", { length: 64 })
      .notNull()
      .references(() => ticketsTable.id, { onDelete: "cascade" }),
    themeId: varchar("theme_id", { length: 64 })
      .notNull()
      .references(() => themesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ticketId, table.themeId] }),
    index("idx_tt_ticket_id").on(table.ticketId),
    index("idx_tt_theme_id").on(table.themeId),
  ]
);

/**
 * 4. 人工复核队列 (Review Queue Table)
 */
export const reviewQueueTable = pgTable(
  "review_queue",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ticketId: varchar("ticket_id", { length: 64 })
      .notNull()
      .references(() => ticketsTable.id, { onDelete: "cascade" }),
    reason: varchar("reason", { length: 128 }).notNull().default("LOW_CONFIDENCE"),
    confidence: integer("confidence"),
    status: varchar("status", { length: 32 }).notNull().default("PENDING"), // PENDING/REVIEWED/DISMISSED
    operator: varchar("operator", { length: 64 }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_review_queue_status").on(table.status),
    index("idx_review_queue_ticket_id").on(table.ticketId),
  ]
);

/**
 * 5. 官方标准政务词汇表 (Standard Vocabulary Table)
 */
export const vocabulariesTable = pgTable(
  "vocabularies",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    type: varchar("type", { length: 32 }).notNull(), // TOWNSHIP, COMMUNITY, CATEGORY, DEPARTMENT
    name: varchar("name", { length: 128 }).notNull(),
    fullName: varchar("full_name", { length: 255 }),
    parentName: varchar("parent_name", { length: 128 }),
    metaJson: text("meta_json"),
    description: text("description"),
    isStandard: boolean("is_standard").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_vocabularies_type").on(table.type),
    index("idx_vocabularies_name").on(table.name),
  ]
);

/**
 * 6. 别名与同义词映射知识库表 (Aliases Knowledge Base Table)
 */
export const aliasesTable = pgTable(
  "aliases",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    alias: varchar("alias", { length: 128 }).notNull().unique(),
    canonical: varchar("canonical", { length: 128 }).notNull(),
    type: varchar("type", { length: 32 }).default("ENTITY").notNull(), // TOWNSHIP, LOCATION, SUBJECT, DEPARTMENT
    source: varchar("source", { length: 32 }).default("PRESET").notNull(), // PRESET, AI_MINED, MANUAL
    usageCount: integer("usage_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_aliases_alias").on(table.alias),
    index("idx_aliases_canonical").on(table.canonical),
    index("idx_aliases_type").on(table.type),
  ]
);

export type TicketRecord = typeof ticketsTable.$inferSelect;
export type NewTicketRecord = typeof ticketsTable.$inferInsert;

export type ThemeRecord = typeof themesTable.$inferSelect;
export type NewThemeRecord = typeof themesTable.$inferInsert;

export type ReviewQueueRecord = typeof reviewQueueTable.$inferSelect;
export type NewReviewQueueRecord = typeof reviewQueueTable.$inferInsert;

export type VocabularyRecord = typeof vocabulariesTable.$inferSelect;
export type NewVocabularyRecord = typeof vocabulariesTable.$inferInsert;

export type AliasRecord = typeof aliasesTable.$inferSelect;
export type NewAliasRecord = typeof aliasesTable.$inferInsert;

/**
 * 7. 任务进度持久化表 (Task Progress Table)
 */
export const taskProgressTable = pgTable(
  "task_progress",
  {
    taskId: varchar("task_id", { length: 128 }).primaryKey(),
    status: varchar("status", { length: 32 }).notNull().default("PENDING"), // PENDING, RUNNING, COMPLETED, FAILED
    stage: varchar("stage", { length: 32 }).notNull().default("EXTRACTING"), // PARSING, EXTRACTING, CLUSTERING, SYNTHESIZING, COMPLETED
    stageText: text("stage_text").notNull().default("准备就绪"),
    percent: integer("percent").notNull().default(0),
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    extractedCount: integer("extracted_count").notNull().default(0),
    themeCount: integer("theme_count").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    error: text("error"),
    regionId: varchar("region_id", { length: 64 }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_task_progress_status").on(table.status),
    index("idx_task_progress_updated_at").on(table.updatedAt),
  ]
);

export type TaskProgressRecord = typeof taskProgressTable.$inferSelect;
export type NewTaskProgressRecord = typeof taskProgressTable.$inferInsert;

export * from "@/lib/auth/schema";

