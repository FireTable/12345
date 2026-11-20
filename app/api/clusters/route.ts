import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { isTownLabel } from "@/lib/admin-area";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { filterClusterDtos, loadClusterBundle, resolveSiteRegionId } from "@/lib/civic-queries";
import { clampTimeRef, formatYmd } from "@/lib/civic-time";
import { parseDomainProfile } from "@/lib/domain-profile";
import { requireAdmin } from "@/lib/auth/rbac";

type ClusterDto = Awaited<ReturnType<typeof loadClusterBundle>>["dtos"][number];

function buildClustersPayload(filtered: ClusterDto[], facetTowns: string[]) {
  let totalMultiFreq = 0;
  let latestDay = "";
  const topClusters = new Array(filtered.length);
  const allClusters = new Array(filtered.length);

  for (let i = 0; i < filtered.length; i++) {
    const c = filtered[i];
    totalMultiFreq += c.count;
    if (c.last_date > latestDay) latestDay = c.last_date;
    const sampleTitles = c.sample_titles.slice(0, 1);
    topClusters[i] = {
      id: c.id,
      code: c.code,
      type: c.type,
      region: c.region,
      count: c.count,
      mode: c.mode,
      mode_name: c.mode_name,
      mode_icon: c.mode_icon,
      ai_confidence: c.ai_confidence,
      status: c.status,
      trend: c.trend,
      title: c.title,
      sample_titles: sampleTitles,
      first_date: c.first_date,
      last_date: c.last_date,
      unprocessed: c.unprocessed,
      urgency: c.urgency,
      days: c.days,
      communities: c.communities,
    };
    allClusters[i] = {
      id: c.id,
      type: c.type,
      region: c.region,
      count: c.count,
      sample_ids: c.sample_ids.slice(0, 1),
      sample_titles: sampleTitles,
      first_date: c.first_date,
      last_date: c.last_date,
      mode: c.mode,
      unprocessed: c.unprocessed,
      urgency: c.urgency,
      status: c.status.label,
    };
  }

  const todayKey = formatYmd(clampTimeRef(latestDay ? new Date(latestDay.replace(" ", "T")) : null));
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
    topClusters,
    allClusters,
    facets: {
      regions: facetTowns,
    },
  };
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const regionId = await resolveSiteRegionId(req);
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") || "";
    const regionQuery = (searchParams.get("region") || "").trim();
    const keyword = searchParams.get("keyword") || "";
    const status = searchParams.get("status") || "";
    const urgency = searchParams.get("urgency") || "";
    const tab = searchParams.get("tab") || "";

    const hasRegionFilter = Boolean(regionQuery && regionQuery !== regionId);
    if (!mode && !hasRegionFilter && !keyword && !status && !urgency && !tab) {
      const { value: cachedBody } = await cacheGetOrLoad(`clusters:json:v2:${regionId}`, async () => {
        const { value: bundle } = await cacheGetOrLoad(`clusters:bundle:v2:${regionId}`, () =>
          loadClusterBundle(regionId)
        );
        return new TextEncoder().encode(
          JSON.stringify(buildClustersPayload(bundle.dtos, bundle.facetTowns))
        );
      });
      return new NextResponse(cachedBody, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(cachedBody.byteLength),
        },
      });
    }

    const [{ region: tenantRegion }, { value: bundle }] = await Promise.all([
      getRegionDb(regionId),
      cacheGetOrLoad(`clusters:bundle:v2:${regionId}`, () => loadClusterBundle(regionId)),
    ]);
    const domainProfile = parseDomainProfile(tenantRegion?.categoryConfigJson);
    const isEcommerce = domainProfile.domainType === "ECOMMERCE_CS";

    // ?region= 也用来选站点。fs_shunde 这种站点 id 不是镇街，不能拿去滤主题；电商渠道/仓网需按业务域放行。
    const region =
      hasRegionFilter &&
      (isEcommerce ||
        domainProfile.channels.includes(regionQuery) ||
        bundle.facetTowns.includes(regionQuery) ||
        isTownLabel(regionQuery) ||
        regionQuery === "未知")
        ? regionQuery
        : "";

    const filtered = filterClusterDtos(bundle.dtos, { mode, region, keyword, status, urgency, tab });
    return NextResponse.json(buildClustersPayload(filtered, bundle.facetTowns));
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
