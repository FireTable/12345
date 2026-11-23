import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { isTownLabel } from "@/lib/admin-area";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { clusterStoryPenalty } from "@/lib/civic-cluster";
import { normalizeStatusCode } from "@/lib/civic-dto";
import { filterClusterDtos, loadClusterBundle, resolveSiteRegionId } from "@/lib/civic-queries";
import { clampTimeRef, formatYmd, inTimeWindow } from "@/lib/civic-time";
import { parseDomainProfile } from "@/lib/domain-profile";
import { requireAdmin } from "@/lib/auth/rbac";

type ClusterDto = Awaited<ReturnType<typeof loadClusterBundle>>["dtos"][number];
type QuadKey = "tl" | "tr" | "bl" | "br";

const PRIVATE_CACHE_HEADERS = {
  "cache-control": "private, max-age=15, stale-while-revalidate=60",
  vary: "Cookie, x-region-id",
};

const STATUS_SORT_ORDER: Record<string, number> = {
  PENDING: 0,
  IN_PROGRESS: 1,
  RESOLVED: 2,
};

function quadKeyFor(urgency: ClusterDto["urgency"]): QuadKey {
  const urgent = urgency === "urgent" || urgency === "medium";
  const important = urgency === "urgent" || urgency === "high";
  if (urgent && important) return "tr";
  if (!urgent && important) return "tl";
  if (urgent && !important) return "br";
  return "bl";
}

function toClusterListItem(c: ClusterDto) {
  const item: Record<string, unknown> = {
    id: c.id,
    code: c.code,
    type: c.type,
    region: c.region,
    count: c.count,
    mode: c.mode,
    mode_name: c.mode_name,
    mode_icon: c.mode_icon,
    ai_confidence: c.ai_confidence,
    status: {
      code: c.status.code,
      label: c.status.label,
      progress: c.status.progress,
      owner: c.status.owner,
    },
    trend: c.trend,
    title: c.title,
    first_date: c.first_date,
    last_date: c.last_date,
    unprocessed: c.unprocessed,
    urgency: c.urgency,
    days: c.days,
    communities: c.communities,
  };
  if (c.sample_titles.length > 0) {
    item.sample_titles = c.sample_titles.slice(0, 1);
  }
  return item;
}

function toLegacyAllClusterItem(c: ClusterDto) {
  return {
    id: c.id,
    type: c.type,
    region: c.region,
    count: c.count,
    sample_ids: c.sample_ids.slice(0, 1),
    sample_titles: c.sample_titles.slice(0, 1),
    first_date: c.first_date,
    last_date: c.last_date,
    mode: c.mode,
    unprocessed: c.unprocessed,
    urgency: c.urgency,
    status: c.status.label,
  };
}

interface RegionClusterIndex {
  dtos: ClusterDto[];
  storySorted: ClusterDto[];
  facetTowns: string[];
  isEcommerce: boolean;
  hasGeoMap: boolean;
  channels: string[];
  totalClusters: number;
  totalMultiFreq: number;
  latestDay: string;
  todayKey: string;
  counts: {
    all: number;
    today: number;
    pending: number;
    progress: number;
    resolved: number;
    urgent: number;
  };
}

async function loadRegionClusterIndex(regionId: string): Promise<RegionClusterIndex> {
  const { value } = await cacheGetOrLoad(`clusters:${regionId}:index:v3`, async () => {
    const [{ region: tenantRegion }, { value: bundle }] = await Promise.all([
      getRegionDb(regionId),
      cacheGetOrLoad(`clusters:bundle:v2:${regionId}`, () => loadClusterBundle(regionId)),
    ]);
    const domainProfile = parseDomainProfile(tenantRegion?.categoryConfigJson);
    const dtos = bundle.dtos;

    let totalMultiFreq = 0;
    let latestDay = "";
    for (let i = 0; i < dtos.length; i++) {
      const c = dtos[i];
      totalMultiFreq += c.count;
      const d = c.last_date || c.first_date || "";
      if (d > latestDay) latestDay = d;
    }

    const todayKey = formatYmd(
      clampTimeRef(latestDay ? new Date(latestDay.replace(" ", "T")) : null)
    );

    let today = 0;
    let pending = 0;
    let progress = 0;
    let resolved = 0;
    let urgent = 0;
    for (let i = 0; i < dtos.length; i++) {
      const c = dtos[i];
      if (c.last_date === todayKey || c.first_date === todayKey) today += 1;
      const code = c.status.code || normalizeStatusCode(c.status.label);
      if (code === "PENDING") pending += 1;
      else if (code === "IN_PROGRESS") progress += 1;
      else if (code === "RESOLVED") resolved += 1;
      if (c.urgency === "urgent") urgent += 1;
    }

    // 预排序一次，供 /themes 分页查询零开销直接切片
    const storySorted = dtos.slice().sort((a, b) => {
      const pa = clusterStoryPenalty(a);
      const pb = clusterStoryPenalty(b);
      if (pa !== pb) return pa - pb;
      const sa = STATUS_SORT_ORDER[a.status.code || "PENDING"] ?? 0;
      const sb = STATUS_SORT_ORDER[b.status.code || "PENDING"] ?? 0;
      if (sa !== sb) return sa - sb;
      return b.count - a.count;
    });

    return {
      dtos,
      storySorted,
      facetTowns: bundle.facetTowns,
      isEcommerce: domainProfile.domainType === "ECOMMERCE_CS",
      hasGeoMap: domainProfile.hasGeoMap !== false,
      channels: domainProfile.channels,
      totalClusters: dtos.length,
      totalMultiFreq,
      latestDay,
      todayKey,
      counts: {
        all: dtos.length,
        today,
        pending,
        progress,
        resolved,
        urgent,
      },
    } satisfies RegionClusterIndex;
  });
  return value;
}

function buildClustersPayload(
  filtered: ClusterDto[],
  index: RegionClusterIndex,
  options?: { includeAll?: boolean }
) {
  let totalMultiFreq = 0;
  let latestDay = "";
  const topClusters = new Array(filtered.length);
  const allClusters = options?.includeAll ? new Array(filtered.length) : undefined;

  for (let i = 0; i < filtered.length; i++) {
    const c = filtered[i];
    totalMultiFreq += c.count;
    if (c.last_date > latestDay) latestDay = c.last_date;
    topClusters[i] = toClusterListItem(c);
    if (allClusters) {
      allClusters[i] = toLegacyAllClusterItem(c);
    }
  }

  const todayKey = formatYmd(
    clampTimeRef(latestDay ? new Date(latestDay.replace(" ", "T")) : null)
  );
  let todayNew = 0;
  for (let i = 0; i < filtered.length; i++) {
    const c = filtered[i];
    if (c.last_date === todayKey || c.first_date === todayKey) todayNew += 1;
  }

  return {
    success: true,
    totalClusters: filtered.length,
    totalMultiFreq,
    todayNew,
    latestDay,
    counts: index.counts,
    topClusters,
    ...(allClusters ? { allClusters } : {}),
    facets: {
      regions: index.facetTowns,
    },
  };
}

function buildMultifreqSummaryPayload(
  index: RegionClusterIndex,
  params: {
    region: string;
    confMin: number;
    minCount: number;
    timeLabel: string;
  }
) {
  const ref = clampTimeRef(
    index.latestDay ? new Date(index.latestDay.replace(" ", "T")) : null
  );
  const filtered: ClusterDto[] = [];
  for (let i = 0; i < index.dtos.length; i++) {
    const r = index.dtos[i];
    if (params.region && !r.region.includes(params.region)) continue;
    if ((r.ai_confidence ?? 100) < params.confMin) continue;
    if (r.count < params.minCount) continue;
    if (!inTimeWindow(r.last_date || r.first_date, params.timeLabel, ref)) continue;
    filtered.push(r);
  }

  let pendingCount = 0;
  let urgentCount = 0;
  let todayNew = 0;
  let totalMultiFreq = 0;
  const clusterByRegion: Record<string, number> = {};
  const quadrantCounts: Record<QuadKey, number> = { tl: 0, tr: 0, bl: 0, br: 0 };
  const byQ: Record<QuadKey, ClusterDto[]> = { tl: [], tr: [], bl: [], br: [] };

  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    totalMultiFreq += r.count;
    const statusCode = r.status.code || normalizeStatusCode(r.status.label);
    if (
      r.status.code
        ? r.status.code === "PENDING"
        : r.status.label === "待派单" || r.status.label === "未处理"
    ) {
      pendingCount += 1;
    }
    if (r.urgency === "urgent") urgentCount += 1;
    if (r.last_date === index.todayKey || r.first_date === index.todayKey) {
      todayNew += 1;
    }
    if (r.region) {
      if (index.hasGeoMap) {
        clusterByRegion[r.region] = (clusterByRegion[r.region] || 0) + 1;
      } else {
        const head = r.region.split(" 等 ")[0];
        for (const part of head.split(" · ")) {
          const name = part.trim();
          if (name) clusterByRegion[name] = (clusterByRegion[name] || 0) + 1;
        }
      }
    }
    if (statusCode !== "RESOLVED") {
      const q = quadKeyFor(r.urgency);
      quadrantCounts[q] += 1;
      byQ[q].push(r);
    }
  }

  // 与 QuadrantBoard 语义完全一致：每象限按工单量 Top 25 精选渲染圆点，真实总数通过 quadrantCounts 下发
  const quadrantClusters: Array<{
    id: string;
    type: string;
    region: string;
    count: number;
    urgency: ClusterDto["urgency"];
    status: { code?: string; label: string };
  }> = [];
  for (const q of ["tl", "tr", "bl", "br"] as QuadKey[]) {
    const arr = byQ[q];
    if (arr.length > 25) {
      arr.sort((a, b) => (b.count || 0) - (a.count || 0));
    }
    const take = Math.min(arr.length, 25);
    for (let i = 0; i < take; i++) {
      const c = arr[i];
      quadrantClusters.push({
        id: c.id,
        type: c.type,
        region: c.region,
        count: c.count,
        urgency: c.urgency,
        status: {
          code: c.status.code,
          label: c.status.label,
        },
      });
    }
  }

  // TOP 5 多频聚类（与 multifreq-client.tsx 完全一致的排序口径）
  const top5 = filtered
    .slice()
    .sort((a, b) => clusterStoryPenalty(a) - clusterStoryPenalty(b) || b.count - a.count)
    .slice(0, 5)
    .map(toClusterListItem);

  return {
    success: true,
    view: "summary" as const,
    totalClusters: index.totalClusters,
    filteredTotal: filtered.length,
    totalMultiFreq,
    pendingCount,
    urgentCount,
    todayNew,
    latestDay: index.latestDay,
    clusterByRegion,
    quadrantCounts,
    quadrantClusters,
    topClusters: top5,
    facets: {
      regions: index.facetTowns,
    },
  };
}

function resolveRegionFilter(
  regionQuery: string,
  regionId: string,
  index: RegionClusterIndex
): string {
  const hasRegionFilter = Boolean(regionQuery && regionQuery !== regionId);
  if (!hasRegionFilter) return "";
  if (
    index.isEcommerce ||
    index.channels.includes(regionQuery) ||
    index.facetTowns.includes(regionQuery) ||
    isTownLabel(regionQuery) ||
    regionQuery === "未知"
  ) {
    return regionQuery;
  }
  return "";
}

function jsonBytesResponse(bytes: Uint8Array) {
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(bytes.byteLength),
      ...PRIVATE_CACHE_HEADERS,
    },
  });
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const regionId = await resolveSiteRegionId(req);
    const { searchParams } = new URL(req.url);
    const view = (searchParams.get("view") || "").trim().toLowerCase();
    const mode = searchParams.get("mode") || "";
    const regionQuery = (searchParams.get("region") || "").trim();
    const keyword = searchParams.get("keyword") || "";
    const status = searchParams.get("status") || "";
    const urgency = searchParams.get("urgency") || "";
    const tab = searchParams.get("tab") || "";
    const sort = (searchParams.get("sort") || "").trim().toLowerCase();
    const todayOnly =
      searchParams.get("todayOnly") === "1" || searchParams.get("todayOnly") === "true";
    const includeAll = searchParams.get("includeAll") === "1";

    const pageRaw = searchParams.get("page");
    const sizeRaw = searchParams.get("size") ?? searchParams.get("limit");
    const isPaged = pageRaw !== null || sizeRaw !== null;

    // 1. /multifreq 轻量汇总视图：从 ~6.8MB 压降至 ~15KB
    if (view === "summary") {
      const confMinRaw = Number(searchParams.get("confMin") ?? "85");
      const minCountRaw = Number(searchParams.get("minCount") ?? "2");
      const confMin = Number.isFinite(confMinRaw) ? Math.max(0, Math.min(100, Math.round(confMinRaw))) : 85;
      const minCount = Number.isFinite(minCountRaw) ? Math.max(1, Math.min(1000, Math.round(minCountRaw))) : 2;
      const timeLabel = (searchParams.get("timeLabel") || "近 7 天").trim();

      const index = await loadRegionClusterIndex(regionId);
      const region = resolveRegionFilter(regionQuery, regionId, index);

      // 默认参数命中预编码字节缓存
      if (!region && confMin === 85 && minCount === 2 && timeLabel === "近 7 天") {
        const { value: cachedBytes } = await cacheGetOrLoad(
          `clusters:${regionId}:summary:default`,
          async () =>
            new TextEncoder().encode(
              JSON.stringify(
                buildMultifreqSummaryPayload(index, {
                  region: "",
                  confMin: 85,
                  minCount: 2,
                  timeLabel: "近 7 天",
                })
              )
            )
        );
        return jsonBytesResponse(cachedBytes);
      }

      return NextResponse.json(
        buildMultifreqSummaryPayload(index, { region, confMin, minCount, timeLabel }),
        { headers: PRIVATE_CACHE_HEADERS }
      );
    }

    // 2. 分页列表视图（/themes、/sandbox 等按需取页，从 ~6.8MB 压降至 ~5KB）
    if (isPaged) {
      const pageNum = Math.max(1, Number.parseInt(pageRaw || "1", 10) || 1);
      const sizeNum = Math.max(
        1,
        Math.min(200, Number.parseInt(sizeRaw || "15", 10) || 15)
      );

      const index = await loadRegionClusterIndex(regionId);
      const region = resolveRegionFilter(regionQuery, regionId, index);
      const isDefaultPage1 =
        pageNum === 1 &&
        sizeNum === 15 &&
        sort === "story" &&
        !mode &&
        !region &&
        !keyword &&
        !status &&
        !urgency &&
        (!tab || tab === "all") &&
        !todayOnly;

      if (isDefaultPage1) {
        const { value: cachedBytes } = await cacheGetOrLoad(
          `clusters:${regionId}:page1:story:15`,
          async () => {
            const slice = index.storySorted.slice(0, 15);
            return new TextEncoder().encode(
              JSON.stringify({
                success: true,
                page: 1,
                size: 15,
                total: index.totalClusters,
                totalClusters: index.totalClusters,
                totalMultiFreq: index.totalMultiFreq,
                todayNew: index.counts.today,
                latestDay: index.latestDay,
                counts: index.counts,
                topClusters: slice.map(toClusterListItem),
                facets: {
                  regions: index.facetTowns,
                },
              })
            );
          }
        );
        return jsonBytesResponse(cachedBytes);
      }

      const source = sort === "story" ? index.storySorted : index.dtos;
      let filtered = filterClusterDtos(source, {
        mode,
        region,
        keyword,
        status,
        urgency,
        tab: tab === "all" ? "" : tab,
      });
      if (todayOnly) {
        filtered = filtered.filter(
          (c) => c.last_date === index.todayKey || c.first_date === index.todayKey
        );
      }

      const pages = Math.max(1, Math.ceil(filtered.length / sizeNum));
      const currentPage = Math.min(pageNum, pages);
      const offset = (currentPage - 1) * sizeNum;
      const slice = filtered.slice(offset, offset + sizeNum);

      return NextResponse.json(
        {
          success: true,
          page: currentPage,
          size: sizeNum,
          total: filtered.length,
          totalClusters: index.totalClusters,
          totalMultiFreq: index.totalMultiFreq,
          todayNew: index.counts.today,
          latestDay: index.latestDay,
          counts: index.counts,
          topClusters: slice.map(toClusterListItem),
          facets: {
            regions: index.facetTowns,
          },
        },
        { headers: PRIVATE_CACHE_HEADERS }
      );
    }

    // 3. 全量模式（向后兼容 + CSV 导出）：默认移除冗余 allClusters 双份拷贝
    const hasRegionFilter = Boolean(regionQuery && regionQuery !== regionId);
    if (
      !mode &&
      !hasRegionFilter &&
      !keyword &&
      !status &&
      !urgency &&
      (!tab || tab === "all") &&
      !todayOnly &&
      !sort &&
      !includeAll
    ) {
      const { value: cachedBody } = await cacheGetOrLoad(`clusters:${regionId}:json:v3`, async () => {
        const index = await loadRegionClusterIndex(regionId);
        return new TextEncoder().encode(
          JSON.stringify(buildClustersPayload(index.dtos, index, { includeAll: false }))
        );
      });
      return jsonBytesResponse(cachedBody);
    }

    const index = await loadRegionClusterIndex(regionId);
    const region = resolveRegionFilter(regionQuery, regionId, index);
    const source = sort === "story" ? index.storySorted : index.dtos;
    let filtered = filterClusterDtos(source, {
      mode,
      region,
      keyword,
      status,
      urgency,
      tab: tab === "all" ? "" : tab,
    });
    if (todayOnly) {
      filtered = filtered.filter(
        (c) => c.last_date === index.todayKey || c.first_date === index.todayKey
      );
    }
    return NextResponse.json(buildClustersPayload(filtered, index, { includeAll }), {
      headers: PRIVATE_CACHE_HEADERS,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
