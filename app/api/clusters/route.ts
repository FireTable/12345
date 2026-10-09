import { NextResponse } from "next/server";
import { isTownLabel } from "@/lib/admin-area";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { filterClusterDtos, loadClusterBundle } from "@/lib/civic-queries";
import { clampTimeRef, formatYmd } from "@/lib/civic-time";
import { toClusterDto } from "@/lib/civic-dto";
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

    const { value: bundle } = await cacheGetOrLoad(`clusters:bundle:${regionId}`, () => loadClusterBundle(regionId));
    const { themeRows, dtos, samplesByTheme } = bundle;
    const filtered = filterClusterDtos(dtos, { mode, region, keyword, status, urgency, tab });

    const allForFacets = themeRows.map((t) => {
      const base = toClusterDto({
        ...t,
        firstAt: t.firstAt,
        lastAt: t.lastAt,
        tickets: (samplesByTheme.get(t.id) || []).slice(0, 1),
      });
      return base.region;
    });

    const totalMultiFreq = filtered.reduce((a, c) => a + c.count, 0);
    const latestDay = filtered.reduce((acc, c) => (c.last_date > acc ? c.last_date : acc), "");
    const todayKey = formatYmd(clampTimeRef(latestDay ? new Date(latestDay.replace(" ", "T")) : null));
    const todayNew = filtered.filter((c) => c.last_date === todayKey || c.first_date === todayKey).length;

    return NextResponse.json({
      success: true,
      totalClusters: filtered.length,
      totalMultiFreq,
      todayNew,
      latestDay,
      topClusters: filtered,
      allClusters: filtered.map((c) => ({
        id: c.id,
        type: c.type,
        region: c.region,
        count: c.count,
        sample_ids: c.sample_ids,
        sample_titles: c.sample_titles,
        first_date: c.first_date,
        last_date: c.last_date,
        mode: c.mode,
        unprocessed: c.unprocessed,
        urgency: c.urgency,
        status: c.status.label,
      })),
      facets: {
        regions: (() => {
          const set = new Set(allForFacets.filter((r) => isTownLabel(r) || r === "未知"));
          const list = Array.from(set).filter((r) => r !== "未知").sort((a, b) => a.localeCompare(b, "zh-CN"));
          if (set.has("未知")) list.push("未知");
          return list;
        })(),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
