import { NextResponse } from "next/server";
import { isTownLabel } from "@/lib/admin-area";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { filterClusterDtos, loadClusterBundle } from "@/lib/civic-queries";
import { clampTimeRef, formatYmd } from "@/lib/civic-time";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export async function GET(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") || "";
    const regionQuery = searchParams.get("region") || "";
    // ?region= 也用来选站点。fs_shunde 这种站点 id 不是镇街，不能拿去滤主题。
    const region =
      regionQuery !== regionId && (isTownLabel(regionQuery) || regionQuery === "未知")
        ? regionQuery
        : "";
    const keyword = searchParams.get("keyword") || "";
    const status = searchParams.get("status") || "";
    const urgency = searchParams.get("urgency") || "";
    const tab = searchParams.get("tab") || "";

    // v2：列表包不再带正文。热更新前的旧缓存形状对不上。
    const { value: bundle } = await cacheGetOrLoad(`clusters:bundle:v2:${regionId}`, () => loadClusterBundle(regionId));
    const filtered = filterClusterDtos(bundle.dtos, { mode, region, keyword, status, urgency, tab });

    const totalMultiFreq = filtered.reduce((a, c) => a + c.count, 0);
    const latestDay = filtered.reduce((acc, c) => (c.last_date > acc ? c.last_date : acc), "");
    const todayKey = formatYmd(clampTimeRef(latestDay ? new Date(latestDay.replace(" ", "T")) : null));
    const todayNew = filtered.filter((c) => c.last_date === todayKey || c.first_date === todayKey).length;
    const list = filtered.map((c) => ({
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
      sample_titles: c.sample_titles.slice(0, 1),
      first_date: c.first_date,
      last_date: c.last_date,
      unprocessed: c.unprocessed,
      urgency: c.urgency,
      days: c.days,
      communities: c.communities,
    }));

    return NextResponse.json({
      success: true,
      totalClusters: filtered.length,
      totalMultiFreq,
      todayNew,
      latestDay,
      topClusters: list,
      allClusters: filtered.map((c) => ({
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
      })),
      facets: {
        regions: bundle.facetTowns,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
