import { NextResponse } from "next/server";
import type { GraphData, GraphLink, GraphNode, RiskLevel } from "@/backend/state";
import { getRegionDb } from "@/db/client";
import { themesTable, ticketThemesTable, ticketsTable } from "@/db/schema";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { desc, eq, or, sql } from "drizzle-orm";

const THEME_CAP = 60;
const THEME_TICKET_CAP = 30;

type ExtendedGraphNode = GraphNode & {
  ticketNo?: string;
  status?: string;
  isFakeClosure?: boolean;
};

type ExtendedGraphLink = GraphLink & {
  isFakeClosure?: boolean;
};

function asRisk(value: string | null | undefined): RiskLevel | undefined {
  if (value === "HIGH" || value === "MEDIUM" || value === "LOW") return value;
  return undefined;
}

function themeNodeColor(risk?: RiskLevel): string {
  if (risk === "HIGH") return "#ef4444";
  if (risk === "MEDIUM") return "#f59e0b";
  return "#3b82f6";
}

/**
 * 全景/单主题实体关系图谱：
 * - 不传 themeId：只读全区前 THEME_CAP 个主题的 主题-主体-地点 关系网络
 * - 传 ?themeId=<id>：返回以该主题为中心、连向主体/地点及最近最多 30 条成员工单（含假闭环标记）的局部拓扑
 */
export async function GET(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);
    const { searchParams } = new URL(req.url);
    const themeId = (searchParams.get("themeId") || "").trim();

    if (themeId) {
      const themeRows = await tenantDb
        .select({
          id: themesTable.id,
          title: themesTable.title,
          canonicalSubject: themesTable.canonicalSubject,
          canonicalLocation: themesTable.canonicalLocation,
          riskLevel: themesTable.riskLevel,
          ticketCount: themesTable.ticketCount,
          handlingStatus: themesTable.handlingStatus,
        })
        .from(themesTable)
        .where(eq(themesTable.id, themeId))
        .limit(1);

      const theme = themeRows[0];
      if (!theme) {
        return NextResponse.json({ success: false, error: "not found" }, { status: 404 });
      }

      const nodes: ExtendedGraphNode[] = [];
      const links: ExtendedGraphLink[] = [];
      const riskLevel = asRisk(theme.riskLevel);

      nodes.push({
        id: theme.id,
        name: theme.title,
        type: "THEME",
        val: Math.max(8, Math.min(24, theme.ticketCount || 4)),
        color: themeNodeColor(riskLevel),
        riskLevel,
        ticketCount: theme.ticketCount || 0,
        status: theme.handlingStatus || "PENDING",
      });

      const subject = (theme.canonicalSubject || "").trim();
      if (subject) {
        const subjectId = `SUB-${subject}`;
        nodes.push({
          id: subjectId,
          name: subject,
          type: "SUBJECT",
          val: 6,
          color: "#2563eb",
        });
        links.push({ source: theme.id, target: subjectId, relation: "涉事主体" });
      }

      const location = (theme.canonicalLocation || "").trim();
      if (location) {
        const locationId = `LOC-${location}`;
        nodes.push({
          id: locationId,
          name: location,
          type: "LOCATION",
          val: 5,
          color: "#8b5cf6",
        });
        links.push({ source: theme.id, target: locationId, relation: "事发地点" });
      }

      const memberRows = await tenantDb
        .select({
          id: ticketsTable.id,
          ticketNo: ticketsTable.ticketNo,
          title: ticketsTable.title,
          summarizeTitle: ticketsTable.summarizeTitle,
          status: ticketsTable.status,
          isFakeClosure: ticketsTable.isFakeClosure,
          createTime: ticketsTable.createTime,
          excerpt: sql<string>`left(coalesce(${ticketsTable.maskedContent}, ${ticketsTable.content}), 80)`,
        })
        .from(ticketsTable)
        .where(
          or(
            eq(ticketsTable.primaryThemeId, themeId),
            sql`exists (select 1 from ticket_themes tt where tt.theme_id = ${themeId} and tt.ticket_id = ${ticketsTable.id})`
          )
        )
        .orderBy(sql`${ticketsTable.createTime} DESC NULLS LAST`, desc(ticketsTable.id))
        .limit(THEME_TICKET_CAP);

      for (const ticket of memberRows) {
        const isFakeClosure = Boolean(ticket.isFakeClosure);
        nodes.push({
          id: ticket.id,
          name: ticket.summarizeTitle || ticket.title || ticket.ticketNo,
          type: "TICKET",
          val: isFakeClosure ? 4 : 2,
          color: isFakeClosure ? "#e11d48" : "#64748b",
          ticketNo: ticket.ticketNo,
          status: ticket.status || "PENDING",
          isFakeClosure,
          meta: {
            ticketNo: ticket.ticketNo,
            status: ticket.status || "PENDING",
            isFakeClosure,
            content: ticket.excerpt || ticket.summarizeTitle || ticket.title || "",
          },
        });
        links.push({
          source: ticket.id,
          target: theme.id,
          relation: isFakeClosure ? "疑似假闭环复发" : "归属工单",
          ...(isFakeClosure ? { isFakeClosure: true } : {}),
        });
      }

      const data: GraphData = { nodes, links };
      return NextResponse.json({ success: true, data });
    }

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
