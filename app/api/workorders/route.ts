import { NextRequest, NextResponse } from "next/server";
import { getRegionDb, type DB } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { toWorkorderDto, UNKNOWN_TOWN } from "@/lib/civic-dto";
import {
  buildMissingInfoFlagSql,
  buildUnresolvedMissingInfoSql,
  isUndefinedColumnError,
} from "@/lib/civic-missing";
import { isTownLabel } from "@/lib/admin-area";
import { clampPage, clampSize } from "@/lib/api-bounds";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { loadWorkorderStats, resolveSiteRegionId } from "@/lib/civic-queries";
import { clampTimeRef, timeWindow } from "@/lib/civic-time";
import { parseDomainProfile } from "@/lib/domain-profile";
import { requireAdmin } from "@/lib/auth/rbac";

// 表格和导出只用这些列。正文、电话在打开抽屉时走 GET /api/workorders/[id]。
const WORKORDER_LIST_COLUMNS = {
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
} as const;

/**
 * 面向 `tab=pending` / `status=PENDING` 的三段索引归并分页：
 * 严格等价于原 ORDER BY：
 *   0: status = 'REOPENED'                              -> updated_at DESC NULLS LAST, create_time DESC, id DESC
 *   1: status = 'PENDING' AND is_fake_closure IS TRUE   -> updated_at DESC NULLS LAST, create_time DESC, id DESC
 *   2: status = 'PENDING' AND is_fake_closure IS NOT TRUE -> create_time DESC, id DESC
 * 借助部分索引 idx_tickets_reopened_updated_at、idx_tickets_fake_closure_pending
 * 与复合索引 idx_tickets_status_create_time_id_desc，彻底消除 10 万+ 行全表 CASE 排序。
 */
async function fetchPendingOrderedPage(
  tenantDb: DB,
  nonStatusFilters: SQL[],
  size: number,
  offset: number
) {
  const b0Where = and(eq(ticketsTable.status, "REOPENED"), ...nonStatusFilters);
  const b1Where = and(
    eq(ticketsTable.status, "PENDING"),
    sql`${ticketsTable.isFakeClosure} IS TRUE`,
    ...nonStatusFilters
  );
  const b2Where = and(
    eq(ticketsTable.status, "PENDING"),
    sql`${ticketsTable.isFakeClosure} IS NOT TRUE`,
    ...nonStatusFilters
  );

  const priorityOrder = [
    sql`${ticketsTable.updatedAt} DESC NULLS LAST`,
    desc(ticketsTable.createTime),
    desc(ticketsTable.id),
  ];
  const normalOrder = [desc(ticketsTable.createTime), desc(ticketsTable.id)];

  if (offset === 0) {
    const [b0Rows, b1Rows] = await Promise.all([
      tenantDb
        .select(WORKORDER_LIST_COLUMNS)
        .from(ticketsTable)
        .where(b0Where)
        .orderBy(...priorityOrder)
        .limit(size),
      tenantDb
        .select(WORKORDER_LIST_COLUMNS)
        .from(ticketsTable)
        .where(b1Where)
        .orderBy(...priorityOrder)
        .limit(size),
    ]);
    const pinned = [...b0Rows, ...b1Rows].slice(0, size);
    const remaining = size - pinned.length;
    if (remaining <= 0) return pinned;
    const b2Rows = await tenantDb
      .select(WORKORDER_LIST_COLUMNS)
      .from(ticketsTable)
      .where(b2Where)
      .orderBy(...normalOrder)
      .limit(remaining);
    return [...pinned, ...b2Rows];
  }

  const [[b0CountRow], [b1CountRow]] = await Promise.all([
    tenantDb.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(b0Where),
    tenantDb.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(b1Where),
  ]);
  const b0Count = Number(b0CountRow?.count || 0);
  const b1Count = Number(b1CountRow?.count || 0);

  const queries: Array<ReturnType<typeof runSlice>> = [];
  const runSlice = (whereExpr: SQL | undefined, orderExprs: SQL[], limitN: number, offsetN: number) =>
    tenantDb
      .select(WORKORDER_LIST_COLUMNS)
      .from(ticketsTable)
      .where(whereExpr)
      .orderBy(...orderExprs)
      .limit(limitN)
      .offset(offsetN);

  let curOffset = offset;
  let remaining = size;

  if (remaining > 0 && curOffset < b0Count) {
    const take = Math.min(remaining, b0Count - curOffset);
    queries.push(runSlice(b0Where, priorityOrder, take, curOffset));
    remaining -= take;
    curOffset = 0;
  } else {
    curOffset = Math.max(0, curOffset - b0Count);
  }

  if (remaining > 0 && curOffset < b1Count) {
    const take = Math.min(remaining, b1Count - curOffset);
    queries.push(runSlice(b1Where, priorityOrder, take, curOffset));
    remaining -= take;
    curOffset = 0;
  } else {
    curOffset = Math.max(0, curOffset - b1Count);
  }

  if (remaining > 0) {
    queries.push(runSlice(b2Where, normalOrder, remaining, curOffset));
  }

  const chunks = await Promise.all(queries);
  return chunks.flat();
}

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

    const baseFilters: SQL[] = [];
    if (region) {
      if (region === UNKNOWN_TOWN || region === "未知") {
        baseFilters.push(
          or(
            isNull(ticketsTable.subdistrict),
            inArray(ticketsTable.subdistrict, ["", "未知", "未指定"])
          )!
        );
      } else if (isEcommerce || domainProfile.channels.includes(region)) {
        baseFilters.push(
          or(
            eq(ticketsTable.subdistrict, region),
            eq(ticketsTable.district, region)
          )!
        );
      } else if (region.length < 3 && !/(?:街道|镇|乡)$/.test(region)) {
        baseFilters.push(
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
          )!
        );
      } else {
        baseFilters.push(
          or(ilike(ticketsTable.subdistrict, `%${region}%`), ilike(ticketsTable.district, `%${region}%`))!
        );
      }
    }
    if (category) {
      baseFilters.push(eq(ticketsTable.sourceCategory, category));
    }

    const effectiveStatus = status || (tab === "pending" || tab === "progress" || tab === "finished" ? tab : "");
    let statusFilter: SQL | undefined;
    if (effectiveStatus === "RESOLVED" || effectiveStatus === "finished") {
      statusFilter = inArray(ticketsTable.status, ["RESOLVED", "FINISHED"]);
    } else if (effectiveStatus === "DISPATCHED") {
      statusFilter = eq(ticketsTable.status, "DISPATCHED");
    } else if (effectiveStatus === "IN_PROGRESS" || effectiveStatus === "progress") {
      statusFilter = inArray(ticketsTable.status, ["DISPATCHED", "VERIFIED", "IN_PROGRESS", "PROCESSING"]);
    } else if (effectiveStatus === "PENDING" || effectiveStatus === "pending") {
      statusFilter = inArray(ticketsTable.status, ["PENDING", "REOPENED"]);
    } else if (effectiveStatus === "REOPENED") {
      statusFilter = eq(ticketsTable.status, "REOPENED");
    }

    const normalizedUrgency = urgency.trim().toUpperCase();
    if (normalizedUrgency === "URGENT" || tab === "urgent") {
      baseFilters.push(eq(ticketsTable.urgency, "URGENT"));
    } else if (normalizedUrgency === "MEDIUM") {
      baseFilters.push(eq(ticketsTable.urgency, "MEDIUM"));
    } else if (normalizedUrgency === "NORMAL") {
      baseFilters.push(or(eq(ticketsTable.urgency, "NORMAL"), isNull(ticketsTable.urgency))!);
    }
    if (tab === "fake_closure") {
      baseFilters.push(eq(ticketsTable.isFakeClosure, true));
    }
    if (cluster === "1" || cluster === "multifreq" || tab === "multifreq") {
      baseFilters.push(isNotNull(ticketsTable.primaryThemeId));
    } else if (
      cluster === "0" ||
      cluster === "single" ||
      cluster === "unclustered" ||
      tab === "single" ||
      tab === "unclustered"
    ) {
      baseFilters.push(isNull(ticketsTable.primaryThemeId));
    }
    if (keyword) {
      baseFilters.push(
        or(
          ilike(ticketsTable.title, `%${keyword}%`),
          ilike(ticketsTable.content, `%${keyword}%`),
          ilike(ticketsTable.ticketNo, `%${keyword}%`),
          ilike(ticketsTable.summarizeTitle, `%${keyword}%`)
        )!
      );
    }
    if (time) {
      const { value: timeSnap } = await snapPromise;
      const win = timeWindow(time, clampTimeRef(timeSnap.latest ? new Date(timeSnap.latest) : null));
      if (win.from) baseFilters.push(gte(ticketsTable.createTime, win.from));
      if (win.to) baseFilters.push(lt(ticketsTable.createTime, win.to));
    }

    const isPendingTab = effectiveStatus === "pending" || effectiveStatus === "PENDING";
    const orderBys = isPendingTab
      ? [
          sql`CASE WHEN ${ticketsTable.status} = 'REOPENED' THEN 0 WHEN ${ticketsTable.isFakeClosure} IS TRUE THEN 1 ELSE 2 END ASC`,
          sql`CASE WHEN ${ticketsTable.status} = 'REOPENED' OR ${ticketsTable.isFakeClosure} IS TRUE THEN ${ticketsTable.updatedAt} END DESC NULLS LAST`,
          desc(ticketsTable.createTime),
          desc(ticketsTable.id),
        ]
      : tab === "fake_closure"
        ? [
            sql`CASE WHEN ${ticketsTable.status} = 'REOPENED' THEN 0 ELSE 1 END ASC`,
            sql`${ticketsTable.updatedAt} DESC NULLS LAST`,
            desc(ticketsTable.createTime),
            desc(ticketsTable.id),
          ]
        : [desc(ticketsTable.createTime), desc(ticketsTable.id)];

    const executeListAndCount = async (useMissingInfoFlag: boolean) => {
      const nonStatusFilters: SQL[] = [...baseFilters];
      if (tab === "missing_info") {
        nonStatusFilters.push(
          sql.raw(
            useMissingInfoFlag
              ? buildMissingInfoFlagSql()
              : buildUnresolvedMissingInfoSql("", isEcommerce)
          )
        );
      }
      const allFilters: SQL[] = statusFilter ? [statusFilter, ...nonStatusFilters] : nonStatusFilters;
      const where = allFilters.length ? and(...allFilters) : undefined;

      const countPromise = where
        ? tenantDb.select({ count: sql<number>`count(*)::int` }).from(ticketsTable).where(where)
        : Promise.resolve(null);

      const rowsPromise =
        isPendingTab && !keyword
          ? fetchPendingOrderedPage(tenantDb, nonStatusFilters, size, offset)
          : (() => {
              const q = tenantDb
                .select(WORKORDER_LIST_COLUMNS)
                .from(ticketsTable)
                .orderBy(...orderBys)
                .limit(size)
                .offset(offset);
              return where ? q.where(where) : q;
            })();

      const [countRes, rows] = await Promise.all([countPromise, rowsPromise]);
      return { countRes, rows };
    };

    const [snapRes, listAndCount] = await Promise.all([
      snapPromise,
      executeListAndCount(true).catch((err) => {
        if (tab === "missing_info" && isUndefinedColumnError(err, "is_missing_info")) {
          return executeListAndCount(false);
        }
        throw err;
      }),
    ]);
    const { countRes, rows } = listAndCount;
    const { stats, facets } = snapRes.value;

    return NextResponse.json({
      success: true,
      page,
      size,
      total: countRes ? Number(countRes[0]?.count || 0) : stats.total,
      data: rows.map((r) => toWorkorderDto(r, { isEcommerce })),
      stats,
      facets,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "workorders failed" }, { status: 500 });
  }
}
