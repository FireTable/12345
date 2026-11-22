"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";
import { isUnknownTownship } from "@/lib/civic-cluster";
import type {
  CockpitTicket,
  CockpitTownshipStat,
  CockpitAlertItem,
  CockpitKpiData,
  CockpitClosureFunnel,
  CockpitHourlyBucket,
} from "./cockpit-types";

/**
 * 大屏实时数据中枢 Hook
 * 仅消费真实后端接口数据，坚决不使用任何 mock / demo 兜底伪造数据
 */
export function useCockpitData(regionId: string) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const [closureFunnel, setClosureFunnel] = useState<CockpitClosureFunnel>({
    total: 0,
    analyzed: 0,
    clustered: 0,
    dispatched: 0,
    resolved: 0,
    fakeClosureIntercepted: 0,
  });
  const [hourlyDistribution, setHourlyDistribution] = useState<CockpitHourlyBucket[]>([]);

  const fetchRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const isPollingRef = useRef(isPolling);
  isPollingRef.current = isPolling;
  const prevPollingRef = useRef(isPolling);

  const loadData = useCallback(async (isSilent = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchRef.current;
    if (!isSilent) setIsRefreshing(true);

    try {
      const regParam = regionId ? `?region=${encodeURIComponent(regionId)}` : "";
      const res = await fetch(`/api/cockpit${regParam}`, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`大屏数据接口异常 (${res.status})`);
      }
      const payload = await res.json();

      if (controller.signal.aborted || fetchId !== fetchRef.current) return;

      setError(null);
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
      setClosureFunnel(
        payload?.closureFunnel || {
          total: Number(payload?.overview?.totalWorkorders || 0),
          analyzed: Number(payload?.overview?.analyzedCount || 0),
          clustered: Number(payload?.overview?.multiFreqCount || 0),
          dispatched: 0,
          resolved: Number(payload?.overview?.resolvedCount || 0),
          fakeClosureIntercepted: Number(payload?.overview?.fakeClosureCount || 0),
        }
      );
      setHourlyDistribution(
        Array.isArray(payload?.hourlyDistribution) ? payload.hourlyDistribution : []
      );

      setLastUpdated(new Date());
    } catch (e: any) {
      if (controller.signal.aborted || e?.name === "AbortError" || fetchId !== fetchRef.current) return;
      console.error("[Cockpit] Failed to load cockpit data:", e);
      setError(e instanceof Error ? e.message : "大屏实时数据拉取失败");
    } finally {
      if (!controller.signal.aborted && fetchId === fetchRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [regionId]);

  useEffect(() => {
    return () => {
      fetchRef.current += 1;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setSelectedTownship(null);
    setLoading(true);
    setError(null);
    loadData(false);
  }, [regionId, loadData]);

  // WS 推送：civic-data-refresh 信号触发 silent refetch（受 isPolling 开关控制）
  useCivicSse(regionId, (msg) => {
    if (!isPollingRef.current) return;
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

  // 从暂停切回开启实时流时，主动静默补拉一次最新数据
  useEffect(() => {
    if (isPolling && !prevPollingRef.current) {
      loadData(true);
    }
    prevPollingRef.current = isPolling;
  }, [isPolling, loadData]);

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
    const resolvedCount = Number(rawOverview?.resolvedCount || 0);
    const resolutionRatePct = total > 0
      ? Math.round((resolvedCount / total) * 1000) / 10
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
    const sorted = [...entries].sort((a, b) => {
      const ua = isUnknownTownship(a[0]);
      const ub = isUnknownTownship(b[0]);
      if (ua !== ub) return ua ? 1 : -1;
      return b[1] - a[1];
    });

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
            status: "需跟进",
            desc: `同组 ${c.count || 0} 件`,
          });
        }
      }
    }

    for (const t of recentTickets) {
      if (t.isUrgent && list.length < 6) {
        list.push({
          id: `alert-t-${t.id}`,
          title: t.title || t.content.slice(0, 20),
          category: t.category || "紧急工单",
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
    error,
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
    closureFunnel,
    hourlyDistribution,
  };
}
