import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export async function GET(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);

    // 只要计数和一条主体名。不要把主题表整行（含特征、雷达）读进 Node。
    const [ticketCountRes, themeAggRows, topRows] = await Promise.all([
      tenantDb.select({ count: sql<number>`count(*)::int` }).from(ticketsTable),
      tenantDb
        .select({
          themeCount: sql<number>`count(*)::int`,
          highRiskCount: sql<number>`count(*) filter (where ${themesTable.riskLevel} = 'HIGH')::int`,
          mediumRiskCount: sql<number>`count(*) filter (where ${themesTable.riskLevel} = 'MEDIUM')::int`,
          lowRiskCount: sql<number>`count(*) filter (where ${themesTable.riskLevel} = 'LOW')::int`,
          multiFrequencyTickets: sql<number>`coalesce(sum(${themesTable.ticketCount}), 0)::int`,
        })
        .from(themesTable),
      tenantDb
        .select({ canonicalSubject: themesTable.canonicalSubject })
        .from(themesTable)
        .orderBy(desc(themesTable.ticketCount))
        .limit(1),
    ]);

    const totalTickets = Number(ticketCountRes[0]?.count || 0);
    const themeAgg = themeAggRows[0];
    const themeCount = Number(themeAgg?.themeCount || 0);

    if (totalTickets === 0 || themeCount === 0) {
      return NextResponse.json({
        success: true,
        data: {
          totalTickets,
          multiFrequencyTickets: 0,
          multiFrequencyRate: 0,
          themeCount: 0,
          highRiskCount: 0,
          mediumRiskCount: 0,
          lowRiskCount: 0,
          compressionRatio: 0,
          topSubject: totalTickets > 0 ? "工单已入库（待聚类研判）" : "暂无数据",
          avgResponseTimeSavedHours: 0,
        },
      });
    }

    const highRiskCount = Number(themeAgg?.highRiskCount || 0);
    const mediumRiskCount = Number(themeAgg?.mediumRiskCount || 0);
    const lowRiskCount = Number(themeAgg?.lowRiskCount || 0);
    const multiFrequencyTickets = Number(themeAgg?.multiFrequencyTickets || 0);
    const multiFrequencyRate = totalTickets > 0 ? Math.min(100, Math.round((multiFrequencyTickets / totalTickets) * 100)) : 0;
    const compressionRatio = totalTickets > themeCount ? Math.round(((totalTickets - themeCount) / totalTickets) * 100) : 0;

    return NextResponse.json({
      success: true,
      data: {
        totalTickets,
        multiFrequencyTickets,
        multiFrequencyRate,
        themeCount,
        highRiskCount,
        mediumRiskCount,
        lowRiskCount,
        compressionRatio,
        topSubject: topRows[0]?.canonicalSubject || "暂无重点多频诉求",
        avgResponseTimeSavedHours: 0,
      },
    });
  } catch (err) {
    console.warn("DB stats query error:", err);
    return NextResponse.json({
      success: true,
      data: {
        totalTickets: 0,
        multiFrequencyTickets: 0,
        multiFrequencyRate: 0,
        themeCount: 0,
        highRiskCount: 0,
        mediumRiskCount: 0,
        lowRiskCount: 0,
        compressionRatio: 0,
        topSubject: "暂无数据",
        avgResponseTimeSavedHours: 0,
      },
    });
  }
}
