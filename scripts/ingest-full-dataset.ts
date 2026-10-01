import fs from "fs";
import path from "path";
import * as xlsxModule from "xlsx";
import nextEnvPkg from "@next/env";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}



const XLSX: typeof xlsxModule = (xlsxModule as any).default || xlsxModule;
if ((XLSX as any).set_fs) {
  (XLSX as any).set_fs(fs);
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
    } catch (e) {
      // Fallback
    }
  }
  return new Date();
}

/**
 * 37MB / 12w 条全量数据极速入库脚本
 */
async function main() {
  const homedir = process.env.HOME || process.env.USERPROFILE || "";
  const candidatePaths = [
    path.join(process.cwd(), "data", "shunde_12345_tickets_simple.xlsx"),
    path.join(homedir, "Downloads", "政数局资料-顺德区12345热线工单 simple.xlsx"),
  ];
  const foundDefault = candidatePaths.find((p) => fs.existsSync(p));
  const defaultPath =
    process.env.EXCEL_INPUT_PATH ||
    foundDefault ||
    "./data/shunde_12345_tickets_simple.xlsx";

  const { resolveScriptRegion, stripRegionArgs } = await import("./region-target");
  const inputFilePath = stripRegionArgs(process.argv.slice(2))[0] || defaultPath;

  console.log(`\n======================================================`);
  console.log(`🚀 开始处理 37MB / 12w 条全量真实数据集入库`);
  console.log(`   源文件路径: ${inputFilePath}`);
  console.log(`======================================================\n`);

  if (!fs.existsSync(inputFilePath)) {
    console.error(`❌ 文件不存在: ${inputFilePath}`);
    process.exit(1);
  }

  const { ticketsTable } = await import("../db/schema");
  const { getRegionVocabulary, matchTownshipName } = await import("../lib/vocabulary");
  const { desensitizeContent } = await import("../backend/anonymizer");
  const target = await resolveScriptRegion();
  const vocab = await getRegionVocabulary(target.region?.id || target.schemaName);

  const startTime = Date.now();

  // 1. 读取 Excel 文件
  console.log(`⏳ 正在将 37MB Excel 文件载入内存...`);
  const workbook = XLSX.readFile(inputFilePath, {
    cellDates: true,
  });

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  // 2. 转换为 JSON 数组
  console.log(`⏳ 正在解析表格数据...`);
  const allRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
    defval: "",
  });

  const parseTime = Date.now() - startTime;
  console.log(`📊 成功解析全量数据: ${allRows.length} 条记录 (耗时: ${(parseTime / 1000).toFixed(2)}s)`);

  // 3. 分批（Batch Chunking）写入 PostgreSQL
  const BATCH_SIZE = 3000;
  const totalBatches = Math.ceil(allRows.length / BATCH_SIZE);
  console.log(`\n🐘 准备分 ${totalBatches} 批写入 PostgreSQL (每批 ${BATCH_SIZE} 条)...`);

  let insertedCount = 0;
  let unmatchedSubdistrict = 0;

  for (let i = 0; i < totalBatches; i++) {
    const startIdx = i * BATCH_SIZE;
    const endIdx = Math.min(startIdx + BATCH_SIZE, allRows.length);
    const chunk = allRows.slice(startIdx, endIdx);

    const records = chunk.map((r, idx) => {
      const globalIdx = startIdx + idx;
      const ticketNo =
        r["工单编号"] || r.ticketNo || `GD-2025-${String(globalIdx + 1).padStart(6, "0")}`;
      const title = (r["标题"] || r.title || "").replace(/12345/g, "市民服务热线");
      const content = (r["内容"] || r.content || "").replace(/12345/g, "市民服务热线");
      const subdistrict = matchTownshipName(`${title}${content}`, vocab.townships);
      if (!subdistrict) unmatchedSubdistrict += 1;
      const createTime = extractDate(content);

      let channel = "市民服务热线";
      if (title.includes("小程序")) channel = "微信小程序";
      else if (title.includes("公众号")) channel = "微信公众号";

      return {
        id: `tk-${globalIdx + 1}`,
        ticketNo,
        title,
        content,
        maskedContent: desensitizeContent(content),
        citizenName: r.citizenName || r["诉求人"] || "热线市民",
        citizenPhone: r.citizenPhone || r["联系电话"] || r["电话"] || "",
        province: target.region?.province || null,
        city: target.region?.city || null,
        district: target.region?.name || null,
        subdistrict,
        ingestDistrict: target.region?.name || null,
        ingestSubdistrict: subdistrict,
        channel,
        status: "PENDING",
        createTime,
      };
    });

    try {
      const inserted = await target.db
        .insert(ticketsTable)
        .values(records)
        .onConflictDoNothing({ target: ticketsTable.ticketNo })
        .returning({ id: ticketsTable.id });

      insertedCount += inserted.length;
      process.stdout.write(
        `\r   [批次 ${i + 1}/${totalBatches}] 新写入: ${insertedCount} / ${allRows.length} 条`
      );
    } catch (err: any) {
      console.error(`\n❌ 批次 ${i + 1} 写入失败:`, err.message);
      process.exit(1);
    }
  }

  const totalTime = Date.now() - startTime;
  console.log(`\n\n🎉 全量数据处理完毕！`);
  console.log(`   - 全量数据总行数: ${allRows.length} 行`);
  console.log(`   - 新写入: ${insertedCount} 行`);
  console.log(`   - 镇街未识别（留空，不再归入大良）: ${unmatchedSubdistrict} 行`);
  console.log(`   - 总耗时: ${(totalTime / 1000).toFixed(2)} 秒`);
  console.log(`======================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("处理异常:", err);
  process.exit(1);
});
