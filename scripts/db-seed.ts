import fs from "fs";
import path from "path";
import nextEnv from "@next/env";

const { loadEnvConfig } = (nextEnv as any).default || nextEnv;
loadEnvConfig(process.cwd());

const DATE_REGEX = /(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日)[\s\S]{0,10}?(\d{1,2}[:：]\d{1,2}(?:[:：]\d{1,2})?)/;

function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateFromContent(content: string): Date | null {
  const match = content.match(DATE_REGEX);
  if (!match) return null;
  const nowYear = new Date().getFullYear();
  let datePart = match[1].replace("年", "-").replace("月", "-").replace("日", "");
  if (!datePart.includes("-20") && !datePart.startsWith("20")) {
    datePart = `${nowYear}-${datePart}`;
  }
  const timePart = match[2].replace("：", ":");
  return toDate(`${datePart} ${timePart}`);
}

async function seedDatabase() {
  console.log("==================================================");
  console.log("🐘 正在执行数据入库 (PostgreSQL Seeding)...");
  console.log("==================================================\n");

  const { resolveScriptRegion } = await import("./region-target");
  const { ticketsTable } = await import("../db/schema");
  const { getRegionVocabulary, matchTownshipName } = await import("../lib/vocabulary");
  const { desensitizeContent } = await import("../backend/anonymizer");
  const { MOCK_RAW_TICKETS } = await import("../lib/mock-data");

  const target = await resolveScriptRegion();
  const vocab = await getRegionVocabulary(target.region?.id || target.schemaName);

  const jsonSamplePath = path.resolve(process.cwd(), "output", "sample_200.json");
  let sourceLabel = "内置 MOCK_RAW_TICKETS";
  let rows: any[] = MOCK_RAW_TICKETS;

  if (fs.existsSync(jsonSamplePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonSamplePath, "utf-8"));
      if (Array.isArray(parsed) && parsed.length > 0) {
        rows = parsed;
        sourceLabel = "output/sample_200.json";
        console.log(`📄 使用 ${sourceLabel}，共 ${parsed.length} 条`);
      }
    } catch (e) {
      console.warn("读取 sample_200.json 失败，改用内置数据集");
    }
  }

  const records = rows.flatMap((row, idx) => {
    const content = String(row.content || "").trim();
    const title = String(row.title || "").trim();
    if (!content && !title) return [];
    const text = `${title}${content}`;
    const subdistrict = row.subdistrict || matchTownshipName(text, vocab.townships) || null;
    return [{
      id: row.id || `tk-sample-${row.index || idx + 1}`,
      ticketNo: String(row.ticketNo || `SAMPLE-${idx + 1}`),
      title: title || "市民诉求",
      content: content || title,
      maskedContent: desensitizeContent(content || title),
      citizenName: row.citizenName || "热线市民",
      citizenPhone: row.citizenPhone || "",
      province: row.province || target.region?.province || null,
      city: row.city || target.region?.city || null,
      district: row.district || target.region?.name || null,
      subdistrict,
      ingestDistrict: row.district || target.region?.name || null,
      ingestSubdistrict: subdistrict,
      channel: row.channel || "市民服务热线",
      status: row.status || "PENDING",
      createTime: toDate(row.createTime) || dateFromContent(text),
    }];
  });

  console.log(`⏳ 准备把 ${records.length} 条工单写入 ${target.schemaName}（来源: ${sourceLabel}）...`);

  try {
    const inserted = await target.db
      .insert(ticketsTable)
      .values(records)
      .onConflictDoNothing({ target: ticketsTable.ticketNo })
      .returning({ id: ticketsTable.id });

    const skipped = records.length - inserted.length;
    console.log(`✅ 新写入 ${inserted.length} 条，已存在跳过 ${skipped} 条。`);
    process.exit(0);
  } catch (err: any) {
    console.error("❌ 数据库写入失败:", err.message);
    console.error("💡 提示: 请确保本地已启动 PostgreSQL，并且 DATABASE_URL 已配置。");
    console.error("   例如: DATABASE_URL=postgres://postgres:postgres@localhost:5432/ticket_radar");
    process.exit(1);
  }
}

seedDatabase().catch((err) => {
  console.error("Seed 异常:", err);
  process.exit(1);
});
