"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { fmtNum } from "@/lib/format-number";
import {
  Building2,
  MapPin,
  Tag,
  Sparkles,
  Plus,
  Trash2,
  CheckCircle2,
  Zap,
  List,
  Map as MapIcon,
  Navigation,
  Compass,
} from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";
import { SkDict } from "@/app/_components/civic/skeletons";
import { PageHeaderActions } from "@/app/_components/civic/page-header-actions";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/app/_components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/_components/ui/dialog";
import { toast } from "sonner";
import { ConfirmDialog } from "@/app/_components/ui/confirm-dialog";
import { TablePager } from "@/app/_components/civic/table-pager";
import { useRegion, type RegionInfo } from "@/app/_components/civic/region-context";
import { useAuthRole } from "@/lib/auth/use-role";
import { resolveApiError } from "@/lib/api-codes";
import { categoryVisual, getTownshipColor, KNOWN_TOWNSHIP_COLORS } from "@/lib/civic-cluster";
import type { GeoPoint } from "@/app/_components/civic/civic-geo-map";
import { geocodeAddressClient, isValidCoordinate } from "@/lib/map/client-geocode";

const CivicGeoMap = dynamic(
  () => import("@/app/_components/civic/civic-geo-map").then((m) => m.CivicGeoMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[250px] flex items-center justify-center bg-slate-50 text-xs text-slate-400">
        正在加载地图组件…
      </div>
    ),
  }
);

// 统一接入全局标准镇街色彩单一事实来源 (SSOT)
const TOWNSHIP_COLORS: Record<string, string> = new Proxy(KNOWN_TOWNSHIP_COLORS, {
  get: (target, prop: string) => {
    if (typeof prop !== "string") return "#1E5AFF";
    return getTownshipColor(prop);
  },
});

interface TownshipItem {
  name: string;
  fullName: string;
  aliases: string[];
  communities: string[];
  landmarks: string[];
}

interface CategoryItem {
  category: string;
  subItems: string[];
  leadDepartment: string;
}

interface AliasItem {
  id: string;
  alias: string;
  canonical: string;
  type: string;
  source: string;
  usageCount: number;
  createdAt: string;
}

export interface LocationItem {
  id: string;
  name: string;
  fullName?: string;
  parentName?: string;
  metaJson?: string;
  isStandard: boolean;
  createdAt: string;
}

interface LocationMeta {
  lng?: number;
  lat?: number;
  score?: number;
  level?: string;
  formattedAddress?: string;
  township?: string;
  source?: string;
}

function parseLocationMeta(metaJson?: string): LocationMeta {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson);
    return parsed && typeof parsed === "object" ? (parsed as LocationMeta) : {};
  } catch {
    return {};
  }
}

function findMatchingTownship(text: string, townships: TownshipItem[]): TownshipItem | null {
  const clean = text.trim();
  if (!clean || townships.length === 0) return null;

  // 精确匹配全称 / 简称 / 别名
  for (const t of townships) {
    if (
      t.fullName === clean ||
      t.name === clean ||
      (t.aliases || []).some((a) => a === clean)
    ) {
      return t;
    }
  }

  // 按候选词长度降序做子串匹配，避免短词误匹配
  const candidates: Array<{ token: string; township: TownshipItem; priority: number }> = [];
  for (const t of townships) {
    if (t.fullName) candidates.push({ token: t.fullName, township: t, priority: 3 });
    if (t.name && t.name.length >= 2) candidates.push({ token: t.name, township: t, priority: 2 });
    for (const a of t.aliases || []) {
      if (a.length >= 2) candidates.push({ token: a, township: t, priority: 2 });
    }
    for (const c of t.communities || []) {
      if (c.length >= 2) candidates.push({ token: c, township: t, priority: 1 });
    }
    for (const lm of t.landmarks || []) {
      if (lm.length >= 3) candidates.push({ token: lm, township: t, priority: 1 });
    }
  }
  candidates.sort((a, b) => b.priority - a.priority || b.token.length - a.token.length);

  for (const item of candidates) {
    if (clean.includes(item.token)) {
      return item.township;
    }
  }
  return null;
}

function resolveLocationTownship(
  loc: LocationItem,
  meta: LocationMeta,
  townships: TownshipItem[]
): string {
  const explicitTown = String(loc.parentName || meta.township || "").trim();
  if (townships.length === 0) return explicitTown;
  if (explicitTown) {
    const matched = findMatchingTownship(explicitTown, townships);
    return matched ? matched.fullName : explicitTown;
  }
  const haystack = `${loc.name || ""} ${loc.fullName || ""} ${meta.formattedAddress || ""}`.trim();
  const matched = findMatchingTownship(haystack, townships);
  return matched ? matched.fullName : "";
}

function isCrossRegionLocation(
  loc: LocationItem,
  meta: LocationMeta,
  townships: TownshipItem[],
  activeRegion: RegionInfo | null
): boolean {
  if (!activeRegion || townships.length === 0) return false;
  const explicitTown = String(loc.parentName || meta.township || "").trim();
  if (explicitTown) {
    const matchesLocalTownship = Boolean(findMatchingTownship(explicitTown, townships));
    if (!matchesLocalTownship && !explicitTown.includes(activeRegion.name)) {
      return true;
    }
  }
  const fullText = `${loc.fullName || ""} ${meta.formattedAddress || ""}`.trim();
  if (fullText) {
    const mentionsLocal =
      fullText.includes(activeRegion.name) ||
      (activeRegion.city ? fullText.includes(activeRegion.city) : false);
    if (!mentionsLocal && /(?:佛山市|顺德区|南海区|禅城区|三水区|高明区|广州市|深圳市|珠海市|东莞市|中山市).+?(?:街道|镇)/.test(fullText)) {
      const matchesLocalTownship = Boolean(findMatchingTownship(fullText, townships));
      if (!matchesLocalTownship) return true;
    }
  }
  return false;
}

export default function DictionaryManagementPage() {
  const { activeRegion } = useRegion();
  const { isAdmin, isPending: isRolePending } = useAuthRole();
  const [activeTab, setActiveTab] = useState<"aliases" | "locations" | "townships" | "categories">("aliases");
  const [loading, setLoading] = useState(true);

  const [aliases, setAliases] = useState<AliasItem[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [townships, setTownships] = useState<TownshipItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [previewLocation, setPreviewLocation] = useState<LocationItem | null>(null);
  const [stats, setStats] = useState({
    townshipCount: 10,
    categoryCount: 7,
    aliasCount: 0,
    locationCount: 0,
    communityCount: 98,
  });

  // 搜索与过滤
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // 新增别名弹窗与表单
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAlias, setNewAlias] = useState("");
  const [newCanonical, setNewCanonical] = useState("");
  const [newType, setNewType] = useState("LOCATION");
  const [addingAlias, setAddingAlias] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; alias: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 空间地理标准地点录入与预览
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);
  const [newLocationAddress, setNewLocationAddress] = useState("");
  const [locSubmitting, setLocSubmitting] = useState(false);
  const [pendingDeleteLoc, setPendingDeleteLoc] = useState<LocationItem | null>(null);

  // 空间地理坐标库视图模式与交互状态
  const [locViewMode, setLocViewMode] = useState<"table" | "map">("table");
  const [activeMapLocId, setActiveMapLocId] = useState<string | null>(null);
  const [townshipFilter, setTownshipFilter] = useState<string>("ALL");

  // 实时别名测试工具
  const [testText, setTestText] = useState(
    "市民反映从地狱西坐车去洗村，路过侨医、天体和跑马场附近，夜间噪音扰民。"
  );
  const [normalizedTestResult, setNormalizedTestResult] = useState("");

  const fetchAbortRef = useRef<AbortController | null>(null);
  const fetchSeqRef = useRef(0);
  const testAbortRef = useRef<AbortController | null>(null);
  const testSeqRef = useRef(0);
  const testDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRegionRef = useRef<string | undefined>(undefined);

  const regionHeaders = useCallback(
    (withJson = false): Record<string, string> => {
      const headers: Record<string, string> = {};
      if (withJson) headers["Content-Type"] = "application/json";
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      return headers;
    },
    [activeRegion?.id]
  );

  useEffect(() => {
    return () => {
      fetchSeqRef.current += 1;
      fetchAbortRef.current?.abort();
      testSeqRef.current += 1;
      testAbortRef.current?.abort();
      if (testDebounceRef.current) {
        clearTimeout(testDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (searchQuery === debouncedSearchQuery) return;
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery, debouncedSearchQuery]);

  const fetchData = useCallback(
    async (queryOverride?: string) => {
      if (!isAdmin) return;
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;
      const seq = ++fetchSeqRef.current;

      try {
        setLoading(true);
        const regionParam = activeRegion?.id ? `&region=${encodeURIComponent(activeRegion.id)}` : "";
        const q = queryOverride !== undefined ? queryOverride : debouncedSearchQuery;
        const res = await fetch(`/api/dict?q=${encodeURIComponent(q)}${regionParam}`, {
          headers: regionHeaders(),
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted || seq !== fetchSeqRef.current) return;
        if (data.success) {
          loadedRegionRef.current = activeRegion?.id;
          const payload = data.data || data;
          setAliases(payload.aliases || []);
          setLocations(payload.locations || []);
          setTownships(payload.townships || []);
          setCategories(payload.categories || []);
          const totalCommunities =
            payload.townships?.reduce((acc: number, t: any) => acc + (t.communities?.length || 0), 0) || 0;
          setStats({
            townshipCount: payload.stats?.townshipCount || payload.townships?.length || 0,
            categoryCount: payload.stats?.categoryCount || payload.categories?.length || 0,
            aliasCount: payload.stats?.aliasCount || payload.aliases?.length || 0,
            locationCount: payload.locations?.length || payload.stats?.locationCount || 0,
            communityCount: totalCommunities || payload.stats?.communityCount || 0,
          });
        }
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === "AbortError" || seq !== fetchSeqRef.current) return;
        toast.error("加载词典数据失败");
      } finally {
        if (!controller.signal.aborted && seq === fetchSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [isAdmin, activeRegion?.id, debouncedSearchQuery, regionHeaders]
  );

  useEffect(() => {
    setTownshipFilter("ALL");
    setActiveMapLocId(null);
    setPreviewLocation(null);
  }, [activeRegion?.id]);

  useEffect(() => {
    if (isRolePending || !isAdmin) return;
    if (activeTab === "locations" && loadedRegionRef.current === activeRegion?.id) {
      return;
    }
    void fetchData(activeTab === "locations" ? "" : debouncedSearchQuery);
  }, [fetchData, activeTab, activeRegion?.id, debouncedSearchQuery, isRolePending, isAdmin]);

  const regionLocations = useMemo(() => {
    return locations
      .map((loc) => {
        const meta = parseLocationMeta(loc.metaJson);
        if (isCrossRegionLocation(loc, meta, townships, activeRegion)) {
          return null;
        }
        const resolvedTownship = resolveLocationTownship(loc, meta, townships);
        return {
          loc,
          meta,
          resolvedTownship,
        };
      })
      .filter((entry): entry is { loc: LocationItem; meta: LocationMeta; resolvedTownship: string } => entry !== null);
  }, [locations, townships, activeRegion]);

  const tabs = [
    { key: "aliases", label: "别名知识库映射" },
    { key: "locations", label: "空间地理坐标库 (Canonical)" },
    { key: "townships", label: `${activeRegion ? activeRegion.name : "辖区"}法定区划 (${stats.townshipCount} 街道/镇街)` },
    { key: "categories", label: `${stats.categoryCount} 大民生诉求分类标准` },
  ] as const;

  // 执行实时测试替换
  const runTestReplace = useCallback(
    async (text: string) => {
      if (!isAdmin) return;
      if (testDebounceRef.current) {
        clearTimeout(testDebounceRef.current);
        testDebounceRef.current = null;
      }
      testAbortRef.current?.abort();
      if (!text.trim()) {
        testSeqRef.current += 1;
        setNormalizedTestResult("");
        return;
      }
      const controller = new AbortController();
      testAbortRef.current = controller;
      const seq = ++testSeqRef.current;

      try {
        const res = await fetch("/api/dict", {
          method: "POST",
          headers: regionHeaders(true),
          signal: controller.signal,
          body: JSON.stringify({ action: "test_replace", text }),
        });
        const data = await res.json();
        if (controller.signal.aborted || seq !== testSeqRef.current) return;
        if (data.success) {
          const payload = data.data || data;
          setNormalizedTestResult(payload.normalized || "");
        }
      } catch (e: any) {
        if (controller.signal.aborted || e?.name === "AbortError") return;
      }
    },
    [isAdmin, regionHeaders]
  );

  const handleTestReplace = (text: string) => {
    setTestText(text);
    if (testDebounceRef.current) {
      clearTimeout(testDebounceRef.current);
      testDebounceRef.current = null;
    }
    if (!text.trim()) {
      testAbortRef.current?.abort();
      testSeqRef.current += 1;
      setNormalizedTestResult("");
      return;
    }
    testDebounceRef.current = setTimeout(() => {
      testDebounceRef.current = null;
      void runTestReplace(text);
    }, 250);
  };

  useEffect(() => {
    if (testDebounceRef.current) {
      clearTimeout(testDebounceRef.current);
      testDebounceRef.current = null;
    }
    if (isRolePending || !isAdmin) return;
    if (!activeRegion?.id) return;
    const sample = activeRegion.id.includes("tianhe")
      ? "市民反映从地狱西坐车去洗村，路过侨医、天体和跑马场附近，夜间噪音扰民。"
      : "市民在容奇大桥附近反映某商户违规经营，希望属地综合行政执法队介入。";
    setTestText(sample);
    void runTestReplace(sample);
    return () => {
      if (testDebounceRef.current) {
        clearTimeout(testDebounceRef.current);
        testDebounceRef.current = null;
      }
      testAbortRef.current?.abort();
    };
  }, [activeRegion?.id, isRolePending, isAdmin, runTestReplace]);

  // 新增别名提交
  const handleAddAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlias.trim() || !newCanonical.trim()) {
      toast.error("请填写完整的别名与规范名称");
      return;
    }

    setAddingAlias(true);
    try {
      const res = await fetch("/api/dict", {
        method: "POST",
        headers: regionHeaders(true),
        body: JSON.stringify({
          action: "add_alias",
          alias: newAlias.trim(),
          canonical: newCanonical.trim(),
          type: newType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("别名映射规则已新增并沉淀！");
        setShowAddModal(false);
        setNewAlias("");
        setNewCanonical("");
        void fetchData();
      } else {
        toast.error(resolveApiError(data, "添加失败"));
      }
    } catch {
      toast.error("添加请求异常");
    } finally {
      setAddingAlias(false);
    }
  };

  const handleDeleteAlias = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/dict", {
        method: "POST",
        headers: regionHeaders(true),
        body: JSON.stringify({ action: "delete_alias", id: pendingDelete.id, alias: pendingDelete.alias }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("别名已删除");
        setPendingDelete(null);
        void fetchData();
      } else {
        toast.error(resolveApiError(data, "删除失败"));
      }
    } catch {
      toast.error("删除异常");
    } finally {
      setDeleting(false);
    }
  };

  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLocationAddress.trim()) {
      toast.error("请输入待解析的微观地点或道路名称");
      return;
    }
    setLocSubmitting(true);
    try {
      const d = await geocodeAddressClient(newLocationAddress.trim(), "", {
        regionId: activeRegion?.id,
      });
      if (d.success && isValidCoordinate(d.lng, d.lat)) {
        toast.success(`高精坐标已沉淀：${d.formattedAddress || newLocationAddress} [${d.lng!.toFixed(5)}, ${d.lat!.toFixed(5)}]`);
        setShowAddLocationModal(false);
        setNewLocationAddress("");
        void fetchData();
      } else {
        toast.error(d.error || "天地图服务未能解析出有效坐标");
      }
    } catch {
      toast.error("请求高精解析服务异常");
    } finally {
      setLocSubmitting(false);
    }
  };

  const handleDeleteLocation = async () => {
    if (!pendingDeleteLoc) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/dict", {
        method: "POST",
        headers: regionHeaders(true),
        body: JSON.stringify({ action: "delete_location", id: pendingDeleteLoc.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("空间地点坐标已删除");
        setPendingDeleteLoc(null);
        void fetchData();
      } else {
        toast.error(resolveApiError(data, "删除失败"));
      }
    } catch {
      toast.error("删除异常");
    } finally {
      setDeleting(false);
    }
  };

  const filteredAliases = aliases.filter((a) => {
    if (typeFilter !== "all" && a.type !== typeFilter) return false;
    return true;
  });
  const aliasPages = Math.max(1, Math.ceil(filteredAliases.length / pageSize));
  const aliasPage = Math.min(page, aliasPages);
  const pagedAliases = filteredAliases.slice((aliasPage - 1) * pageSize, aliasPage * pageSize);

  if (isRolePending || !isAdmin) {
    return <SkDict />;
  }

  return (
    <>
      {/* 头部导航与操作栏 */}
      <div className="page-hero">
        <div>
          <h1 className="page-hero__title">
            标准字典与知识库
          </h1>
          <div className="page-hero__desc">
            {fmtNum(stats.townshipCount)} 大法定镇街区划、{fmtNum(stats.categoryCount)} 大民生诉求分类标准及 AI 自学习别名沉淀知识库统一管理平台
          </div>
        </div>
        <PageHeaderActions
          onRefresh={() => void fetchData()}
          refreshing={loading}
        />
      </div>

      {loading && aliases.length === 0 && townships.length === 0 ? (
        <SkDict />
      ) : (
        <>
          {/* 统一指标卡片体系 (StatCardGrid) */}
          <StatCardGrid columns={4}>
            <StatCard
              icon={Building2}
              tone="blue"
              label="法定镇街总数"
              value={stats.townshipCount}
              sub={`${townships.slice(0, 4).map((t) => t.name).join("/") || "辖区镇街"} 等 ${fmtNum(stats.townshipCount)} 个辖区`}
            />
            <StatCard
              icon={MapPin}
              tone="green"
              label="覆盖村居/社区"
              value={stats.communityCount}
              sub="法定社区居委会与重点村居"
            />
            <StatCard
              icon={Tag}
              tone="purple"
              label="民生分类体系"
              value={stats.categoryCount}
              sub={`${fmtNum(stats.categoryCount)} 大法定标准业务大类`}
            />
            <StatCard
              icon={Sparkles}
              tone="orange"
              label="活跃别名映射"
              value={aliases.length}
              sub="支持 AI 动态挖掘沉淀与替换"
            />
          </StatCardGrid>

          {/* 实时别名替换演练沙箱 (Live Playground) */}
          <div className="bg-white rounded-xl border border-slate-200/90 p-4 mb-4 shadow-2xs">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-md bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600 shrink-0" aria-hidden="true">
                  <Zap className="h-3.5 w-3.5" />
                </div>
                <h2 className="text-xs font-semibold text-slate-800">
                  AI 别名归一化即时替换演练（Live Sandbox）
                </h2>
              </div>
              <span className="text-[11px] text-slate-500">
                实时验证口语/旧称/缩写到法定权威全称的替换效果
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div>
                <label htmlFor="dict-sandbox-input" className="text-[13px] font-medium text-slate-700 mb-1 block">
                  输入包含口语/俗称的原始文本：
                </label>
                <input
                  id="dict-sandbox-input"
                  type="text"
                  value={testText}
                  onChange={(e) => handleTestReplace(e.target.value)}
                  placeholder="输入文本测试别名替换..."
                  className="w-full min-h-[44px] sm:min-h-[36px] rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none transition-[border-color,background-color]"
                />
              </div>
              <div>
                <div id="dict-sandbox-output-label" className="text-[13px] font-medium text-emerald-700 mb-1 block">
                  归一化替换结果（大模型输入标准）：
                </div>
                <div
                  role="status"
                  aria-live="polite"
                  aria-labelledby="dict-sandbox-output-label"
                  className="w-full rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-[13px] font-medium text-emerald-800 min-h-[44px] sm:min-h-[36px] flex items-center"
                >
                  {normalizedTestResult || <span className="text-slate-500 text-xs">输入文本后即时呈现替换结果...</span>}
                </div>
              </div>
            </div>
          </div>

          {/* 统一卡片容器：Tab 与数据/列表无缝聚合为一个整体 */}
          <div className="card list-card">
            {/* 顶部 Tab 栏：内嵌在卡片顶端 */}
            <div
              role="tablist"
              aria-label="知识词典分类"
              onKeyDown={(e) => {
                const keys = tabs.map((t) => t.key);
                const idx = keys.indexOf(activeTab);
                let next: (typeof keys)[number] | null = null;
                if (e.key === "ArrowRight") next = keys[(idx + 1) % keys.length];
                else if (e.key === "ArrowLeft") next = keys[(idx - 1 + keys.length) % keys.length];
                else if (e.key === "Home") next = keys[0];
                else if (e.key === "End") next = keys[keys.length - 1];
                if (next) {
                  e.preventDefault();
                  setActiveTab(next);
                  setPage(1);
                  window.requestAnimationFrame(() => {
                    document.getElementById(`dict-tab-${next}`)?.focus();
                  });
                }
              }}
              className="filter-tabs"
            >
              {tabs.map((t) => (
                <button
                  key={t.key}
                  id={`dict-tab-${t.key}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.key}
                  aria-controls={`dict-panel-${t.key}`}
                  tabIndex={activeTab === t.key ? 0 : -1}
                  className={`filter-tab min-h-[44px] sm:min-h-[36px] inline-flex items-center border-b-2 ${activeTab === t.key ? "is-active border-[#1E5AFF]" : "border-transparent"}`}
                  onClick={() => {
                    setActiveTab(t.key as any);
                    setPage(1);
                  }}
                >
                  {t.label}
                  <span className="filter-tab__count">
                    {fmtNum(
                      t.key === "aliases"
                        ? aliases.length
                        : t.key === "locations"
                          ? regionLocations.length
                          : t.key === "townships"
                            ? townships.length
                            : categories.length
                    )}
                  </span>
                </button>
              ))}
            </div>

            <div
              role="tabpanel"
              id={`dict-panel-${activeTab}`}
              aria-labelledby={`dict-tab-${activeTab}`}
              tabIndex={0}
            >
              <h2 className="sr-only">
                {tabs.find((t) => t.key === activeTab)?.label || "词典知识库明细"}
              </h2>

            {/* Tab 1: 别名知识库映射 */}
            {activeTab === "aliases" && (
              <>
                <div className="filter-bar">
                  <div className="search-input w-full sm:w-auto min-w-0">
                    <span aria-hidden="true">⌕</span>
                    <input
                      aria-label="搜索别名或规范全称"
                      placeholder="搜索别名 · 俗称 / 规范全称关键词"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setPage(1);
                      }}
                    />
                  </div>
                  <div className="filter-bar__divider" />
                  <Select
                    value={typeFilter}
                    onValueChange={(val) => {
                      setTypeFilter(val);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      aria-label="筛选别名实体类型"
                      className="w-full sm:w-[140px] min-h-[44px] sm:min-h-[36px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg"
                    >
                      <SelectValue placeholder="类型：全部" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">类型：全部</SelectItem>
                      <SelectItem value="TOWNSHIP">镇街区划</SelectItem>
                      <SelectItem value="LOCATION">微观点位</SelectItem>
                      <SelectItem value="DEPARTMENT">责任部门</SelectItem>
                      <SelectItem value="ENTITY">涉事主体</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap w-full sm:w-auto sm:ml-auto">
                    <span className="filter-bar__summary" style={{ marginLeft: 0 }}>
                      共 {fmtNum(filteredAliases.length)} 条别名映射
                    </span>
                    <button
                      type="button"
                      className="btn btn--primary min-h-[44px] sm:min-h-[36px] px-3.5 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
                      onClick={() => setShowAddModal(true)}
                    >
                      <Plus size={14} className="shrink-0" aria-hidden="true" />
                      <span>新增别名映射</span>
                    </button>
                  </div>
                </div>

                <div
                  className="table-scroll overflow-x-auto max-w-full"
                  tabIndex={0}
                  role="region"
                  aria-label="别名知识库映射列表"
                >
                  <table className="group-table">
                    <caption className="sr-only">别名知识库映射列表</caption>
                    <thead>
                      <tr>
                        <th scope="col" style={{ width: 280 }}>俗称 / 别名 (Alias)</th>
                        <th scope="col">对应标准规范全称 (Canonical)</th>
                        <th scope="col" style={{ width: 120 }}>实体类型</th>
                        <th scope="col" style={{ width: 125 }}>来源渠道</th>
                        <th scope="col" style={{ width: 110 }}>替换生效</th>
                        <th scope="col" style={{ width: 85, textAlign: "right" }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAliases.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: "center", padding: "48px 20px", color: "var(--c-ink-3)", fontSize: 13 }}>
                            未找到符合条件的别名映射规则
                          </td>
                        </tr>
                      ) : (
                        pagedAliases.map((item) => (
                          <tr key={item.id} className="hover:bg-blue-50/40 transition-colors">
                            <td>
                              <span className="rounded bg-amber-50 border border-amber-200/80 px-2 py-0.5 text-xs font-mono text-amber-800 font-semibold">
                                {item.alias}
                              </span>
                            </td>
                            <td style={{ fontWeight: 600, color: "var(--c-ink)" }}>
                              <span className="text-emerald-600 mr-1.5 font-normal">➔</span>
                              {item.canonical}
                            </td>
                            <td>
                              <span className="text-xs font-medium text-blue-700">
                                {item.type === "TOWNSHIP"
                                  ? "镇街区划"
                                  : item.type === "DEPARTMENT"
                                    ? "责任部门"
                                    : item.type === "LOCATION"
                                      ? "微观点位"
                                      : "业务实体"}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`text-xs font-medium ${item.source === "AI_MINED"
                                  ? "text-purple-700"
                                  : item.source === "MANUAL"
                                    ? "text-amber-700"
                                    : "text-slate-600"
                                  }`}
                              >
                                {item.source === "AI_MINED"
                                  ? "AI 自学习沉淀"
                                  : item.source === "MANUAL"
                                    ? "人工维护"
                                    : "系统预置"}
                              </span>
                            </td>
                            <td>
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                已启用
                              </span>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                type="button"
                                onClick={() => setPendingDelete({ id: item.id, alias: item.alias })}
                                aria-label={`删除别名 ${item.alias}`}
                                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] p-1 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors inline-flex items-center justify-center cursor-pointer"
                                title="删除别名"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {filteredAliases.length > 0 && (
                  <TablePager
                    page={aliasPage}
                    pages={aliasPages}
                    total={filteredAliases.length}
                    pageSize={pageSize}
                    pageSizeOptions={[10, 15, 20, 50]}
                    itemLabel="条别名"
                    onPageChange={setPage}
                    onPageSizeChange={(n) => {
                      setPageSize(n);
                      setPage(1);
                    }}
                  />
                )}
              </>
            )}

            {/* Tab: 空间地理坐标库 (Canonical Locations) */}
            {activeTab === "locations" && (() => {
              // 过滤匹配的地点数据（已剔除跨区脏数据并解析所属法定镇街）
              const filteredLocEntries = regionLocations.filter(({ loc, resolvedTownship }) => {
                if (townshipFilter !== "ALL") {
                  if (!resolvedTownship || !resolvedTownship.includes(townshipFilter)) return false;
                }
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (
                  loc.name.toLowerCase().includes(q) ||
                  resolvedTownship.toLowerCase().includes(q) ||
                  (loc.fullName || "").toLowerCase().includes(q)
                );
              });

              // 提取有经纬度的点位供地图全览批量打点
              const geoPoints: GeoPoint[] = filteredLocEntries
                .map(({ loc, meta, resolvedTownship }) => {
                  if (!isValidCoordinate(meta.lng, meta.lat)) return null;
                  return {
                    id: loc.id,
                    lng: meta.lng as number,
                    lat: meta.lat as number,
                    title: loc.name,
                    township: resolvedTownship,
                    address: meta.formattedAddress || loc.fullName || loc.name,
                    color: TOWNSHIP_COLORS[resolvedTownship] || "#1E5AFF",
                    raw: loc,
                  };
                })
                .filter(Boolean) as GeoPoint[];

              // 提取当前辖区下出现的所有镇街选项
              const availableTownships = Array.from(
                new Set(
                  regionLocations
                    .map((entry) => entry.resolvedTownship)
                    .filter(Boolean)
                )
              );

              // 当前选中的全览点位
              const activeEntry = activeMapLocId
                ? regionLocations.find((entry) => entry.loc.id === activeMapLocId) || null
                : null;
              const activeLocItem = activeEntry?.loc || null;
              const activeMeta = activeEntry?.meta || {};
              const activeTown = activeEntry?.resolvedTownship || "";

              return (
                <>
                  {/* 顶部工具栏：搜索、视图切换、录入 */}
                  <div className="filter-bar flex flex-wrap items-center gap-2.5 sm:gap-3 px-4 sm:px-5 py-3">
                    <div className="search-input w-full sm:max-w-[320px] min-w-0">
                      <span aria-hidden="true">⌕</span>
                      <input
                        aria-label="搜索微观地点名称、道路或镇街"
                        placeholder="搜索微观地点名称 · 道路 · 镇街..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </div>

                    {/* 视图模式切换 Segmented Control */}
                    <div
                      className="inline-flex items-center bg-slate-100 p-[3px] rounded-lg border border-slate-200 max-w-full shrink-0"
                    >
                      <button
                        type="button"
                        aria-pressed={locViewMode === "table"}
                        onClick={() => setLocViewMode("table")}
                        className={`flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs rounded-md border-0 cursor-pointer transition-[background-color,color,box-shadow] whitespace-nowrap shrink-0 ${
                          locViewMode === "table"
                            ? "font-semibold text-slate-900 bg-white shadow-xs"
                            : "font-medium text-slate-600 bg-transparent"
                        }`}
                      >
                        <List className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>列表明细</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={locViewMode === "map"}
                        onClick={() => setLocViewMode("map")}
                        className={`flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs rounded-md border-0 cursor-pointer transition-[background-color,color,box-shadow] whitespace-nowrap shrink-0 ${
                          locViewMode === "map"
                            ? "font-semibold text-[#1E5AFF] bg-white shadow-xs"
                            : "font-medium text-slate-600 bg-transparent"
                        }`}
                      >
                        <MapIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>地图全览</span>
                        <span className="text-[11px] font-mono tabular-nums text-slate-500">
                          ({fmtNum(geoPoints.length)})
                        </span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowAddLocationModal(true)}
                      className="btn btn--primary sm:ml-auto min-h-[44px] sm:min-h-[36px] px-3.5 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Plus size={14} className="shrink-0" aria-hidden="true" />
                      <span>录入微观点位</span>
                    </button>
                  </div>

                  {/* 镇街快速过滤 Chip 条 (地图模式与列表均可用) */}
                  {availableTownships.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "0 20px 10px 20px",
                        overflowX: "auto",
                      }}
                    >
                      <span style={{ fontSize: 12, color: "#475569", whiteSpace: "nowrap" }}>镇街过滤:</span>
                      <button
                        type="button"
                        aria-pressed={townshipFilter === "ALL"}
                        onClick={() => setTownshipFilter("ALL")}
                        className="min-h-[44px] sm:min-h-[36px] py-1 px-3 shrink-0 whitespace-nowrap"
                        style={{
                          borderRadius: 10,
                          fontSize: 12,
                          border: "1px solid",
                          cursor: "pointer",
                          transition: "border-color 0.12s, background-color 0.12s, color 0.12s",
                          borderColor: townshipFilter === "ALL" ? "#1E5AFF" : "#E2E8F0",
                          background: townshipFilter === "ALL" ? "#1E5AFF" : "#FFFFFF",
                          color: townshipFilter === "ALL" ? "#FFFFFF" : "#334155",
                          fontWeight: townshipFilter === "ALL" ? 600 : 400,
                        }}
                      >
                        全部 ({fmtNum(regionLocations.length)})
                      </button>
                      {availableTownships.map((town) => {
                        const count = regionLocations.filter(
                          (entry) => entry.resolvedTownship === town
                        ).length;
                        const isActive = townshipFilter === town;
                        const color = TOWNSHIP_COLORS[town] || "#1E5AFF";
                        return (
                          <button
                            key={town}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => setTownshipFilter(isActive ? "ALL" : town)}
                            className="min-h-[44px] sm:min-h-[36px] py-1 px-3 shrink-0 whitespace-nowrap"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              borderRadius: 10,
                              fontSize: 12,
                              border: "1px solid",
                              cursor: "pointer",
                              transition: "border-color 0.12s, background-color 0.12s, color 0.12s",
                              borderColor: isActive ? color : "#E2E8F0",
                              background: isActive ? `${color}15` : "#FFFFFF",
                              color: isActive ? "#0F172A" : "#334155",
                              fontWeight: isActive ? 600 : 400,
                            }}
                          >
                            <span>{town}</span>
                            <span className="tabular-nums" style={{ color: "#475569", fontSize: 11 }}>({fmtNum(count)})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* ---------------- 模式 1：🗺️ 地图全览模式 ---------------- */}
                  {locViewMode === "map" && (
                    <div className="px-4 sm:px-5 pb-5">
                      <div
                        className="relative rounded-xl overflow-hidden border border-slate-300 shadow-md isolate z-[1]"
                      >
                        {/* 地图主体 */}
                        <CivicGeoMap
                          mode="multi"
                          height={540}
                          points={geoPoints}
                          selectedPointId={activeMapLocId || undefined}
                          onPointClick={(pt) => setActiveMapLocId(pt.id || null)}
                        />

                        {/* 地图左上角概览胶囊 */}
                        <div
                          className="absolute top-3 left-3 z-[1] max-w-[calc(100%-24px)] sm:max-w-[calc(100%-356px)] bg-white/95 backdrop-blur-md border border-slate-300/80 rounded-lg px-3 py-1.5 shadow-sm flex items-center gap-2 flex-wrap text-xs"
                        >
                          <Compass className="w-3.5 h-3.5 text-[#1E5AFF] shrink-0" aria-hidden="true" />
                          <span className="font-semibold text-slate-900">
                            标准空间地理坐标库全景
                          </span>
                          <span className="text-slate-500">·</span>
                          <span className="text-[#1E5AFF] font-bold tabular-nums">
                            {fmtNum(geoPoints.length)}
                          </span>
                          <span className="text-slate-600">个已上图高精点位</span>
                        </div>

                        {/* 地图右侧浮动点位详情卡片（移动端流式置于地图下方，桌面端右上角浮层） */}
                        <div
                          className="static mt-3 w-full sm:mt-0 sm:absolute sm:top-3 sm:right-3 sm:w-[320px] sm:max-w-[calc(100%-24px)] z-[900] bg-white/95 backdrop-blur-md border border-slate-300 rounded-[10px] p-3.5 shadow-lg"
                        >
                          {activeLocItem ? (
                            <div>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                                    {activeLocItem.name}
                                  </h3>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setActiveMapLocId(null)}
                                  aria-label="关闭详情卡片"
                                  title="关闭详情卡片"
                                  className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] inline-flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer border-0 bg-transparent text-[13px]"
                                >
                                  ✕
                                </button>
                              </div>

                              {activeLocItem.fullName && activeLocItem.fullName !== activeLocItem.name && (
                                <div style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>
                                  {activeLocItem.fullName}
                                </div>
                              )}

                              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#334155", marginTop: 8 }}>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "#475569" }}>所属法定辖区:</span>
                                  <span style={{ fontWeight: 600, color: "#1E5AFF" }}>
                                    {activeTown || activeRegion?.name || "当前辖区"}
                                  </span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "#475569" }}>天地图经纬度:</span>
                                  <span className="tabular-nums" style={{ fontFamily: "monospace", fontWeight: 600 }}>
                                    {activeMeta.lng?.toFixed(5)}, {activeMeta.lat?.toFixed(5)}
                                  </span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "#475569" }}>解析精度 / 打分:</span>
                                  <span className="tabular-nums">{activeMeta.level || "微观门牌"} ({activeMeta.score || 100}分)</span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "#475569" }}>规范数据来源:</span>
                                  <span style={{ color: "#15803D", fontWeight: 500 }}>
                                    {activeMeta.source === "TIANDITU_GEOCODE" ? "天地图自动解析" : "人工标定录入"}
                                  </span>
                                </div>
                              </div>

                              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLocViewMode("table");
                                    setSearchQuery(activeLocItem.name);
                                  }}
                                  className="min-h-[44px] sm:min-h-[36px]"
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 12,
                                    color: "#1E5AFF",
                                    background: "#EFF6FF",
                                    border: "1px solid #DBEAFE",
                                    padding: "4px 10px",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                  }}
                                >
                                  <List style={{ width: 12, height: 12 }} aria-hidden="true" />
                                  <span>在列表中查看</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingDeleteLoc(activeLocItem)}
                                  className="min-h-[44px] sm:min-h-[36px]"
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    fontSize: 12,
                                    color: "#BE123C",
                                    background: "#FFF1F2",
                                    border: "1px solid #FFE4E6",
                                    padding: "4px 10px",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                  }}
                                >
                                  <Trash2 style={{ width: 12, height: 12 }} aria-hidden="true" />
                                  <span>删除点位</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                <Navigation style={{ width: 14, height: 14, color: "#1E5AFF" }} aria-hidden="true" />
                                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#0F172A" }}>
                                  点击任意点位查看坐标详情
                                </h3>
                              </div>
                              <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
                                当前全览汇聚了 {fmtNum(geoPoints.length)} 个经高精地理编码规范化的微观地点。点击地图上的标记可查看经纬度、镇街从属及关联诉求。
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ---------------- 模式 2：📋 列表明细模式 ---------------- */}
                  {locViewMode === "table" && (
                    <>
                      {/* 单点定位即时预览抽屉/面板 */}
                      {previewLocation && (() => {
                        const meta = parseLocationMeta(previewLocation.metaJson);
                        const previewTown = resolveLocationTownship(previewLocation, meta, townships);
                        return (
                          <div className="mx-4 sm:mx-5 my-3 p-4 bg-slate-50 border border-blue-200 rounded-xl relative shadow-xs">
                            <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
                              <div className="flex items-center gap-2 flex-wrap min-w-0">
                                <span className="text-xs font-bold text-slate-800 break-words">
                                  📍 正在预览空间位置：{previewLocation.name}
                                </span>
                                {isValidCoordinate(meta.lng, meta.lat) && (
                                  <span className="text-xs font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 tabular-nums">
                                    {(meta.lng as number).toFixed(6)}, {(meta.lat as number).toFixed(6)}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  type="button"
                                  className="min-h-[44px] sm:min-h-[36px] text-xs text-blue-600 hover:text-blue-800 px-2.5 py-1 rounded hover:bg-blue-100/60 transition-colors font-medium flex items-center gap-1 cursor-pointer"
                                  onClick={() => {
                                    setActiveMapLocId(previewLocation.id);
                                    setLocViewMode("map");
                                  }}
                                >
                                  <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>进入地图全览</span>
                                </button>
                                <button
                                  type="button"
                                  aria-label="收起地图预览"
                                  className="min-h-[44px] sm:min-h-[36px] text-xs text-slate-500 hover:text-slate-700 px-2.5 py-1 rounded hover:bg-slate-200/60 transition-colors cursor-pointer"
                                  onClick={() => setPreviewLocation(null)}
                                >
                                  收起 ✕
                                </button>
                              </div>
                            </div>
                            {isValidCoordinate(meta.lng, meta.lat) ? (
                              <CivicGeoMap
                                mode="single"
                                height={250}
                                point={{
                                  id: previewLocation.id,
                                  lng: meta.lng as number,
                                  lat: meta.lat as number,
                                  title: previewLocation.name,
                                  township: previewTown,
                                  address: meta.formattedAddress || previewLocation.fullName,
                                  color: TOWNSHIP_COLORS[previewTown] || "#1E5AFF",
                                }}
                              />
                            ) : (
                              <div className="h-28 flex items-center justify-center text-xs text-slate-500">
                                该地点未关联经纬度坐标
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div
                        className="table-scroll overflow-x-auto max-w-full"
                        tabIndex={0}
                        role="region"
                        aria-label="空间地理坐标库列表"
                      >
                        <table className="workorder-table">
                          <caption className="sr-only">空间地理坐标库列表</caption>
                          <thead>
                            <tr>
                              <th scope="col">规范地点名称 (Canonical)</th>
                              <th scope="col">所属法定镇街</th>
                              <th scope="col">天地图高精经纬度</th>
                              <th scope="col">解析精度 / 级别</th>
                              <th scope="col">数据来源</th>
                              <th scope="col" style={{ textAlign: "right" }}>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredLocEntries.length === 0 ? (
                              <tr>
                                <td colSpan={6} style={{ textAlign: "center", padding: "40px 0", color: "var(--c-ink-3)" }}>
                                  暂无符合条件的空间坐标。可点击上方按钮录入或重置筛选。
                                </td>
                              </tr>
                            ) : (
                              filteredLocEntries.map(({ loc, meta, resolvedTownship }) => {
                                const hasCoords = isValidCoordinate(meta.lng, meta.lat);
                                const townColor = TOWNSHIP_COLORS[resolvedTownship] || "#64748B";
                                const isPreviewing = previewLocation?.id === loc.id;

                                return (
                                  <tr key={loc.id} className="hover:bg-blue-50/40 transition-colors">
                                    <td style={{ fontWeight: 600, color: "var(--c-ink)" }}>
                                      <div className="font-semibold text-slate-800 text-[13px]">
                                        {loc.name}
                                      </div>
                                      {loc.fullName && loc.fullName !== loc.name && (
                                        <div className="text-xs text-slate-500 font-normal mt-0.5">
                                          {loc.fullName}
                                        </div>
                                      )}
                                    </td>
                                    <td>
                                      {resolvedTownship ? (
                                        <span className="inline-flex items-center text-xs font-medium text-slate-800">
                                          {resolvedTownship}
                                        </span>
                                      ) : (
                                        <span className="text-xs text-slate-500">待归属镇街</span>
                                      )}
                                    </td>
                                    <td>
                                      {hasCoords ? (
                                        <span className="font-mono tabular-nums text-xs text-slate-700">
                                          {(meta.lng as number).toFixed(5)}, {(meta.lat as number).toFixed(5)}
                                        </span>
                                      ) : (
                                        <span className="text-slate-500 text-xs">未获取</span>
                                      )}
                                    </td>
                                    <td>
                                      <span className="text-xs text-slate-600 tabular-nums">
                                        {meta.level || "地点"} {meta.score ? `(${meta.score}分)` : ""}
                                      </span>
                                    </td>
                                    <td>
                                      <span
                                        className={`text-xs font-medium ${meta.source === "TIANDITU_GEOCODE"
                                          ? "text-blue-700"
                                          : "text-emerald-700"
                                          }`}
                                      >
                                        {meta.source === "TIANDITU_GEOCODE" ? "天地图自动解析" : "人工录入"}
                                      </span>
                                    </td>
                                    <td style={{ textAlign: "right" }}>
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          type="button"
                                          onClick={() => setPreviewLocation(isPreviewing ? null : loc)}
                                          aria-label={isPreviewing ? `收起 ${loc.name} 地图定位` : `在地图中查看 ${loc.name} 打点`}
                                          className={`min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] p-1.5 rounded-md transition-colors inline-flex items-center justify-center cursor-pointer ${isPreviewing
                                            ? "bg-blue-100 text-blue-600"
                                            : "text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                                            }`}
                                          title={isPreviewing ? "收起地图定位" : "在地图中查看打点"}
                                        >
                                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setPendingDeleteLoc(loc)}
                                          aria-label={`删除空间坐标 ${loc.name}`}
                                          className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors inline-flex items-center justify-center cursor-pointer"
                                          title="删除空间坐标"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              );
            })()}

            {/* Tab 2: 目标辖区法定区划与镇街街道 */}
            {activeTab === "townships" && (
              <div style={{ padding: 20 }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {townships.map((t) => (
                    <div
                      key={t.name}
                      className="bg-white rounded-xl border border-slate-200/90 p-4 hover:border-slate-300 transition-colors shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <h3 className="text-sm font-bold text-slate-900">{t.fullName}</h3>
                          <span className="text-xs text-slate-500 font-mono">简称：{t.name}</span>
                        </div>
                        <span className="text-xs font-medium text-emerald-700 whitespace-nowrap">
                          法定辖区
                        </span>
                      </div>

                      {/* 别名 Tags */}
                      <div className="mb-2.5">
                        <span className="text-xs text-slate-500 mr-1.5">俗称/别名:</span>
                        <div className="inline-flex flex-wrap gap-1 mt-0.5">
                          {t.aliases.map((alias) => (
                            <span
                              key={alias}
                              className="rounded bg-amber-50/80 px-1.5 py-0.5 text-[11px] text-amber-800 font-mono"
                            >
                              {alias}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* 代表村居社区 */}
                      <div className="mb-2.5">
                        <span className="text-xs text-slate-500 block mb-1">主要村居社区 ({t.communities.length}个):</span>
                        <div className="flex flex-wrap gap-1">
                          {t.communities.map((c) => (
                            <span
                              key={c}
                              className="rounded bg-blue-50/80 px-1.5 py-0.5 text-[11px] text-blue-700"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* 知名地标与园区 */}
                      {t.landmarks && t.landmarks.length > 0 && (
                        <div>
                          <span className="text-xs text-slate-500 block mb-1">重点地标与园区:</span>
                          <div className="flex flex-wrap gap-1">
                            {t.landmarks.map((lm) => (
                              <span
                                key={lm}
                                className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                              >
                                📍 {lm}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 3: 7 大民生诉求分类标准 */}
            {activeTab === "categories" && (
              <div style={{ padding: 20 }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {categories.map((c) => {
                    const visual = categoryVisual(c.category);
                    return (
                      <div
                        key={c.category}
                        className="bg-white rounded-xl border border-slate-200/90 p-4 hover:border-slate-300 transition-colors shadow-2xs relative overflow-hidden"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-sm font-bold text-slate-900">{c.category}</h3>
                          <span
                            className="text-xs font-medium"
                            style={{ color: visual.color }}
                          >
                            标准分类
                          </span>
                        </div>

                        <div className="mb-2.5">
                          <span className="text-xs text-slate-500 block mb-1">牵头负责科室:</span>
                          <p
                            className="text-xs font-semibold p-2 rounded-lg flex items-center gap-1.5"
                            style={{
                              backgroundColor: visual.bg,
                              color: visual.color,
                            }}
                          >
                            <span aria-hidden="true">🏢</span>
                            <span>{c.leadDepartment}</span>
                          </p>
                        </div>

                        <div>
                          <span className="text-xs text-slate-500 block mb-1">包含细分诉求事项:</span>
                          <div className="flex flex-wrap gap-1">
                            {c.subItems.map((sub) => (
                              <span
                                key={sub}
                                className="rounded bg-slate-100 hover:bg-slate-200/70 transition-colors px-2 py-0.5 text-[11px] text-slate-700"
                              >
                                {sub}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        title="删除别名映射"
        description={
          pendingDelete ? (
            <>
              确定删除别名「<b className="text-slate-800">{pendingDelete.alias}</b>」吗？删除后口语归一化将不再替换该词。
            </>
          ) : null
        }
        confirmLabel="删除"
        destructive
        pending={deleting}
        onConfirm={() => void handleDeleteAlias()}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      />

      {/* 新增别名弹窗 Modal */}
      <Dialog
        open={showAddModal}
        onOpenChange={(open) => {
          if (!open && !addingAlias) setShowAddModal(false);
        }}
      >
        <DialogContent
          closeDisabled={addingAlias}
          onEscapeKeyDown={(e) => {
            if (addingAlias) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (addingAlias) e.preventDefault();
          }}
          className="max-w-md gap-4"
        >
          <DialogHeader className="text-left space-y-1 pr-10">
            <DialogTitle>新增别名映射与实体沉淀</DialogTitle>
            <DialogDescription>
              设置市民口语/俗称/缩写到法定权威全称的自动替换映射关系
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddAlias} className="space-y-3.5">
            <div>
              <label htmlFor="dict-new-alias" className="text-[13px] font-medium text-slate-700 mb-1 block">
                俗称 / 别名 (Alias) <span className="text-rose-500">*</span>
              </label>
              <input
                id="dict-new-alias"
                type="text"
                spellCheck={false}
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                placeholder="例如：容奇、碧桂园总部、小黄圃工业区"
                className="w-full min-h-[44px] sm:min-h-[36px] rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
                required
              />
            </div>

            <div>
              <label htmlFor="dict-new-canonical" className="text-[13px] font-medium text-slate-700 mb-1 block">
                对应标准规范全称 (Canonical) <span className="text-rose-500">*</span>
              </label>
              <input
                id="dict-new-canonical"
                type="text"
                spellCheck={false}
                value={newCanonical}
                onChange={(e) => setNewCanonical(e.target.value)}
                placeholder="例如：容桂街道、北滘镇、容桂街道小黄圃社区"
                className="w-full min-h-[44px] sm:min-h-[36px] rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
                required
              />
            </div>

            <div>
              <label htmlFor="dict-new-type" className="text-[13px] font-medium text-slate-700 mb-1 block">实体分类</label>
              <select
                id="dict-new-type"
                name="type"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[36px] rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-[13px] text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
              >
                <option value="TOWNSHIP">镇街区划 (Township)</option>
                <option value="LOCATION">微观点位/社区 (Location)</option>
                <option value="DEPARTMENT">责任部门 (Department)</option>
                <option value="ENTITY">涉事主体/商户 (Entity)</option>
              </select>
            </div>

            <DialogFooter className="flex-row justify-end gap-2.5 pt-4 border-t border-slate-100">
              <button
                type="button"
                className="btn btn--default min-h-[44px] sm:min-h-[36px]"
                onClick={() => setShowAddModal(false)}
                disabled={addingAlias}
              >
                取消
              </button>
              <button type="submit" className="btn btn--primary min-h-[44px] sm:min-h-[36px]" disabled={addingAlias}>
                {addingAlias ? "保存中..." : "保存并沉淀"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除空间地点确认 */}
      <ConfirmDialog
        open={pendingDeleteLoc != null}
        title="删除空间坐标缓存"
        description={
          pendingDeleteLoc ? (
            <>
              确定删除地点「<b className="text-slate-800">{pendingDeleteLoc.name}</b>」的天地图坐标缓存吗？删除后再次研判将重新调用天地图接口。
            </>
          ) : null
        }
        confirmLabel="删除"
        destructive
        pending={deleting}
        onConfirm={() => void handleDeleteLocation()}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDeleteLoc(null);
        }}
      />

      {/* 新增空间地点 Modal */}
      <Dialog
        open={showAddLocationModal}
        onOpenChange={(open) => {
          if (!open && !locSubmitting) setShowAddLocationModal(false);
        }}
      >
        <DialogContent
          closeDisabled={locSubmitting}
          onEscapeKeyDown={(e) => {
            if (locSubmitting) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (locSubmitting) e.preventDefault();
          }}
          className="max-w-md gap-4"
        >
          <DialogHeader className="text-left space-y-1 pr-10">
            <DialogTitle>录入微观地点与高精坐标解析</DialogTitle>
            <DialogDescription>
              输入道路、小区、商户或门牌地标，系统将通过天地图官方高精接口即时解析并沉淀到标准字典中
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddLocation} className="space-y-3.5">
            <div>
              <label htmlFor="dict-new-location-address" className="text-[13px] font-medium text-slate-700 mb-1 block">
                微观地点全称或道路门牌 <span className="text-rose-500">*</span>
              </label>
              <input
                id="dict-new-location-address"
                type="text"
                required
                value={newLocationAddress}
                onChange={(e) => setNewLocationAddress(e.target.value)}
                placeholder="如：大良街道清晖园南门、容奇大道中12号"
                className="w-full min-h-[44px] sm:min-h-[36px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <DialogFooter className="flex-row justify-end gap-2.5 pt-4 border-t border-slate-100">
              <button
                type="button"
                className="btn btn--default min-h-[44px] sm:min-h-[36px]"
                onClick={() => setShowAddLocationModal(false)}
                disabled={locSubmitting}
              >
                取消
              </button>
              <button type="submit" className="btn btn--primary min-h-[44px] sm:min-h-[36px]" disabled={locSubmitting}>
                {locSubmitting ? "天地图解析中..." : "解析并存入字典"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
