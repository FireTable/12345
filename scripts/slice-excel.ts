import fs from "fs";
import path from "path";
import * as xlsxModule from "xlsx";

const XLSX: typeof xlsxModule = (xlsxModule as any).default || xlsxModule;

if ((XLSX as any).set_fs) {
  (XLSX as any).set_fs(fs);
}

/**
 * 中文表头映射为标准英文键名
 */
const HEADER_KEY_MAP: Record<string, string> = {
  序号: "index",
  工单编号: "ticketNo",
  单号: "ticketNo",
  标题: "title",
  工单标题: "title",
  内容: "content",
  工单内容: "content",
  诉求内容: "content",
  诉求人: "citizenName",
  市民姓名: "citizenName",
  联系电话: "citizenPhone",
  电话: "citizenPhone",
  手机号码: "citizenPhone",
  登记时间: "createTime",
  受理时间: "createTime",
  时间: "createTime",
  所属区域: "district",
  区: "district",
  所属镇街: "subdistrict",
  所属街道: "subdistrict",
  街道: "subdistrict",
  镇街: "subdistrict",
  诉求渠道: "channel",
  渠道: "channel",
  状态: "status",
};

function normalizeHeadersToEnglish(row: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const [key, val] of Object.entries(row)) {
    const trimmedKey = key.trim();
    const mappedKey = HEADER_KEY_MAP[trimmedKey] || trimmedKey;

    let cleanVal = val;
    if (typeof val === "string") {
      cleanVal = val.replace(/12345/g, "市民服务热线");
    }
    normalized[mappedKey] = cleanVal;
  }
  return normalized;
}

/**
 * 裁剪 Excel 文件并转换为全英文字段 Key
 */
async function main() {
  const inputFilePath =
    process.argv[2] ||
    process.env.EXCEL_INPUT_PATH ||
    path.resolve(process.cwd(), "input", "tickets.xlsx");

  const limit = parseInt(process.argv[3], 10) || 200;

  console.log(`\n========================================`);
  console.log(`📦 开始裁剪 Excel 数据并转换表头为英文 Key:`);
  console.log(`   源文件路径: ${inputFilePath}`);
  console.log(`   截取条数: 前 ${limit} 条`);
  console.log(`========================================\n`);

  if (!fs.existsSync(inputFilePath)) {
    console.error(`❌ 文件不存在: ${inputFilePath}`);
    process.exit(1);
  }

  // 1. 读取 Excel 工作簿
  console.log(`⏳ 正在读取 Excel 工作簿...`);
  const workbook = XLSX.readFile(inputFilePath, {
    cellDates: true,
    sheetRows: limit + 50,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    console.error(`❌ 未发现有效 Sheet 表格`);
    process.exit(1);
  }

  console.log(`📄 正在处理 Sheet: [${firstSheetName}]`);
  const worksheet = workbook.Sheets[firstSheetName];

  // 2. 转换为原始 JSON 数组
  const allRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
    defval: "",
  });

  console.log(`📊 成功读取行数: ${allRows.length} 行`);

  // 3. 截取前 N 行并将所有表头映射为标准英文 Key
  const englishSlicedRows = allRows
    .slice(0, limit)
    .map((row) => normalizeHeadersToEnglish(row));

  console.log(`✂️ 已裁剪前 ${englishSlicedRows.length} 条数据，表头已全部转换为英文字段名`);

  // 4. 确保输出目录存在
  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 5. 导出为全英文字段的 Excel (.xlsx)
  const newWorksheet = XLSX.utils.json_to_sheet(englishSlicedRows);
  const newWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "Sample_200");

  const outXlsxPath = path.join(outputDir, `sample_${limit}.xlsx`);
  XLSX.writeFile(newWorkbook, outXlsxPath);
  console.log(`✅ 已导出英文表头 Excel: ${outXlsxPath}`);

  // 6. 导出为全英文字段的 CSV (.csv)
  const csvContent = XLSX.utils.sheet_to_csv(newWorksheet);
  const outCsvPath = path.join(outputDir, `sample_${limit}.csv`);
  fs.writeFileSync(outCsvPath, "\uFEFF" + csvContent, "utf-8");
  console.log(`✅ 已导出英文表头 CSV:   ${outCsvPath}`);

  // 7. 导出为全英文字段的 JSON (.json)
  const outJsonPath = path.join(outputDir, `sample_${limit}.json`);
  fs.writeFileSync(
    outJsonPath,
    JSON.stringify(englishSlicedRows, null, 2),
    "utf-8"
  );
  console.log(`✅ 已导出英文表头 JSON:  ${outJsonPath}`);

  console.log(`\n🎉 处理完成！JSON 与 Excel/CSV 的所有 key 均已转换为标准英文。\n`);
}

main().catch((err) => {
  console.error("处理失败:", err);
  process.exit(1);
});
