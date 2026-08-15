import fs from "fs";
import path from "path";

interface RawExcelRow {
  序号?: number;
  工单编号?: string;
  标题?: string;
  内容?: string;
  [key: string]: any;
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

function main() {
  const jsonPath = path.resolve(process.cwd(), "output", "sample_200.json");
  if (!fs.existsSync(jsonPath)) {
    console.error("sample_200.json not found");
    return;
  }

  const rawRows: RawExcelRow[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`正在将 ${rawRows.length} 条真实样本工单转换为系统内置数据集...`);

  const tickets = rawRows.map((r, idx) => {
    const ticketNo = r.工单编号 || `GD-20250101-${String(idx + 1).padStart(4, "0")}`;
    const content = (r.内容 || r.标题 || "市民诉求内容").replace(/12345/g, "市民服务热线");
    const subdistrict = extractSubdistrict(content, r.标题 || "");

    // 随机但确定的时间分布（2025年1月）
    const day = 1 + (idx % 3);
    const hour = String(8 + (idx % 14)).padStart(2, "0");
    const minute = String((idx * 7) % 60).padStart(2, "0");
    const createTime = `2025-01-0${day} ${hour}:${minute}:00`;

    const surnames = ["张", "李", "王", "陈", "刘", "黄", "何", "梁", "罗", "周", "林", "吴"];
    const surname = surnames[idx % surnames.length];

    return {
      id: `tk-${idx + 1}`,
      ticketNo,
      createTime,
      citizenName: `${surname}*`,
      citizenPhone: `13${(idx % 9) + 1}****${String((idx * 137) % 10000).padStart(4, "0")}`,
      district: "顺德区",
      subdistrict,
      content,
      channel: "市民服务热线",
      status: "PENDING",
    };
  });

  const mockFileContent = `import type { RawTicket } from "@/backend/state";

/**
 * 真实样本工单数据集（200 条真实脱敏抽样）
 */
export const MOCK_RAW_TICKETS: RawTicket[] = ${JSON.stringify(tickets, null, 2)};
`;

  const targetPath = path.resolve(process.cwd(), "lib", "mock-data.ts");
  fs.writeFileSync(targetPath, mockFileContent, "utf-8");
  console.log(`✅ 成功将 ${tickets.length} 条真实脱敏工单覆盖写入: ${targetPath}`);
}

main();
