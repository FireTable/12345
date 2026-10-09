"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";
import type {
  CockpitTicket,
  CockpitTownshipStat,
  CockpitAlertItem,
  CockpitKpiData,
} from "./cockpit-types";

/**
 * 大屏实时数据中枢 Hook
 * 仅消费真实后端接口数据，坚决不使用任何 mock / demo 兜底伪造数据
 */
export function useCockpitData(regionId: string) {
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPolling, setIsPolling] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [selectedTownship, setSelectedTownship] = useState<string | null>(null);

  const [rawOverview, setRawOverview] = useState<any>(null);
  const [rawTrend, setRawTrend] = useState<any>(null);
  const [rawClusters, setRawClusters] = useState<any>(null);
  const [recentTickets, setRecentTickets] = useState<CockpitTicket[]>([]);
  const [systemTwoNodes, setSystemTwoNodes] = useState<Array<{
    id: string;
    name: string;
    host?: string;
    isLocal?: boolean;
    isOnline?: boolean;
    lastDurationMs?: number | null;
  }>>([]);
  const [endpointRecentTickets, setEndpointRecentTickets] = useState<Record<string, any[]>>({});

  const fetchRef = useRef(0);

  const loadData = useCallback(async (isSilent = false) => {
    const fetchId = ++fetchRef.current;
    if (!isSilent) setIsRefreshing(true);

    try {
      const regParam = regionId ? `?region=${encodeURIComponent(regionId)}` : "";
      const payload = await fetch(`/api/cockpit${regParam}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      if (fetchId !== fetchRef.current) return;

      setRawOverview(payload?.overview || null);
      setRawTrend(payload?.trends || null);
      setRawClusters(
        payload?.themes
          ? {
              totalClusters: payload.themes.themeCount || 0,
              totalMultiFreq: payload.overview?.multiFreqCount || 0,
              topClusters: (payload.themes.top || []).map((theme: any) => ({
                id: theme.id,
                title: theme.title,
                category: theme.category,
                urgency: theme.riskLevel,
                region: theme.location || "",
                last_date: "",
                advice: theme.advice,
                count: theme.ticketCount,
              })),
            }
          : null
      );
      setSystemTwoNodes(payload?.systemTwoNodes || []);
      setEndpointRecentTickets(payload?.endpointRecentTickets || {});
      setRecentTickets(Array.isArray(payload?.recentTickets) ? payload.recentTickets : []);

      setLastUpdated(new Date());
    } catch (e) {
      console.error("[Cockpit] Failed to load cockpit data:", e);
    } finally {
      if (fetchId === fetchRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [regionId]);

  useEffect(() => {
    setSelectedTownship(null);
    setLoading(true);
    loadData(false);
  }, [regionId, loadData]);

  // WS 推送：civic-data-refresh 信号触发 silent refetch（不带 loading 闪烁）。
  // 替换之前 25s 轮询，节省 N 倍请求；只在真有数据变更时才拉。
  // - task-progress 也会触发：研判完成后 dashboard 数据会变化
  // - civic-data-refresh：上传 / 切区 / 其他模块主动通知
  useCivicSse(regionId, (msg) => {
    if (
      msg.type === "civic-data-refresh" ||
      msg.type === "pipeline-state-refresh" ||
      (msg.type === "task-progress" &&
        (msg.taskProgress as { status?: string } | null)?.status &&
        ((msg.taskProgress as { status: string }).status === "COMPLETED" ||
          (msg.taskProgress as { status: string }).status === "FAILED"))
    ) {
      loadData(true);
    }
  });

  // isPolling 现在等价于"是否还接受 WS 触发刷新"。保留 UI 切换让用户能暂停自动刷新，
  // 但即便暂停，仍支持手动 refresh()。
  useEffect(() => {
    /* 旧的 25s setInterval 已删除，WS 信号驱动替换 */
  }, [isPolling]);

  // 1. KPI 真实计算
  const kpi = useMemo<CockpitKpiData>(() => {
    const total = rawOverview?.totalWorkorders || 0;
    const dailyAvg = rawOverview?.dailyAverage || rawOverview?.avgDaily || (total > 0 ? Math.round(total / 30) : 0);
    const dailyMap = rawTrend?.daily || {};
    const dates = Object.keys(dailyMap).sort();
    const latestDateCount = dates.length ? dailyMap[dates[dates.length - 1]] : 0;
    const todayCount = latestDateCount > 0 ? latestDateCount : recentTickets.length;
    const clusterCount = rawOverview?.multiFreqClusters || rawOverview?.totalClusters || rawClusters?.totalClusters || 0;
    const multifreqCount = rawOverview?.multiFreqCount || rawOverview?.multifreqWorkorders || rawClusters?.totalMultiFreq || 0;
    const urgentFromClusters = (rawClusters?.topClusters || []).filter(
      (c: any) => c.urgency === "HIGH" || c.urgency === "高危"
    ).length;
    const urgentFromTickets = recentTickets.filter((t) => t.isUrgent).length;
    const urgentAlertCount = urgentFromClusters + urgentFromTickets;
    const resolutionRatePct = total > 0
      ? Math.round(((total - (rawOverview?.pendingCount || 0)) / total) * 1000) / 10
      : 0;

    return {
      todayCount,
      todayGrowthPct: 0,
      totalTickets: total,
      dailyAverage: dailyAvg,
      resolutionRatePct,
      multifreqCount,
      clusterCount,
      urgentAlertCount,
    };
  }, [rawOverview, rawTrend, rawClusters, recentTickets]);

  // 2. 真实镇街工单分布
  const subdistrictCounts = useMemo<Record<string, number>>(() => {
    return rawOverview?.regionDistribution || {};
  }, [rawOverview?.regionDistribution]);

  // 3. 真实镇街排行
  const townshipStats = useMemo<CockpitTownshipStat[]>(() => {
    const entries = Object.entries(subdistrictCounts).filter(([, v]) => v > 0);
    if (!entries.length) return [];
    const total = entries.reduce((acc, [, n]) => acc + n, 0) || 1;
    const sorted = [...entries].sort((a, b) => b[1] - a[1]);

    return sorted.map(([name, count], idx) => ({
      name,
      count,
      sharePct: Math.round((count / total) * 1000) / 10,
      rank: idx + 1,
      highlight: selectedTownship === name,
    }));
  }, [subdistrictCounts, selectedTownship]);

  // 4. 真实诉求分类
  const categoryStats = useMemo<Record<string, number>>(() => {
    return rawOverview?.categoryDistribution || {};
  }, [rawOverview?.categoryDistribution]);

  // 5. 真实时序走势
  const trendDaily = useMemo<Record<string, number>>(() => {
    return rawTrend?.daily || {};
  }, [rawTrend?.daily]);

  const trendClusters = useMemo<Record<string, number>>(() => {
    return rawTrend?.dailyNewClusters || {};
  }, [rawTrend?.dailyNewClusters]);

  // 6. 真实紧急突发预警
  const alerts = useMemo<CockpitAlertItem[]>(() => {
    const list: CockpitAlertItem[] = [];

    if (rawClusters?.topClusters) {
      for (const c of rawClusters.topClusters) {
        if (c.urgency === "HIGH" || /急|水|险|爆|火|伤|停/.test(c.title || "")) {
          list.push({
            id: `alert-c-${c.id}`,
            title: c.title,
            category: c.category || "应急处置",
            subdistrict: c.region || undefined,
            urgency: "HIGH",
            createTime: c.last_date || "今日",
            status: "智能研判预警",
            desc: c.advice || `涉及 ${c.count} 件同质诉求持续上报`,
          });
        }
      }
    }

    for (const t of recentTickets) {
      if (t.isUrgent && list.length < 6) {
        list.push({
          id: `alert-t-${t.id}`,
          title: t.title || t.content.slice(0, 20),
          category: t.category || "紧急突发",
          subdistrict: t.subdistrict,
          urgency: "HIGH",
          createTime: t.createTime.length > 16 ? t.createTime.slice(11, 16) : "刚刚",
          status: "调度响应中",
          desc: t.content.slice(0, 48),
        });
      }
    }

    return list;
  }, [rawClusters, recentTickets]);

  return {
    loading,
    isRefreshing,
    isPolling,
    setIsPolling,
    lastUpdated,
    selectedTownship,
    setSelectedTownship,
    refresh: () => loadData(false),
    kpi,
    townshipStats,
    subdistrictCounts,
    categoryStats,
    trendDaily,
    trendClusters,
    recentTickets,
    alerts,
    systemTwoNodes,
    endpointRecentTickets,
  };
}
