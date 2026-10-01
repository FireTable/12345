import { db, getRegionDb } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { desensitizeContent } from "@/backend/anonymizer";
import { profileTicket } from "@/backend/ticket-profile";
import { AGENT_TICKET_NULLS } from "@/lib/civic-persist";
import { invalidateCivicAggregates } from "@/lib/civic-cache";
import type { TownshipInfo } from "@/lib/vocabulary";
import { workOrderInstantFromTicketNo } from "@/lib/work-order-date";

const HEADER_MAP: Record<string, string> = {
  序号: "index",
  工单编号: "ticketNo",
  单号: "ticketNo",
  标题: "title",
  工单标题: "title",
  内容: "content",
  工单内容: "content",
  诉求内容: "content",
  诉求人: "citizenName",
  联系电话: "citizenPhone",
  电话: "citizenPhone",
  登记时间: "createTime",
  所属区域: "district",
  区: "district",
  所属镇街: "subdistrict",
  街道: "subdistrict",
  镇街: "subdistrict",
  诉求渠道: "channel",
  工单类型: "sourceCategory",
  类型: "sourceCategory",
  分类: "sourceCategory",
  办结时间: "closedAt",
  办结日期: "closedAt",
  办结状态: "closureStatus",
};

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

const DATE_REGEX = /(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日)[\s\S]{0,10}?(\d{1,2}[:：]\d{1,2}(?:[:：]\d{1,2})?)/;

function extractDate(content: string): Date {
  const match = content.match(DATE_REGEX);
  if (match) {
    try {
      const nowYear = new Date().getFullYear();
      let datePart = match[1].replace("年", "-").replace("月", "-").replace("日", "");
      if (!datePart.includes("-20") && !datePart.startsWith("20")) {
        datePart = `${nowYear}-${datePart}`;
      }
      const timePart = match[2].replace("：", ":");
      const d = new Date(`${datePart} ${timePart}`);
      if (!isNaN(d.getTime())) return d;
    } catch {
      // Fallback
    }
  }
  return new Date();
}

export interface IngestReport {
  totalParsed: number;
  insertedCount: number;
  duplicateCount: number;
  failedCount: number;
  durationMs: number;
}

// ponytail: 提取自原 upload/route,粘贴文本 / 上传文件共用同一份「规范化 + 批量去重插入」逻辑,
// 任何字段补缺规则只需改这一处。
export interface IngestProfileOptions {
  townships?: TownshipInfo[];
  district?: string | null;
  city?: string | null;
  province?: string | null;
}

export function buildRecordsFromRows(
  rawRows: Record<string, any>[],
  idPrefix: string,
  options: IngestProfileOptions = {}
): { records: any[]; failedCount: number } {
  const records: any[] = [];
  let failedCount = 0;
  const baseTs = Date.now();

  for (let idx = 0; idx < rawRows.length; idx++) {
    const r = rawRows[idx];
    const normalized: Record<string, any> = {};
    for (const [k, v] of Object.entries(r)) {
      const trimmedKey = k.trim();
      const mappedKey = HEADER_MAP[trimmedKey] || trimmedKey;
      normalized[mappedKey] = v;
    }

    const content = String(normalized.content || normalized.title || "").trim();
    const title = String(normalized.title || "").trim();

    if (!content && !title) {
      failedCount++;
      continue;
    }

    const ticketNo = String(
      normalized.ticketNo || `${idPrefix}-${baseTs}-${String(idx + 1).padStart(6, "0")}`
    );
    const createTime = workOrderInstantFromTicketNo(ticketNo) ?? extractDate(content);
    const profile = profileTicket(
      { title, content, subdistrict: optionalText(normalized.subdistrict) },
      options.townships || []
    );

    const channel = normalized.channel || normalized.sourceChannel || "市民服务热线";

    const closedAtRaw = normalized.closedAt;
    let closedAt: Date | null = null;
    if (closedAtRaw instanceof Date && !isNaN(closedAtRaw.getTime())) {
      closedAt = closedAtRaw;
    } else if (closedAtRaw) {
      const parsed = new Date(String(closedAtRaw));
      if (!isNaN(parsed.getTime())) closedAt = parsed;
    }
    const closureRaw = String(normalized.closureStatus || "").trim();
    const closureStatus = closedAt
      ? closureRaw.includes("重开") || closureRaw.toUpperCase() === "REOPENED"
        ? "REOPENED"
        : "RESOLVED"
      : null;

    records.push({
      id: `tk-${baseTs}-${idx + 1}`,
      ticketNo,
      title: title || "",
      content,
      maskedContent: desensitizeContent(content),
      citizenName: normalized.citizenName || "热线市民",
      citizenPhone: normalized.citizenPhone || "",
      ingestDistrict: optionalText(normalized.district),
      ingestSubdistrict: optionalText(normalized.subdistrict),
      ingestCategory: optionalText(normalized.sourceCategory),
      ...AGENT_TICKET_NULLS,
      province: options.province || null,
      city: options.city || null,
      district: optionalText(normalized.district) || options.district || null,
      subdistrict: optionalText(normalized.subdistrict),
      sourceCategory: optionalText(normalized.sourceCategory),
      urgency: profile.urgent ? "URGENT" : "NORMAL",
      channel,
      status: "PENDING",
      createTime,
      closedAt,
      closureStatus,
      isFakeClosure: false,
    });
  }

  return { records, failedCount };
}

// 粘贴文本专用:每行=一条,首句作标题,余下作内容;自动补缺其余字段。
export function buildRecordsFromTexts(
  texts: string[],
  options: IngestProfileOptions = {}
): { records: any[]; failedCount: number } {
  const rawRows: Record<string, any>[] = [];
  for (const line of texts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // ponytail: 标题取首个完整句(到第一个句号/问号/感叹号或换行),避免长工单首句被截到前几个字。
    const titleMatch = trimmed.match(/^[^。！？\n]+/);
    const title = titleMatch ? titleMatch[0].trim() : trimmed.slice(0, 30);
    rawRows.push({ title, content: trimmed });
  }
  return buildRecordsFromRows(rawRows, "GD-PASTE", options);
}

// ponytail: 500/批,22 字段上限 ~11k 参数,PG max_params=32767 安全区
const BATCH_SIZE = 500;

export async function insertRecordsBatch(records: any[], regionId?: string): Promise<{
  insertedCount: number;
  duplicateCount: number;
  failedCount: number;
}> {
  let insertedCount = 0;
  let duplicateCount = 0;
  let failedCount = 0;

  const { db: targetDb } = await getRegionDb(regionId);

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    try {
      const ticketNos = chunk.map((c) => c.ticketNo);
      const existing = await targetDb
        .select({ ticketNo: ticketsTable.ticketNo })
        .from(ticketsTable)
        .where(inArray(ticketsTable.ticketNo, ticketNos));

      const existingSet = new Set(existing.map((e) => e.ticketNo));
      duplicateCount += existingSet.size;

      const newRecords = chunk.filter((c) => !existingSet.has(c.ticketNo));
      for (const row of chunk) {
        if (!existingSet.has(row.ticketNo) || !(row.createTime instanceof Date)) continue;
        await targetDb
          .update(ticketsTable)
          .set({ createTime: row.createTime })
          .where(eq(ticketsTable.ticketNo, row.ticketNo));
      }

      if (newRecords.length > 0) {
        // ponytail: 锁定 ticketNo 唯一约束去重,用 returning 拿到 DB 真插入数。
        const inserted = await targetDb
          .insert(ticketsTable)
          .values(newRecords)
          .onConflictDoNothing({ target: ticketsTable.ticketNo })
          .returning({ id: ticketsTable.id });
        insertedCount += inserted.length;
      }
    } catch (dbErr: any) {
      console.error(`[ingest] chunk ${i}-${i + BATCH_SIZE} 失败:`, dbErr?.message || dbErr);
      failedCount += chunk.length;
    }
  }

  invalidateCivicAggregates(regionId);
  return { insertedCount, duplicateCount, failedCount };
}
