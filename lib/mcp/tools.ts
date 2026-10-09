import { eq, sql } from "drizzle-orm";
import { getAllRegions, getRegionDb } from "@/db/client";
import { themesTable, ticketsTable } from "@/db/schema";
import { loadOverview } from "@/lib/civic-queries";
import { buildRecordsFromRows, insertRecordsBatch } from "@/lib/ticket-ingest";

export const MCP_TOOLS = [
  {
    name: "list_regions",
    description: "查询已纳管的 12345 地区。返回地区 id、名称、城市和省份，供后续写入工单或读取总览。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "push_ticket",
    description: "向指定地区写入一条工单。走站点现有的入库，不触发全市重新聚类。",
    inputSchema: {
      type: "object",
      properties: {
        regionId: { type: "string", description: "地区 id，例如 fs_shunde" },
        title: { type: "string" },
        content: { type: "string", description: "工单正文" },
        ticketNo: { type: "string" },
        subdistrict: { type: "string", description: "镇街，可空" },
      },
      required: ["regionId", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "region_overview",
    description: "读取该地区当前的治理总览：工单量、主题数、已研判量、多频诉求和高风险主题。与站点总览同一套汇总。",
    inputSchema: {
      type: "object",
      properties: {
        regionId: { type: "string" },
      },
      required: ["regionId"],
      additionalProperties: false,
    },
  },
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function textResult(value: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    isError,
  };
}

async function listRegions() {
  const regions = await getAllRegions();
  return regions.map((region) => ({
    id: region.id,
    name: region.name,
    city: region.city,
    province: region.province,
  }));
}

async function pushTicket(args: Record<string, unknown>) {
  const regionId = String(args.regionId || "").trim();
  const content = String(args.content || "").trim();
  const title = String(args.title || "").trim();
  if (!regionId) return textResult({ error: "缺少 regionId" }, true);
  if (!content && !title) return textResult({ error: "缺少工单内容" }, true);
  if (Array.isArray(args.tickets) || Array.isArray(args.rows)) {
    return textResult({ error: "一次只接收一条工单" }, true);
  }

  const regions = await getAllRegions();
  const region = regions.find((item) => item.id === regionId);
  if (!region) return textResult({ error: `没有这个地区: ${regionId}` }, true);

  const built = buildRecordsFromRows(
    [
      {
        title,
        content: content || title,
        ticketNo: args.ticketNo ? String(args.ticketNo) : undefined,
        subdistrict: args.subdistrict ? String(args.subdistrict) : undefined,
      },
    ],
    "MCP",
    { district: region.name, city: region.city, province: region.province }
  );
  if (built.records.length !== 1) return textResult({ error: "工单没有通过入库校验" }, true);

  const report = await insertRecordsBatch(built.records, region.id);
  const ticketNo = built.records[0].ticketNo as string;
  return textResult({
    regionId: region.id,
    ticketNo,
    insertedCount: report.insertedCount,
    duplicateCount: report.duplicateCount,
  });
}

async function regionOverview(args: Record<string, unknown>) {
  const regionId = String(args.regionId || "").trim();
  if (!regionId) return textResult({ error: "缺少 regionId" }, true);
  const regions = await getAllRegions();
  if (!regions.some((region) => region.id === regionId)) {
    return textResult({ error: `没有这个地区: ${regionId}` }, true);
  }
  const overview = await loadOverview(0, regionId);
  const { db } = await getRegionDb(regionId);
  const [risk] = await db
    .select({
      highRiskCount: sql<number>`count(*) filter (where ${themesTable.riskLevel} in ('HIGH', '高危'))::int`,
    })
    .from(themesTable);
  return textResult({
    regionId,
    ticketCount: overview.totalWorkorders,
    themeCount: overview.multiFreqClusters,
    analyzedCount: overview.analyzedCount,
    multiFreqCount: overview.multiFreqCount,
    avgDaily: overview.avgDaily,
    topRegion: overview.topRegion,
    topCategory: overview.topCategory,
    highRiskCount: Number(risk?.highRiskCount || 0),
  });
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "list_regions") return textResult(await listRegions());
  if (name === "push_ticket") return pushTicket(args);
  if (name === "region_overview") return regionOverview(args);
  return textResult({ error: `未知工具: ${name}` }, true);
}

export async function readTicketByNo(regionId: string, ticketNo: string) {
  const { db } = await getRegionDb(regionId);
  const rows = await db
    .select({
      id: ticketsTable.id,
      ticketNo: ticketsTable.ticketNo,
      title: ticketsTable.title,
      subdistrict: ticketsTable.subdistrict,
    })
    .from(ticketsTable)
    .where(eq(ticketsTable.ticketNo, ticketNo))
    .limit(1);
  return rows[0] || null;
}
