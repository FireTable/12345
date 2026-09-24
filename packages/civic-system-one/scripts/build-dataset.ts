import * as XLSX from "xlsx";
import * as fs from "node:fs";
import * as path from "node:path";
import { CivicAnonymizer } from "@civic/anonymizer";
import { buildCivicQuestions, buildCivicCriteria } from "../src/presets/criteria";
import type { CivicCategory, CivicIntent } from "../src/types";

interface BuildDatasetOptions {
  excelPath: string;
  outputFile: string;
  maxPerCategory?: number;
}

export function parseCivicIntent(title: string, content: string): CivicIntent {
  const combined = `${title} ${content}`.toLowerCase();
  if (title.includes("重办") || combined.includes("催办") || combined.includes("未处理") || combined.includes("多次反映")) {
    return "REMINDER";
  }
  if (combined.includes("咨询") || combined.includes("请问") || combined.includes("办理流程") || combined.includes("所需材料")) {
    return "INQUIRY";
  }
  if (combined.includes("建议") || combined.includes("建言") || combined.includes("希望增设") || combined.includes("调整优化")) {
    return "SUGGESTION";
  }
  if (combined.includes("感谢") || combined.includes("表扬") || combined.includes("点赞")) {
    return "COMMENDATION";
  }
  return "COMPLAINT";
}

export function parseCivicCategory(title: string, content: string): CivicCategory {
  const combined = `${title} ${content}`.toLowerCase();

  if (combined.includes("工资") || combined.includes("欠薪") || combined.includes("劳动") || combined.includes("社保") || combined.includes("工伤")) {
    return "labor_social";
  }
  if (combined.includes("噪音") || combined.includes("油烟") || combined.includes("排污") || combined.includes("废气") || combined.includes("黑臭")) {
    return "environment";
  }
  if (combined.includes("退款") || combined.includes("退费") || combined.includes("假冒") || combined.includes("虚假宣传") || combined.includes("超市") || combined.includes("价格欺诈")) {
    return "market_reg";
  }
  if (combined.includes("违停") || combined.includes("车牌") || combined.includes("拥堵") || combined.includes("红绿灯") || combined.includes("公交") || combined.includes("交警")) {
    return "traffic";
  }
  if (combined.includes("电动车") || combined.includes("飞线") || combined.includes("消防") || combined.includes("易燃") || combined.includes("烟花爆竹") || combined.includes("燃气")) {
    return "public_safety";
  }
  if (combined.includes("水管") || combined.includes("漏水") || combined.includes("爆管") || combined.includes("占道") || combined.includes("违建") || combined.includes("物业") || combined.includes("电梯") || combined.includes("城管") || combined.includes("垃圾")) {
    return "urban_management";
  }
  return "social_governance";
}

export function parseCivicUrgency(title: string, content: string, intent: CivicIntent): "Level 0" | "Level 1" | "Level 2" | "Level 3" {
  if (intent === "INQUIRY") return "Level 0";
  const combined = `${title} ${content}`.toLowerCase();
  if (title.includes("急") || combined.includes("爆裂") || combined.includes("困人") || combined.includes("严重泄漏") || combined.includes("坍塌") || combined.includes("突发险情")) {
    return "Level 3";
  }
  if (combined.includes("瘫痪") || combined.includes("大面积") || combined.includes("严重阻碍") || combined.includes("矛盾激化")) {
    return "Level 2";
  }
  return "Level 1";
}

export function parseCivicStabilityRisk(content: string): "YES" | "NO" {
  const stability =
    content.includes("跳楼") ||
    content.includes("自残") ||
    content.includes("报复") ||
    content.includes("串联") ||
    content.includes("聚集") ||
    content.includes("堵路") ||
    content.includes("罢工");
  return stability ? "YES" : "NO";
}

export async function buildDataset(options: BuildDatasetOptions) {
  const { excelPath, outputFile, maxPerCategory = 800 } = options;

  console.log(`[build-dataset] 正在读取 Excel: ${excelPath}`);
  const wb = XLSX.readFile(excelPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet) as Array<{
    序号?: number;
    工单编号?: string;
    标题?: string;
    内容?: string;
  }>;

  console.log(`[build-dataset] 成功读取工单总量: ${rawRows.length} 条`);

  const categoryBuckets: Record<CivicCategory, any[]> = {
    urban_management: [],
    traffic: [],
    market_reg: [],
    environment: [],
    labor_social: [],
    public_safety: [],
    social_governance: [],
  };

  const questions = buildCivicQuestions();
  const criteria = buildCivicCriteria();

  let processedCount = 0;
  for (const row of rawRows) {
    const rawTitle = (row.标题 || "").trim();
    const rawContent = (row.内容 || "").trim();

    if (!rawContent || rawContent.length < 10) continue;

    // 1. 安全气隙脱敏
    const anonymized = CivicAnonymizer.anonymize(rawContent);
    const cleanText = anonymized.text;

    // 2. 规则标注与特征映射
    const intent = parseCivicIntent(rawTitle, cleanText);
    const category = parseCivicCategory(rawTitle, cleanText);
    const urgency = parseCivicUrgency(rawTitle, cleanText, intent);
    const stabilityRisk = parseCivicStabilityRisk(cleanText);

    // 3. 均衡采样控制
    if (categoryBuckets[category].length < maxPerCategory) {
      const record = {
        state: cleanText,
        questions,
        criteria,
        answers: [intent, category, urgency, stabilityRisk],
      };
      categoryBuckets[category].push(record);
      processedCount++;
    }

    // 检查是否所有类别都已填满
    const allFilled = Object.values(categoryBuckets).every((b) => b.length >= maxPerCategory);
    if (allFilled) break;
  }

  // 确保输出目录存在
  const outDir = path.dirname(outputFile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 写入 JSONL
  const allRecords = Object.values(categoryBuckets).flat();
  // 打散排序
  allRecords.sort(() => Math.random() - 0.5);

  const lines = allRecords.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.writeFileSync(outputFile, lines, "utf-8");

  console.log(`\n================= 数据集生成报告 =================`);
  console.log(`输出目标路径: ${outputFile}`);
  console.log(`总有效样本数: ${allRecords.length}`);
  console.log(`类别均衡分布:`);
  for (const [cat, bucket] of Object.entries(categoryBuckets)) {
    console.log(`  - ${cat.padEnd(20)}: ${bucket.length} 条`);
  }
  console.log(`===================================================\n`);
}

// CLI 直执入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const homedir = process.env.HOME || process.env.USERPROFILE || "";
  const candidatePaths = [
    path.join(process.cwd(), "data", "raw_tickets.xlsx"),
    path.join(homedir, "Downloads", "政数局资料-顺德区12345热线工单（2025年1月至3月）.xlsx"),
  ];
  const foundPath = candidatePaths.find((p) => fs.existsSync(p));

  const excelPath =
    process.argv[2] ||
    process.env.DATASET_EXCEL_PATH ||
    foundPath ||
    "./data/raw_tickets.xlsx";

  const outputFile =
    process.argv[3] ||
    process.env.OUTPUT_DATASET_PATH ||
    path.join(process.cwd(), "packages/civic-system-one/data/civic_train.jsonl");

  buildDataset({ excelPath, outputFile, maxPerCategory: 800 }).catch(console.error);
}
