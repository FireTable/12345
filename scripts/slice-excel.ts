import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";

/**
 * 裁剪 Excel 文件前 N 条记录脚本
 * 使用方式:
 *   pnpm tsx scripts/slice-excel.ts [文件路径] [裁剪行数, 默认 200]
 */
async function main() {
  const defaultPath =
    "/Users/FireTable/Downloads/政数局资料-顺德区12345热线工单 simple.xlsx";

  const inputFilePath = process.argv[2] || defaultPath;
  const limit = parseInt(process.argv[3], 10) || 200;

  console.log(`\n========================================`);
  console.log(`📦 开始裁剪 Excel 数据:`);
  console.log(`   源文件路径: ${inputFilePath}`);
  console.log(`   截取条数: 前 ${limit} 条`);
  console.log(`========================================\n`);

  if (!fs.existsSync(inputFilePath)) {
    console.error(`❌ 文件不存在: ${inputFilePath}`);
    console.error(`请传入有效的文件路径作为参数，例如:`);
    console.error(`pnpm tsx scripts/slice-excel.ts "/path/to/file.xlsx" 200\n`);
    process.exit(1);
  }

  // 1. 读取 Excel 文件
  console.log(`⏳ 正在读取 Excel 工作簿...`);
  const workbook = XLSX.readFile(inputFilePath, {
    cellDates: true,
    sheetRows: limit + 10, // 仅读取前 limit+10 行提升解析速度与节省内存
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    console.error(`❌ 工作簿中未发现有效 Sheet 表格`);
    process.exit(1);
  }

  console.log(`📄 正在处理 Sheet: [${firstSheetName}]`);
  const worksheet = workbook.Sheets[firstSheetName];

  // 2. 转换为 JSON 数组（带表头）
  const allRows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
    defval: "",
  });

  console.log(`📊 成功读取行数: ${allRows.length} 行`);

  // 3. 截取前 N 行
  const slicedRows = allRows.slice(0, limit);
  console.log(`✂️ 已裁剪前 ${slicedRows.length} 条数据`);

  // 4. 确保输出目录存在
  const outputDir = path.resolve(process.cwd(), "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 5. 导出为新 Excel (.xlsx)
  const newWorksheet = XLSX.utils.json_to_sheet(slicedRows);
  const newWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "Sample_200");

  const outXlsxPath = path.join(outputDir, `sample_${limit}.xlsx`);
  XLSX.writeFile(newWorkbook, outXlsxPath);
  console.log(`✅ 已导出 Excel: ${outXlsxPath}`);

  // 6. 导出为 CSV (.csv)
  const csvContent = XLSX.utils.sheet_to_csv(newWorksheet);
  const outCsvPath = path.join(outputDir, `sample_${limit}.csv`);
  fs.writeFileSync(outCsvPath, "\uFEFF" + csvContent, "utf-8");
  console.log(`✅ 已导出 CSV:   ${outCsvPath}`);

  // 7. 导出为 JSON (.json)
  const outJsonPath = path.join(outputDir, `sample_${limit}.json`);
  fs.writeFileSync(
    outJsonPath,
    JSON.stringify(slicedRows, null, 2),
    "utf-8"
  );
  console.log(`✅ 已导出 JSON:  ${outJsonPath}`);

  console.log(`\n🎉 处理完成！输出文件已保存在 output/ 目录下。\n`);
}

main().catch((err) => {
  console.error("处理失败:", err);
  process.exit(1);
});
