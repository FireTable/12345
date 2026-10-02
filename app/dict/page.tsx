"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  MapPin,
  Tag,
  Sparkles,
  Plus,
  Trash2,
  CheckCircle2,
  RefreshCw,
  Zap,
  BookOpen,
  List,
  Map as MapIcon,
  Layers,
  Navigation,
  Compass,
} from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";
import { SkDict } from "@/app/_components/civic/skeletons";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/app/_components/ui/select";
import { toast } from "sonner";
import { ConfirmDialog } from "@/app/_components/ui/confirm-dialog";
import { TablePager } from "@/app/_components/civic/table-pager";
import { useRegion } from "@/app/_components/civic/region-context";
import { resolveApiError } from "@/lib/api-codes";
import { categoryVisual } from "@/lib/civic-cluster";
import { CivicGeoMap, GeoPoint } from "@/app/_components/civic/civic-geo-map";

const TOWNSHIP_COLORS: Record<string, string> = {
  "大良": "#1E5AFF",
  "大良街道": "#1E5AFF",
  "容桂": "#722ED1",
  "容桂街道": "#722ED1",
  "伦教": "#08979C",
  "伦教街道": "#08979C",
  "勒流": "#2F54EB",
  "勒流街道": "#2F54EB",
  "北滘": "#FA8C16",
  "北滘镇": "#FA8C16",
  "陈村": "#52C41A",
  "陈村镇": "#52C41A",
  "乐从": "#EB2F96",
  "乐从镇": "#EB2F96",
  "龙江": "#D46B08",
  "龙江镇": "#D46B08",
  "杏坛": "#1890FF",
  "杏坛镇": "#1890FF",
  "均安": "#7CB305",
  "均安镇": "#7CB305",
};

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

export default function DictionaryManagementPage() {
  const { activeRegion } = useRegion();
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
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // 新增别名弹窗与表单
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAlias, setNewAlias] = useState("");
  const [newCanonical, setNewCanonical] = useState("");
  const [newType, setNewType] = useState("LOCATION");
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
    activeRegion?.id?.includes("tianhe")
      ? "市民在花城广场与正佳附近反映体育西商圈某商户噪音扰民，希望猎德综合行政执法队介入。"
      : "市民在容奇大桥附近反映某商户违规经营，希望属地综合行政执法队介入。"
  );
  const [normalizedTestResult, setNormalizedTestResult] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      const regionParam = activeRegion?.id ? `&region=${encodeURIComponent(activeRegion.id)}` : "";
      const res = await fetch(`/api/dict?q=${encodeURIComponent(searchQuery)}${regionParam}`);
      const data = await res.json();
      if (data.success) {
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
    } catch (err) {
      toast.error("加载词典数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [searchQuery, activeRegion?.id]);

  const tabs = [
    { key: "aliases", label: "别名知识库映射" },
    { key: "locations", label: "空间地理坐标库 (Canonical)" },
    { key: "townships", label: `${activeRegion ? activeRegion.name : "辖区"}法定区划 (${stats.townshipCount} 街道/镇街)` },
    { key: "categories", label: `${stats.categoryCount} 大民生诉求分类标准` },
  ] as const;

  // 执行实时测试替换
  const handleTestReplace = async (text: string) => {
    setTestText(text);
    if (!text.trim()) {
      setNormalizedTestResult("");
      return;
    }
    try {
      const res = await fetch("/api/dict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_replace", text }),
      });
      const data = await res.json();
      if (data.success) {
        const payload = data.data || data;
        setNormalizedTestResult(payload.normalized || "");
      }
    } catch (e) { }
  };

  useEffect(() => {
    handleTestReplace(testText);
  }, []);

  // 新增别名提交
  const handleAddAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlias.trim() || !newCanonical.trim()) {
      toast.error("请填写完整的别名与规范名称");
      return;
    }

    try {
      const res = await fetch("/api/dict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        fetchData();
      } else {
        toast.error(resolveApiError(data, "添加失败"));
      }
    } catch (e) {
      toast.error("添加请求异常");
    }
  };

  const handleDeleteAlias = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/dict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_alias", id: pendingDelete.id, alias: pendingDelete.alias }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("别名已删除");
        setPendingDelete(null);
        fetchData();
      } else {
        toast.error(resolveApiError(data, "删除失败"));
      }
    } catch (e) {
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
      const res = await fetch("/api/map/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: newLocationAddress.trim() }),
      });
      const data = await res.json();
      const d = data.data || data;
      if (d.success && d.lng && d.lat) {
        toast.success(`高精坐标已沉淀：${d.canonical} [${d.lng.toFixed(5)}, ${d.lat.toFixed(5)}]`);
        setShowAddLocationModal(false);
        setNewLocationAddress("");
        fetchData();
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_location", id: pendingDeleteLoc.id }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("空间地点坐标已删除");
        setPendingDeleteLoc(null);
        fetchData();
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

  return (
    <>
      {/* 头部导航与操作栏 */}
      <div className="page-hero">
        <div>
          <div className="page-hero__title">
            标准字典与知识库
          </div>
          <div className="page-hero__desc">
            {activeRegion ? `${activeRegion.city} · ${activeRegion.name}` : "当前辖区"}{" "}
            {stats.townshipCount} 大法定镇街区划、{stats.categoryCount} 大民生诉求分类标准及 AI 自学习别名沉淀知识库统一管理平台
          </div>
        </div>
        <div className="page-hero__actions">
          <button
            type="button"
            className="btn btn--default"
            onClick={fetchData}
          >
            <RefreshCw className="h-4 w-4 mr-1.5" />
            刷新数据
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setShowAddModal(true)}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            新增别名映射
          </button>
        </div>
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
              sub={`${townships.slice(0, 4).map((t) => t.name).join("/") || "辖区镇街"} 等 ${stats.townshipCount} 个辖区`}
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
              sub={`${stats.categoryCount} 大法定标准业务大类`}
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
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600">
                  <Zap className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-semibold text-slate-800">
                  AI 别名归一化即时替换演练（Live Sandbox）
                </span>
              </div>
              <span className="text-[11px] text-slate-500">
                实时验证口语/旧称/缩写到法定权威全称的替换效果
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div>
                <label className="text-[11px] font-medium text-slate-600 mb-1 block">
                  输入包含口语/俗称的原始文本：
                </label>
                <input
                  type="text"
                  value={testText}
                  onChange={(e) => handleTestReplace(e.target.value)}
                  placeholder="输入文本测试别名替换..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-emerald-700 mb-1 block">
                  归一化替换结果（大模型输入标准）：
                </label>
                <div className="w-full rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-xs font-medium text-emerald-800 min-h-[34px] flex items-center">
                  {normalizedTestResult || <span className="text-slate-400 text-xs">输入文本后即时呈现替换结果...</span>}
                </div>
              </div>
            </div>
          </div>

          {/* 统一卡片容器：Tab 与数据/列表无缝聚合为一个整体 */}
          <div className="card list-card">
            {/* 顶部 Tab 栏：内嵌在卡片顶端 */}
            <div className="filter-tabs">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`filter-tab${activeTab === t.key ? " is-active" : ""}`}
                  onClick={() => {
                    setActiveTab(t.key as any);
                    setPage(1);
                  }}
                >
                  {t.label}
                  <span className="filter-tab__count">
                    {t.key === "aliases"
                      ? aliases.length
                      : t.key === "locations"
                        ? locations.length
                        : t.key === "townships"
                          ? townships.length
                          : categories.length}
                  </span>
                </button>
              ))}
            </div>

            {/* Tab 1: 别名知识库映射 */}
            {activeTab === "aliases" && (
              <>
                <div className="filter-bar">
                  <div className="search-input">
                    <span>⌕</span>
                    <input
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
                    <SelectTrigger className="w-[140px] h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg">
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
                  <span className="filter-bar__summary">共 {filteredAliases.length} 条别名映射</span>
                </div>

                <div className="table-scroll">
                  <table className="group-table">
                    <thead>
                      <tr>
                        <th style={{ width: 170 }}>俗称 / 别名 (Alias)</th>
                        <th>对应标准规范全称 (Canonical)</th>
                        <th style={{ width: 120 }}>实体类型</th>
                        <th style={{ width: 125 }}>来源渠道</th>
                        <th style={{ width: 110 }}>替换生效</th>
                        <th style={{ width: 85, textAlign: "right" }}>操作</th>
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
                              <span className="rounded bg-amber-50 border border-amber-200/80 px-2 py-0.5 text-[11px] font-mono text-amber-800 font-semibold">
                                {item.alias}
                              </span>
                            </td>
                            <td style={{ fontWeight: 600, color: "var(--c-ink)" }}>
                              <span className="text-emerald-600 mr-1.5 font-normal">➔</span>
                              {item.canonical}
                            </td>
                            <td>
                              <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-200/80 px-2.5 py-0.5 text-[10px] font-medium text-blue-700">
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
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${item.source === "AI_MINED"
                                    ? "bg-purple-50 text-purple-700 border-purple-200/80"
                                    : item.source === "MANUAL"
                                      ? "bg-amber-50 text-amber-700 border-amber-200/80"
                                      : "bg-slate-100 text-slate-600 border-slate-200/80"
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
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                已启用
                              </span>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                type="button"
                                onClick={() => setPendingDelete({ id: item.id, alias: item.alias })}
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors inline-flex items-center justify-center"
                                title="删除别名"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
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
              // 过滤匹配的地点数据
              const filteredLocs = locations.filter((loc) => {
                if (townshipFilter !== "ALL") {
                  let m: any = {};
                  try { m = JSON.parse(loc.metaJson || "{}"); } catch { }
                  const town = loc.parentName || m.township || "";
                  if (!town.includes(townshipFilter)) return false;
                }
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return (
                  loc.name.toLowerCase().includes(q) ||
                  (loc.parentName || "").toLowerCase().includes(q) ||
                  (loc.fullName || "").toLowerCase().includes(q)
                );
              });

              // 提取有经纬度的点位供地图全览批量打点
              const geoPoints: GeoPoint[] = filteredLocs
                .map((loc) => {
                  let meta: any = {};
                  try { meta = JSON.parse(loc.metaJson || "{}"); } catch { }
                  if (typeof meta.lng !== "number" || typeof meta.lat !== "number") return null;
                  const town = loc.parentName || meta.township || "";
                  return {
                    id: loc.id,
                    lng: meta.lng,
                    lat: meta.lat,
                    title: loc.name,
                    township: town,
                    address: meta.formattedAddress || loc.fullName || loc.name,
                    color: TOWNSHIP_COLORS[town] || "#1E5AFF",
                    raw: loc,
                  };
                })
                .filter(Boolean) as GeoPoint[];

              // 提取当前辖区下出现的所有镇街选项
              const availableTownships = Array.from(
                new Set(
                  locations
                    .map((loc) => {
                      let m: any = {};
                      try { m = JSON.parse(loc.metaJson || "{}"); } catch { }
                      return loc.parentName || m.township || "";
                    })
                    .filter(Boolean)
                )
              );

              // 当前选中的全览点位
              const activeLocItem = activeMapLocId ? locations.find((l) => l.id === activeMapLocId) : null;
              let activeMeta: any = {};
              if (activeLocItem) {
                try { activeMeta = JSON.parse(activeLocItem.metaJson || "{}"); } catch { }
              }

              return (
                <>
                  {/* 顶部工具栏：搜索、视图切换、录入 */}
                  <div
                    className="filter-bar"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 12,
                      padding: "12px 20px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 280 }}>
                      <div className="search-input" style={{ maxWidth: 320, width: "100%" }}>
                        <span>⌕</span>
                        <input
                          placeholder="搜索微观地点名称 · 道路 · 镇街..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                      </div>

                      {/* 视图模式切换 Segmented Control */}
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          background: "#F1F5F9",
                          padding: 3,
                          borderRadius: 8,
                          border: "1px solid #E2E8F0",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setLocViewMode("table")}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "5px 12px",
                            fontSize: 12,
                            fontWeight: locViewMode === "table" ? 600 : 500,
                            color: locViewMode === "table" ? "#0F172A" : "#64748B",
                            background: locViewMode === "table" ? "#FFFFFF" : "transparent",
                            borderRadius: 6,
                            boxShadow: locViewMode === "table" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                            cursor: "pointer",
                            border: "none",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <List style={{ width: 14, height: 14 }} />
                          <span>列表明细</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setLocViewMode("map")}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "5px 12px",
                            fontSize: 12,
                            fontWeight: locViewMode === "map" ? 600 : 500,
                            color: locViewMode === "map" ? "#1E5AFF" : "#64748B",
                            background: locViewMode === "map" ? "#FFFFFF" : "transparent",
                            borderRadius: 6,
                            boxShadow: locViewMode === "map" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                            cursor: "pointer",
                            border: "none",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <MapIcon style={{ width: 14, height: 14 }} />
                          <span>地图全览</span>
                          <span
                            style={{
                              fontSize: 10,
                              padding: "1px 5px",
                              borderRadius: 99,
                              background: locViewMode === "map" ? "#EFF6FF" : "#E2E8F0",
                              color: locViewMode === "map" ? "#1E5AFF" : "#64748B",
                            }}
                          >
                            {geoPoints.length}
                          </span>
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowAddLocationModal(true)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        height: 32,
                        padding: "0 12px",
                        borderRadius: 7,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#FFFFFF",
                        background: "#1E5AFF",
                        border: "none",
                        boxShadow: "0 1px 3px rgba(30, 90, 255, 0.25)",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#1448D6")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "#1E5AFF")}
                    >
                      <Plus style={{ width: 13, height: 13 }} />
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
                      <span style={{ fontSize: 11, color: "#64748B", whiteSpace: "nowrap" }}>镇街过滤:</span>
                      <button
                        type="button"
                        onClick={() => setTownshipFilter("ALL")}
                        style={{
                          padding: "2px 8px",
                          borderRadius: 12,
                          fontSize: 11,
                          border: "1px solid",
                          cursor: "pointer",
                          transition: "all 0.12s",
                          borderColor: townshipFilter === "ALL" ? "#1E5AFF" : "#E2E8F0",
                          background: townshipFilter === "ALL" ? "#1E5AFF" : "#FFFFFF",
                          color: townshipFilter === "ALL" ? "#FFFFFF" : "#475569",
                          fontWeight: townshipFilter === "ALL" ? 600 : 400,
                        }}
                      >
                        全部 ({locations.length})
                      </button>
                      {availableTownships.map((town) => {
                        const count = locations.filter((loc) => {
                          let m: any = {};
                          try { m = JSON.parse(loc.metaJson || "{}"); } catch { }
                          return (loc.parentName || m.township || "") === town;
                        }).length;
                        const isActive = townshipFilter === town;
                        const color = TOWNSHIP_COLORS[town] || "#1E5AFF";
                        return (
                          <button
                            key={town}
                            type="button"
                            onClick={() => setTownshipFilter(isActive ? "ALL" : town)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "2px 8px",
                              borderRadius: 12,
                              fontSize: 11,
                              border: "1px solid",
                              cursor: "pointer",
                              transition: "all 0.12s",
                              borderColor: isActive ? color : "#E2E8F0",
                              background: isActive ? `${color}15` : "#FFFFFF",
                              color: isActive ? color : "#475569",
                              fontWeight: isActive ? 600 : 400,
                            }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                            <span>{town}</span>
                            <span style={{ opacity: 0.7, fontSize: 10 }}>({count})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* ---------------- 模式 1：🗺️ 地图全览模式 ---------------- */}
                  {locViewMode === "map" && (
                    <div style={{ padding: "0 20px 20px 20px" }}>
                      <div
                        style={{
                          position: "relative",
                          borderRadius: 12,
                          overflow: "hidden",
                          border: "1px solid #CBD5E1",
                          boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
                          isolation: "isolate",
                          zIndex: 1,
                        }}
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
                          style={{
                            position: "absolute",
                            top: 12,
                            left: 12,
                            zIndex: 1,
                            background: "rgba(255, 255, 255, 0.94)",
                            backdropFilter: "blur(8px)",
                            border: "1px solid rgba(203, 213, 225, 0.8)",
                            borderRadius: 8,
                            padding: "6px 12px",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 12,
                          }}
                        >
                          <Compass style={{ width: 15, height: 15, color: "#1E5AFF" }} />
                          <span style={{ fontWeight: 600, color: "#0F172A" }}>
                            标准空间地理坐标库全景
                          </span>
                          <span style={{ color: "#64748B" }}>·</span>
                          <span style={{ color: "#1E5AFF", fontWeight: 700 }}>
                            {geoPoints.length}
                          </span>
                          <span style={{ color: "#64748B" }}>个已上图高精点位</span>
                        </div>

                        {/* 地图右侧浮动点位详情卡片 */}
                        <div
                          style={{
                            position: "absolute",
                            top: 12,
                            right: 12,
                            width: 320,
                            maxWidth: "calc(100% - 24px)",
                            zIndex: 900,
                            background: "rgba(255, 255, 255, 0.96)",
                            backdropFilter: "blur(12px)",
                            border: "1px solid #CBD5E1",
                            borderRadius: 10,
                            padding: 14,
                            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)",
                          }}
                        >
                          {activeLocItem ? (
                            <div>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span
                                    style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: "50%",
                                      background: TOWNSHIP_COLORS[activeLocItem.parentName || activeMeta.township || ""] || "#1E5AFF",
                                    }}
                                  />
                                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                                    {activeLocItem.name}
                                  </h4>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setActiveMapLocId(null)}
                                  style={{ border: "none", background: "none", cursor: "pointer", color: "#94A3B8", fontSize: 13 }}
                                  title="关闭详情卡片"
                                >
                                  ✕
                                </button>
                              </div>

                              {activeLocItem.fullName && activeLocItem.fullName !== activeLocItem.name && (
                                <div style={{ fontSize: 11, color: "#64748B", marginBottom: 8, paddingLeft: 14 }}>
                                  {activeLocItem.fullName}
                                </div>
                              )}

                              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: "#334155", marginTop: 8 }}>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "#64748B" }}>所属法定辖区:</span>
                                  <span style={{ fontWeight: 600, color: "#1E5AFF" }}>
                                    {activeLocItem.parentName || activeMeta.township || "顺德区"}
                                  </span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "#64748B" }}>天地图经纬度:</span>
                                  <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                                    {activeMeta.lng?.toFixed(5)}, {activeMeta.lat?.toFixed(5)}
                                  </span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "#64748B" }}>解析精度 / 打分:</span>
                                  <span>{activeMeta.level || "微观门牌"} ({activeMeta.score || 100}分)</span>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between" }}>
                                  <span style={{ color: "#64748B" }}>规范数据来源:</span>
                                  <span style={{ color: "#16A34A", fontWeight: 500 }}>
                                    {activeMeta.source === "TIANDITU_GEOCODE" ? "天地图自动解析" : "人工标定录入"}
                                  </span>
                                </div>
                              </div>

                              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLocViewMode("table");
                                    setSearchQuery(activeLocItem.name);
                                  }}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    fontSize: 11,
                                    color: "#1E5AFF",
                                    background: "#EFF6FF",
                                    border: "1px solid #DBEAFE",
                                    padding: "4px 8px",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                  }}
                                >
                                  <List style={{ width: 12, height: 12 }} />
                                  <span>在列表中查看</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingDeleteLoc(activeLocItem)}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    fontSize: 11,
                                    color: "#E11D48",
                                    background: "#FFF1F2",
                                    border: "1px solid #FFE4E6",
                                    padding: "4px 8px",
                                    borderRadius: 6,
                                    cursor: "pointer",
                                  }}
                                >
                                  <Trash2 style={{ width: 12, height: 12 }} />
                                  <span>删除点位</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                <Navigation style={{ width: 14, height: 14, color: "#1E5AFF" }} />
                                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#0F172A" }}>
                                  点击任意点位查看坐标详情
                                </h4>
                              </div>
                              <p style={{ margin: "4px 0 0 0", fontSize: 11, color: "#64748B", lineHeight: 1.5 }}>
                                当前全览汇聚了 {geoPoints.length} 个经高精地理编码规范化的微观地点。点击地图上的标记可查看经纬度、镇街从属及关联诉求。
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
                        let meta: any = {};
                        try { meta = JSON.parse(previewLocation.metaJson || "{}"); } catch { }
                        return (
                          <div className="mx-5 my-3 p-4 bg-slate-50 border border-blue-200 rounded-xl relative shadow-xs">
                            <div className="flex items-center justify-between mb-2.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                                <span className="text-xs font-bold text-slate-800">
                                  📍 正在预览空间位置：{previewLocation.name}
                                </span>
                                <span className="text-[11px] font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                  {meta.lng?.toFixed(6)}, {meta.lat?.toFixed(6)}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="text-xs text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded hover:bg-blue-100/60 transition-colors font-medium flex items-center gap-1"
                                  onClick={() => {
                                    setActiveMapLocId(previewLocation.id);
                                    setLocViewMode("map");
                                  }}
                                >
                                  <MapIcon className="w-3 h-3" />
                                  <span>进入地图全览</span>
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-slate-400 hover:text-slate-700 px-2 py-0.5 rounded hover:bg-slate-200/60 transition-colors"
                                  onClick={() => setPreviewLocation(null)}
                                >
                                  收起 ✕
                                </button>
                              </div>
                            </div>
                            {meta.lng && meta.lat ? (
                              <CivicGeoMap
                                mode="single"
                                height={250}
                                point={{
                                  id: previewLocation.id,
                                  lng: meta.lng,
                                  lat: meta.lat,
                                  title: previewLocation.name,
                                  township: previewLocation.parentName || meta.township,
                                  address: meta.formattedAddress || previewLocation.fullName,
                                  color: TOWNSHIP_COLORS[previewLocation.parentName || meta.township || ""] || "#1E5AFF",
                                }}
                              />
                            ) : (
                              <div className="h-28 flex items-center justify-center text-xs text-slate-400">
                                该地点未关联经纬度坐标
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div className="workorder-table-wrap">
                        <table className="workorder-table">
                          <thead>
                            <tr>
                              <th>规范地点名称 (Canonical)</th>
                              <th>所属法定镇街</th>
                              <th>天地图高精经纬度</th>
                              <th>解析精度 / 级别</th>
                              <th>数据来源</th>
                              <th style={{ textAlign: "right" }}>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredLocs.length === 0 ? (
                              <tr>
                                <td colSpan={6} style={{ textAlign: "center", padding: "40px 0", color: "var(--c-ink-3)" }}>
                                  暂无符合条件的空间坐标。可点击上方按钮录入或重置筛选。
                                </td>
                              </tr>
                            ) : (
                              filteredLocs.map((loc) => {
                                let meta: any = {};
                                try { meta = JSON.parse(loc.metaJson || "{}"); } catch { }
                                const hasCoords = typeof meta.lng === "number" && typeof meta.lat === "number";
                                const town = loc.parentName || meta.township || "";
                                const townColor = TOWNSHIP_COLORS[town] || "#64748B";
                                const isPreviewing = previewLocation?.id === loc.id;

                                return (
                                  <tr key={loc.id} className="hover:bg-blue-50/40 transition-colors">
                                    <td style={{ fontWeight: 600, color: "var(--c-ink)" }}>
                                      <div className="font-semibold text-slate-800 text-[13px]">
                                        {loc.name}
                                      </div>
                                      {loc.fullName && loc.fullName !== loc.name && (
                                        <div className="text-[11px] text-slate-400 font-normal mt-0.5">
                                          {loc.fullName}
                                        </div>
                                      )}
                                    </td>
                                    <td>
                                      <span
                                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                                        style={{
                                          background: `${townColor}15`,
                                          color: townColor,
                                          border: `1px solid ${townColor}30`,
                                        }}
                                      >
                                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: townColor }} />
                                        <span>{town || "—"}</span>
                                      </span>
                                    </td>
                                    <td>
                                      {hasCoords ? (
                                        <span className="font-mono text-[11px] text-slate-700 bg-slate-100/80 px-2 py-0.5 rounded border border-slate-200">
                                          {meta.lng.toFixed(5)}, {meta.lat.toFixed(5)}
                                        </span>
                                      ) : (
                                        <span className="text-slate-400 text-xs">未获取</span>
                                      )}
                                    </td>
                                    <td>
                                      <span className="text-xs text-slate-600">
                                        {meta.level || "地点"} {meta.score ? `(${meta.score}分)` : ""}
                                      </span>
                                    </td>
                                    <td>
                                      <span
                                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${meta.source === "TIANDITU_GEOCODE"
                                            ? "bg-blue-50 text-blue-700 border-blue-200/80"
                                            : "bg-emerald-50 text-emerald-700 border-emerald-200/80"
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
                                          className={`p-1.5 rounded-md transition-colors inline-flex items-center justify-center ${isPreviewing
                                              ? "bg-blue-100 text-blue-600"
                                              : "text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                            }`}
                                          title={isPreviewing ? "收起地图定位" : "在地图中查看打点"}
                                        >
                                          <MapPin className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setPendingDeleteLoc(loc)}
                                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors inline-flex items-center justify-center"
                                          title="删除空间坐标"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
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
                      className="bg-white rounded-xl border border-slate-200/90 p-4 hover:border-slate-300 transition-all shadow-2xs"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-blue-600"></span>
                          <h3 className="text-sm font-bold text-slate-900">{t.fullName}</h3>
                          <span className="text-xs text-slate-500 font-mono">（简称：{t.name}）</span>
                        </div>
                        <span className="text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 border border-emerald-200/80">
                          法定辖区
                        </span>
                      </div>

                      {/* 别名 Tags */}
                      <div className="mb-2.5">
                        <span className="text-[11px] text-slate-500 mr-1.5">俗称/别名:</span>
                        <div className="inline-flex flex-wrap gap-1 mt-0.5">
                          {t.aliases.map((alias) => (
                            <span
                              key={alias}
                              className="rounded bg-amber-50/80 border border-amber-200/60 px-1.5 py-0.5 text-[10px] text-amber-800 font-mono"
                            >
                              {alias}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* 代表村居社区 */}
                      <div className="mb-2.5">
                        <span className="text-[11px] text-slate-500 block mb-1">主要村居社区 ({t.communities.length}个):</span>
                        <div className="flex flex-wrap gap-1">
                          {t.communities.map((c) => (
                            <span
                              key={c}
                              className="rounded bg-blue-50/80 border border-blue-200/60 px-1.5 py-0.5 text-[10px] text-blue-700"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* 知名地标与园区 */}
                      {t.landmarks && t.landmarks.length > 0 && (
                        <div>
                          <span className="text-[11px] text-slate-500 block mb-1">重点地标与园区:</span>
                          <div className="flex flex-wrap gap-1">
                            {t.landmarks.map((lm) => (
                              <span
                                key={lm}
                                className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600"
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
                        className="bg-white rounded-xl border border-slate-200/90 p-4 hover:border-slate-300 transition-all shadow-2xs relative overflow-hidden"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: visual.color }}
                            />
                            <h3 className="text-sm font-bold text-slate-900">{c.category}</h3>
                          </div>
                          <span
                            className="text-[10px] font-medium rounded-full px-2 py-0.5 border"
                            style={{
                              color: visual.color,
                              backgroundColor: visual.bg,
                              borderColor: visual.border,
                            }}
                          >
                            7大标准分类
                          </span>
                        </div>

                        <div className="mb-2.5">
                          <span className="text-[11px] text-slate-500 block mb-1">牵头负责科室:</span>
                          <p
                            className="text-xs font-semibold p-2 rounded-lg border flex items-center gap-1.5"
                            style={{
                              backgroundColor: visual.bg,
                              borderColor: visual.border,
                              color: visual.color,
                            }}
                          >
                            <span>🏢</span>
                            <span>{c.leadDepartment}</span>
                          </p>
                        </div>

                        <div>
                          <span className="text-[11px] text-slate-500 block mb-1">包含细分诉求事项:</span>
                          <div className="flex flex-wrap gap-1">
                            {c.subItems.map((sub) => (
                              <span
                                key={sub}
                                className="rounded bg-slate-100 hover:bg-slate-200/70 transition-colors border border-slate-200 px-2 py-0.5 text-[10px] text-slate-700"
                              >
                                • {sub}
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
      {showAddModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <h3 className="text-base font-bold text-slate-900 mb-1">新增别名映射与实体沉淀</h3>
            <p className="text-xs text-slate-500 mb-4">
              设置市民口语/俗称/缩写到法定权威全称的自动替换映射关系
            </p>

            <form onSubmit={handleAddAlias} className="space-y-3.5">
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">
                  俗称 / 别名 (Alias) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  placeholder="例如：容奇、碧桂园总部、小黄圃工业区"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">
                  对应标准规范全称 (Canonical) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newCanonical}
                  onChange={(e) => setNewCanonical(e.target.value)}
                  placeholder="例如：容桂街道、北滘镇、容桂街道小黄圃社区"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">实体分类</label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger className="w-full h-9 bg-slate-50/50 border-slate-200 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TOWNSHIP">镇街区划 (Township)</SelectItem>
                    <SelectItem value="LOCATION">微观点位/社区 (Location)</SelectItem>
                    <SelectItem value="DEPARTMENT">责任部门 (Department)</SelectItem>
                    <SelectItem value="ENTITY">涉事主体/商户 (Entity)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  className="btn btn--default"
                  onClick={() => setShowAddModal(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn btn--primary">
                  保存并沉淀
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
      {showAddLocationModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl animate-in fade-in zoom-in duration-150">
            <h3 className="text-base font-bold text-slate-900 mb-1">录入微观地点与高精坐标解析</h3>
            <p className="text-xs text-slate-500 mb-4">
              输入道路、小区、商户或门牌地标，系统将通过天地图官方高精接口即时解析并沉淀到标准字典中
            </p>

            <form onSubmit={handleAddLocation} className="space-y-3.5">
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">
                  微观地点全称或道路门牌 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newLocationAddress}
                  onChange={(e) => setNewLocationAddress(e.target.value)}
                  placeholder="如：大良街道清晖园南门、容奇大道中12号"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  className="btn btn--default"
                  onClick={() => setShowAddLocationModal(false)}
                  disabled={locSubmitting}
                >
                  取消
                </button>
                <button type="submit" className="btn btn--primary" disabled={locSubmitting}>
                  {locSubmitting ? "天地图解析中..." : "解析并存入字典"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
