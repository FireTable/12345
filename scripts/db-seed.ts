import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { db } from "../db/client";
import { ticketsTable } from "../db/schema";
import { MOCK_RAW_TICKETS } from "../lib/mock-data";

async function seedDatabase() {
  console.log("==================================================");
  console.log("🐘 正在执行数据入库 (PostgreSQL Seeding)...");
  console.log("==================================================\n");

  const jsonSamplePath = path.resolve(process.cwd(), "output", "sample_200.json");
  let ticketList = MOCK_RAW_TICKETS;

  if (fs.existsSync(jsonSamplePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonSamplePath, "utf-8"));
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`📄 检测到 output/sample_200.json，加载 ${parsed.length} 条样本数据`);
      }
    } catch (e) {
      console.warn("读取 sample_200.json 失败，使用内置数据集");
    }
  }

  console.log(`⏳ 准备批量写入 ${ticketList.length} 条工单记录到 PostgreSQL...`);

  try {
    const records = ticketList.map((t) => ({
      id: t.id,
      ticketNo: t.ticketNo,
      title: (t as any).title || "市民诉求",
      content: t.content,
      citizenName: t.citizenName,
      citizenPhone: t.citizenPhone,
      district: t.district,
      subdistrict: t.subdistrict,
      channel: t.channel || "市民服务热线",
      status: t.status || "PENDING",
      createTime: new Date(t.createTime),
    }));

    // Batch insert with on conflict ignore
    await db
      .insert(ticketsTable)
      .values(records)
      .onConflictDoNothing({ target: ticketsTable.ticketNo });

    console.log(`✅ 成功入库 ${records.length} 条工单数据！`);
  } catch (err: any) {
    console.error("❌ 数据库写入失败:", err.message);
    console.error("💡 提示: 请确保本地已启动 PostgreSQL 服务，并且环境变量 DATABASE_URL 已配置。");
    console.error("   例如: DATABASE_URL=postgres://postgres:postgres@localhost:5432/ticket_radar");
  }

  process.exit(0);
}

seedDatabase().catch((err) => {
  console.error("Seed 异常:", err);
  process.exit(1);
});
