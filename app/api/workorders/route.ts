import { NextRequest, NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { toWorkorderDto, UNKNOWN_TOWN } from "@/lib/civic-dto";
import { isTownLabel } from "@/lib/admin-area";
import { clampPage, clampSize } from "@/lib/api-bounds";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { loadWorkorderStats, resolveSiteRegionId } from "@/lib/civic-queries";
import { clampTimeRef, timeWindow } from "@/lib/civic-time";
import { parseDomainProfile } from "@/lib/domain-profile";
import { requireAdmin } from "@/lib/auth/rbac";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const regionId = await resolveSiteRegionId(req);
    const { db: tenantDb, region: tenantRegion } = await getRegionDb(regionId);
    const domainProfile = parseDomainProfile(tenantRegion?.categoryConfigJson);
    const isEcommerce = domainProfile.domainType === "ECOMMERCE_CS";

    const { searchParams } = new URL(req.url);
    const page = clampPage(searchParams.get("page"));
    const size = clampSize(searchParams.get("size"));
    const offset = Math.min((page - 1) * size, 2_000_000_000);
    const regionQuery = (searchParams.get("region") || "").trim();
    const region =
      regionQuery &&
      regionQuery !== regionId &&
      (isEcommerce ||
        domainProfile.channels.includes(regionQuery) ||
        isTownLabel(regionQuery) ||
        regionQuery === UNKNOWN_TOWN ||
        regionQuery === "未知")
        ? regionQuery
        : "";
    const category = searchParams.get("category") || "";
    const status = searchParams.get("status") || "";
    const tab = searchParams.get("tab") || "";
    const keyword = searchParams.get("keyword") || "";
    const urgency = searchParams.get("urgency") || "";
    const time = searchParams.get("time") || "";
    const multifreq = searchParams.get("multifreq") || "";
    const cluster = searchParams.get("cluster") || multifreq;

    const snapPromise = cacheGetOrLoad(`workorders:stats:${regionId}`, () => loadWorkorderStats(regionId));

    const filters = [];
    if (region) {
      if (region === UNKNOWN_TOWN || region === "未知") {
        filters.push(
          or(
            isNull(ticketsTable.subdistrict),
            inArray(ticketsTable.subdistrict, ["", "未知", "未指定"])
          )
        );
      } else if (isEcommerce || domainProfile.channels.includes(region)) {
        filters.push(
          or(
            eq(ticketsTable.subdistrict, region),
            eq(ticketsTable.district, region)
          )
        );
      } else if (region.length < 3 && !/(?:街道|镇|乡)$/.test(region)) {
        filters.push(
          or(
            inArray(ticketsTable.subdistrict, [
              region,
              `${region}街道`,
              `${region}镇`,
              `${region}乡`,
            ]),
            eq(ticketsTable.district, region),
            ilike(ticketsTable.district, `%${region}镇%`),
            ilike(ticketsTable.district, `%${region}街道%`),
            ilike(ticketsTable.district, `%${region}乡%`),
            ilike(ticketsTable.district, `%${region}区%`)
          )
        );
      } else {
        filters.push(
          or(ilike(ticketsTable.subdistrict, `%${region}%`), ilike(ticketsTable.district, `%${region}%`))
        );
      }
    }
    if (category) {
      filters.push(eq(ticketsTable.sourceCategory, category));
    }

    const effectiveStatus = status || (tab === "pending" || tab === "progress" || tab === "finished" ? tab : "");
    if (effectiveStatus === "RESOLVED" || effectiveStatus === "finished") {
      filters.push(inArray(ticketsTable.status, ["RESOLVED", "FINISHED"]));
    } else if (effectiveStatus === "IN_PROGRESS" || effectiveStatus === "progress") {
      filters.push(
        inArray(ticketsTable.status, ["DISPATCHED", "VERIFIED", "IN_PROGRESS", "PROCESSING"])
      );
    } else if (effectiveStatus === "PENDING" || effectiveStatus === "pending") {
      filters.push(eq(ticketsTable.status, "PENDING"));
    }

    if (urgency === "URGENT" || tab === "urgent") {
      filters.push(eq(ticketsTable.urgency, "URGENT"));
    }
    if (tab === "fake_closure") {
      filters.push(eq(ticketsTable.isFakeClosure, true));
    }
    if (cluster === "1" || cluster === "multifreq" || tab === "multifreq") {
      filters.push(isNotNull(ticketsTable.primaryThemeId));
    } else if (
      cluster === "0" ||
      cluster === "single" ||
      cluster === "unclustered" ||
      tab === "single" ||
      tab === "unclustered"
    ) {
      filters.push(isNull(ticketsTable.primaryThemeId));
    }
    if (keyword) {
      filters.push(
        or(
          ilike(ticketsTable.title, `%${keyword}%`),
          ilike(ticketsTable.content, `%${keyword}%`),
          ilike(ticketsTable.ticketNo, `%${keyword}%`),
          ilike(ticketsTable.summarizeTitle, `%${keyword}%`)
        )
      );
    }
    if (time) {
      const { value: timeSnap } = await snapPromise;
      const win = timeWindow(time, clampTimeRef(timeSnap.latest ? new Date(timeSnap.latest) : null));
      if (win.from) filters.push(gte(ticketsTable.createTime, win.from));
      if (win.to) filters.push(lt(ticketsTable.createTime, win.to));
    }

    const where = filters.length ? and(...filters) : undefined;
    const countQ = tenantDb.select({ count: sql<number>`count(*)::int` }).from(ticketsTable);
    // 表格和导出只用这些列。正文、电话在打开抽屉时走 GET /api/workorders/[id]。
    const listQ = tenantDb
      .select({
        id: ticketsTable.id,
        ticketNo: ticketsTable.ticketNo,
        title: ticketsTable.title,
        summarizeTitle: ticketsTable.summarizeTitle,
        sourceCategory: ticketsTable.sourceCategory,
        subdistrict: ticketsTable.subdistrict,
        district: ticketsTable.district,
        urgency: ticketsTable.urgency,
        status: ticketsTable.status,
        createTime: ticketsTable.createTime,
        address: ticketsTable.address,
        primaryThemeId: ticketsTable.primaryThemeId,
        confidence: ticketsTable.confidence,
        channel: ticketsTable.channel,
        slaHours: ticketsTable.slaHours,
        stabilityRisk: ticketsTable.stabilityRisk,
        canonicalSubject: ticketsTable.canonicalSubject,
        eventType: ticketsTable.eventType,
        isFakeClosure: ticketsTable.isFakeClosure,
      })
      .from(ticketsTable)
      .orderBy(desc(ticketsTable.createTime), desc(ticketsTable.id))
      .limit(size)
      .offset(offset);
    const [snapRes, countRes, rows] = await Promise.all([
      snapPromise,
      where ? countQ.where(where) : Promise.resolve(null),
      where ? listQ.where(where) : listQ,
    ]);
    const { stats, facets } = snapRes.value;

    return NextResponse.json({
      success: true,
      page,
      size,
      total: countRes ? Number(countRes[0]?.count || 0) : stats.total,
      data: rows.map((r) => toWorkorderDto(r)),
      stats,
      facets,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "workorders failed" }, { status: 500 });
  }
}
