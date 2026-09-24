import fs from "fs";
import path from "path";
import * as xlsxModule from "xlsx";
import nextEnvPkg from "@next/env";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

import { db } from "../db/client";
import { ticketsTable } from "../db/schema";
import { desensitizeContent } from "../backend/anonymizer";

const XLSX: typeof xlsxModule = (xlsxModule as any).default || xlsxModule;
if ((XLSX as any).set_fs) {
  (XLSX as any).set_fs(fs);
}

const towns = [
  "大良街道",
  "容桂街道",
  "伦教街道",
  "勒流街道",
  "陈村镇",
  "北滘镇",
  "乐从镇",
  "龙江镇",
  "杏坛镇",
  "均安镇",
];

function extractSubdistrict(content: string, title: string): string {
  const text = (title || "") + (content || "");
  for (const t of towns) {
    if (text.includes(t) || text.includes(t.replace("街道", "").replace("镇", ""))) {
      return t;
    }
  }
  return "大良街道";
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

  const inputFilePath = process.argv[2] || defaultPath;

  console.log(`\n======================================================`);
  console.log(`🚀 开始处理 37MB / 12w 条全量真实数据集入库`);
  console.log(`   源文件路径: ${inputFilePath}`);
  console.log(`======================================================\n`);

  if (!fs.existsSync(inputFilePath)) {
    console.error(`❌ 文件不存在: ${inputFilePath}`);
    process.exit(1);
  }

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
      const subdistrict = extractSubdistrict(content, title);
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
        district: "顺德区",
        subdistrict,
        channel,
        status: "PENDING",
        createTime,
      };
    });

    try {
      await db
        .insert(ticketsTable)
        .values(records)
        .onConflictDoNothing({ target: ticketsTable.ticketNo });

      insertedCount += records.length;
      process.stdout.write(
        `\r   [批次 ${i + 1}/${totalBatches}] 已入库: ${insertedCount} / ${allRows.length} 条 (${Math.round((insertedCount / allRows.length) * 100)}%)`
      );
    } catch (err: any) {
      console.warn(`\n⚠️ 批次 ${i + 1} 写入跳过 (数据库未连接):`, err.message);
      break;
    }
  }

  const totalTime = Date.now() - startTime;
  console.log(`\n\n🎉 全量数据处理完毕！`);
  console.log(`   - 全量数据总行数: ${allRows.length} 行`);
  console.log(`   - 数据库成功写入: ${insertedCount} 行`);
  console.log(`   - 总耗时: ${(totalTime / 1000).toFixed(2)} 秒`);
  console.log(`======================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("处理异常:", err);
  process.exit(1);
});
