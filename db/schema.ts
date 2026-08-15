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
    district: varchar("district", { length: 64 }),
    subdistrict: varchar("subdistrict", { length: 64 }),
    channel: varchar("channel", { length: 64 }).default("市民服务热线"),
    status: varchar("status", { length: 32 }).default("PENDING"),
    createTime: timestamp("create_time", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closureStatus: varchar("closure_status", { length: 32 }),
    isFakeClosure: boolean("is_fake_closure").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_tickets_ticket_no").on(table.ticketNo),
    index("idx_tickets_subdistrict").on(table.subdistrict),
    index("idx_tickets_create_time").on(table.createTime),
    index("idx_tickets_closed_at").on(table.closedAt),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_themes_risk_level").on(table.riskLevel),
    index("idx_themes_subject").on(table.canonicalSubject),
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

export type TicketRecord = typeof ticketsTable.$inferSelect;
export type NewTicketRecord = typeof ticketsTable.$inferInsert;

export type ThemeRecord = typeof themesTable.$inferSelect;
export type NewThemeRecord = typeof themesTable.$inferInsert;

export type ReviewQueueRecord = typeof reviewQueueTable.$inferSelect;
export type NewReviewQueueRecord = typeof reviewQueueTable.$inferInsert;
