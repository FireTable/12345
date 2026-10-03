import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { sql } from "drizzle-orm";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export async function GET(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);

    const [ticketCountRes, themeRows] = await Promise.all([
      tenantDb.select({ count: sql<number>`count(*)` }).from(ticketsTable),
      tenantDb.select().from(themesTable),
    ]);

    const totalTickets = Number(ticketCountRes[0]?.count || 0);
    const themes = themeRows || [];
    const themeCount = themes.length;

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

    const highRiskCount = themes.filter((t) => t.riskLevel === "HIGH").length;
    const mediumRiskCount = themes.filter((t) => t.riskLevel === "MEDIUM").length;
    const lowRiskCount = themes.filter((t) => t.riskLevel === "LOW").length;
    const multiFrequencyTickets = themes.reduce((acc, t) => acc + (t.ticketCount || 0), 0);
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
        topSubject: themes[0]?.canonicalSubject || "暂无重点多频诉求",
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
