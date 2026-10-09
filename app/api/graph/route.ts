import { NextResponse } from "next/server";
import type { GraphData, GraphLink, GraphNode, RiskLevel } from "@/backend/state";
import { getRegionDb } from "@/db/client";
import { themesTable } from "@/db/schema";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { desc } from "drizzle-orm";

const THEME_CAP = 60;

function asRisk(value: string | null | undefined): RiskLevel | undefined {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW") return value;
  return undefined;
}

/**
 * 没有页面调用。以前会把最近 100 张工单正文送进整条研判流水线。
 * 现在只读已有主题的主体和地点，不读工单，也不再抽取。
 */
export async function GET(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);

    const themes = await tenantDb
      .select({
        id: themesTable.id,
        title: themesTable.title,
        canonicalSubject: themesTable.canonicalSubject,
        canonicalLocation: themesTable.canonicalLocation,
        riskLevel: themesTable.riskLevel,
        ticketCount: themesTable.ticketCount,
      })
      .from(themesTable)
      .orderBy(desc(themesTable.ticketCount))
      .limit(THEME_CAP);

    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const seen = new Set<string>();

    for (const theme of themes) {
      nodes.push({
        id: theme.id,
        name: theme.title,
        type: "THEME",
        val: Math.max(1, theme.ticketCount || 1),
        riskLevel: asRisk(theme.riskLevel),
        ticketCount: theme.ticketCount || 0,
      });

      const subject = (theme.canonicalSubject || "").trim();
      if (subject) {
        const subjectId = `SUB-${subject}`;
        if (!seen.has(subjectId)) {
          seen.add(subjectId);
          nodes.push({ id: subjectId, name: subject, type: "SUBJECT", val: 4 });
        }
        links.push({ source: theme.id, target: subjectId, relation: "涉事主体" });
      }

      const location = (theme.canonicalLocation || "").trim();
      if (location) {
        const locationId = `LOC-${location}`;
        if (!seen.has(locationId)) {
          seen.add(locationId);
          nodes.push({ id: locationId, name: location, type: "LOCATION", val: 3 });
        }
        links.push({ source: theme.id, target: locationId, relation: "事发地点" });
      }
    }

    const data: GraphData = { nodes, links };
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load graph data" },
      { status: 500 }
    );
  }
}
