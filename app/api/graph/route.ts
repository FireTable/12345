import { NextResponse } from "next/server";
import type { GraphData, GraphLink, GraphNode, RiskLevel } from "@/backend/state";
import { getRegionDb } from "@/db/client";
import { themesTable } from "@/db/schema";
import { cacheGetOrLoad, CIVIC_CACHE_TTL_MS } from "@/lib/civic-cache";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { desc, eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/rbac";

const THEME_CAP = 60;
const THEME_TICKET_CAP = 30;
const THEME_GRAPH_TTL_MS = 30_000;

class ThemeNotFoundError extends Error {}

type ExtendedGraphNode = GraphNode & {
  ticketNo?: string;
  status?: string;
  isFakeClosure?: boolean;
};

type ExtendedGraphLink = GraphLink & {
  isFakeClosure?: boolean;
};

type ThemeMemberRow = {
  id: string;
  ticketNo: string;
  title: string | null;
  summarizeTitle: string | null;
  status: string | null;
  isFakeClosure: boolean | null;
  createTime: Date | string | null;
  excerpt: string | null;
};

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

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
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);
    const { searchParams } = new URL(req.url);
    const themeId = (searchParams.get("themeId") || "").trim();

    if (themeId) {
      let data: GraphData;
      try {
        const result = await cacheGetOrLoad(
          `themes:${regionId}:graph:theme:${themeId}`,
          async () => {
            const cap = sql.raw(String(THEME_TICKET_CAP));
            const [themeRows, memberRes] = await Promise.all([
              tenantDb
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
                .limit(1),
              tenantDb.execute(sql`
                WITH member_ids AS (
                  (
                    SELECT id
                    FROM tickets
                    WHERE primary_theme_id = ${themeId}
                    ORDER BY create_time DESC NULLS LAST, id DESC
                    LIMIT ${cap}
                  )
                  UNION
                  (
                    SELECT t.id
                    FROM ticket_themes tt
                    INNER JOIN tickets t ON t.id = tt.ticket_id
                    WHERE tt.theme_id = ${themeId}
                    ORDER BY t.create_time DESC NULLS LAST, t.id DESC
                    LIMIT ${cap}
                  )
                )
                SELECT
                  t.id,
                  t.ticket_no AS "ticketNo",
                  t.title,
                  t.summarize_title AS "summarizeTitle",
                  t.status,
                  t.is_fake_closure AS "isFakeClosure",
                  t.create_time AS "createTime",
                  left(coalesce(t.masked_content, t.content), 80) AS excerpt
                FROM member_ids m
                INNER JOIN tickets t ON t.id = m.id
                ORDER BY t.create_time DESC NULLS LAST, t.id DESC
                LIMIT ${cap}
              `),
            ]);

            const theme = themeRows[0];
            if (!theme) {
              throw new ThemeNotFoundError();
            }

            const memberRows = rowsOf<ThemeMemberRow>(memberRes);
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

            return { nodes, links } satisfies GraphData;
          },
          THEME_GRAPH_TTL_MS
        );
        data = result.value;
      } catch (err) {
        if (err instanceof ThemeNotFoundError) {
          return NextResponse.json({ success: false, error: "not found" }, { status: 404 });
        }
        throw err;
      }
      return NextResponse.json({ success: true, data });
    }

    const { value: data } = await cacheGetOrLoad(
      `themes:${regionId}:graph:panorama`,
      async () => {
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

        return { nodes, links } satisfies GraphData;
      },
      CIVIC_CACHE_TTL_MS
    );
    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load graph data" },
      { status: 500 }
    );
  }
}
