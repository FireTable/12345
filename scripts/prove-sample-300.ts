/**
 * 用 sample_300.xlsx 走入库和完整研判，再核对顺德库里的字段、日期和主题。
 * 用法：PROOF_DIR=/path npx tsx scripts/prove-sample-300.ts /Users/FireTable/Downloads/sample_300.xlsx
 */
import fs from "node:fs";
import path from "node:path";
import nextEnvPkg from "@next/env";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) loadEnvConfig(process.cwd());

async function main() {
  const xlsxPath = process.argv[2] || "/Users/FireTable/Downloads/sample_300.xlsx";
  const xlsxModule = await import("xlsx");
  const xlsx = (xlsxModule as any).default || xlsxModule;
  const { buildRecordsFromRows, insertRecordsBatch } = await import("../lib/ticket-ingest");
  const { executeClusterJob } = await import("../lib/cluster-job");
  const { getRegionDb } = await import("../db/client");
  const { ticketsTable, themesTable } = await import("../db/schema");
  const { shanghaiCalendarDate } = await import("../lib/work-order-date");

  const book = xlsx.readFile(xlsxPath);
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
  const { loadPresetVocabulary } = await import("../lib/vocabulary");
  const vocab = loadPresetVocabulary("fs_shunde");
  const built = buildRecordsFromRows(rows, "SAMPLE300", {
    townships: vocab.townships,
    district: vocab.regionName,
    city: vocab.cityName,
    province: vocab.provinceName,
  });
  console.log(`[sample] parsed ${built.records.length}, failed rows ${built.failedCount}, sheet ${book.SheetNames[0]}`);
  const ingest = await insertRecordsBatch(built.records, "fs_shunde");
  console.log(`[sample] ingest inserted ${ingest.insertedCount}, duplicate ${ingest.duplicateCount}, failed ${ingest.failedCount}`);

  const themeCount = await executeClusterJob({
    taskId: `sample300-${Date.now()}`,
    regionId: "fs_shunde",
    status: "RUNNING",
    processed: 0,
    total: built.records.length,
  });
  console.log(`[sample] pipeline themes ${themeCount}`);

  const wanted = new Set(built.records.map((row) => String(row.ticketNo)));
  const { db } = await getRegionDb("fs_shunde");
  const stored = (await db.select().from(ticketsTable)).filter((row) => wanted.has(row.ticketNo));
  const themes = await db.select().from(themesTable);

  const missing = (label: string, ok: boolean) => (ok ? 0 : 1);
  let gaps = 0;
  let dated = 0;
  let datedWrong = 0;
  for (const ticket of stored) {
    gaps += missing("category", Boolean(ticket.sourceCategory?.trim()));
    gaps += missing("urgency", Boolean(ticket.urgency?.trim()) || typeof ticket.slaHours === "number");
    gaps += missing("stability", typeof ticket.stabilityRisk === "boolean");
    gaps += missing("subject", Boolean(ticket.canonicalSubject?.trim()));
    gaps += missing("location", Boolean(ticket.address?.trim()));
    gaps += missing("event", Boolean(ticket.eventType?.trim()));
    gaps += missing("summary", Boolean(ticket.summarizeTitle?.trim()));
    if (String(ticket.ticketNo).startsWith("250101")) {
      dated++;
      const day = ticket.createTime ? shanghaiCalendarDate(ticket.createTime) : "";
      if (day !== "2025-01-01") datedWrong++;
    }
  }

  const check = [
    `workbook ${xlsxPath}`,
    `sheet ${book.SheetNames[0]} rows ${rows.length}`,
    `stored sample tickets ${stored.length}`,
    `field gaps ${gaps}`,
    `250101 tickets ${dated}`,
    `250101 not on 2025-01-01 ${datedWrong}`,
    `category empty ${stored.filter((t) => !t.sourceCategory?.trim()).length}`,
    `urgency and sla empty ${stored.filter((t) => !t.urgency?.trim() && typeof t.slaHours !== "number").length}`,
    `stability null ${stored.filter((t) => typeof t.stabilityRisk !== "boolean").length}`,
    `subject empty ${stored.filter((t) => !t.canonicalSubject?.trim()).length}`,
    `location empty ${stored.filter((t) => !t.address?.trim()).length}`,
    `event empty ${stored.filter((t) => !t.eventType?.trim()).length}`,
    `summary empty ${stored.filter((t) => !t.summarizeTitle?.trim()).length}`,
  ].join("\n");

  const byTheme = new Map(themes.map((theme) => [theme.id, theme]));
  const members = (pred: (content: string, title: string) => boolean) =>
    stored.filter((ticket) => pred(ticket.content || "", ticket.title || ""));
  const themeIds = (group: typeof stored): string[] => [
    ...new Set(group.map((ticket) => ticket.primaryThemeId).filter((id): id is string => Boolean(id))),
  ];

  const donghu = members((content) => content.includes("东湖学府二期"));
  const foodCourt = members((content) => content.includes("万象美食城") && content.includes("烟花"));
  const gas = members((content) => content.includes("加油站") && content.includes("烟花"));
  const wagePark = members((content) => content.includes("映翠南路") && content.includes("南区公园"));
  const wageShop = members((content) => content.includes("映翠南路") && (content.includes("中嘉花园") || content.includes("鑫名美容")));

  const multi = themes.filter((theme) => (theme.ticketCount || 0) >= 2);
  const multiWithoutAdvice = multi.filter((theme) => !theme.recommendedAction?.trim());
  const lines = [
    `themes ${themes.length}`,
    `multi-ticket themes ${multi.length}`,
    `multi-ticket themes missing advice ${multiWithoutAdvice.length}`,
    ...themes
      .map((theme) => `${theme.id} n=${theme.ticketCount} advice=${theme.recommendedAction?.trim() ? "yes" : "no"} ${theme.title}`)
      .sort(),
    `东湖学府 tickets ${donghu.length} themes ${themeIds(donghu).join(",") || "none"}`,
    `万象美食城烟花 ${foodCourt.length} themes ${themeIds(foodCourt).join(",") || "none"}`,
    `加油站烟花 ${gas.length} themes ${themeIds(gas).join(",") || "none"}`,
    `映翠南路南区公园 ${wagePark.length} themes ${themeIds(wagePark).join(",") || "none"}`,
    `映翠南路中嘉或鑫名 ${wageShop.length} themes ${themeIds(wageShop).join(",") || "none"}`,
    `万象与加油站同一主题 ${sharesTheme(foodCourt, gas) ? "yes" : "no"}`,
    `两家映翠欠薪同一主题 ${sharesTheme(wagePark, wageShop) ? "yes" : "no"}`,
    `东湖学府同一主题 ${donghu.length >= 2 && themeIds(donghu).length === 1 ? "yes" : "no"}`,
  ];
  for (const id of themeIds(donghu)) {
    const theme = byTheme.get(id);
    lines.push(`东湖主题 ${id} subject ${theme?.canonicalSubject || ""} location ${theme?.canonicalLocation || ""}`);
  }
  const themeLog = lines.join("\n");

  console.log(check);
  console.log(themeLog);
  const proofDir = process.env.PROOF_DIR;
  if (proofDir) {
    fs.mkdirSync(proofDir, { recursive: true });
    fs.writeFileSync(path.join(proofDir, "sample300-check.log"), `${check}\n`);
    fs.writeFileSync(path.join(proofDir, "sample300-themes.log"), `${themeLog}\n`);
  }

  const donghuTogether = donghu.length >= 2 && themeIds(donghu).length === 1;
  const fireworksApart = foodCourt.length > 0 && gas.length > 0 && !sharesTheme(foodCourt, gas);
  const wagesApart = wagePark.length > 0 && wageShop.length > 0 && !sharesTheme(wagePark, wageShop);
  if (
    stored.length !== 300 ||
    gaps !== 0 ||
    datedWrong !== 0 ||
    multiWithoutAdvice.length !== 0 ||
    !donghuTogether ||
    !fireworksApart ||
    !wagesApart
  ) {
    process.exitCode = 1;
  }
  console.log(process.exitCode ? "SAMPLE_BAD" : "SAMPLE_OK");
  process.exit(process.exitCode ?? 0);
}

function sharesTheme(
  left: Array<{ primaryThemeId: string | null }>,
  right: Array<{ primaryThemeId: string | null }>
): boolean {
  const ids = new Set(left.map((ticket) => ticket.primaryThemeId).filter(Boolean));
  return right.some((ticket) => ticket.primaryThemeId && ids.has(ticket.primaryThemeId));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
