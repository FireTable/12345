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

export default function DictionaryManagementPage() {
  const { activeRegion } = useRegion();
  const [activeTab, setActiveTab] = useState<"aliases" | "townships" | "categories">("aliases");
  const [loading, setLoading] = useState(true);

  const [aliases, setAliases] = useState<AliasItem[]>([]);
  const [townships, setTownships] = useState<TownshipItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [stats, setStats] = useState({
    townshipCount: 10,
    categoryCount: 7,
    aliasCount: 0,
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
        setAliases(data.aliases || []);
        setTownships(data.townships || []);
        setCategories(data.categories || []);
        const totalCommunities =
          data.townships?.reduce((acc: number, t: any) => acc + (t.communities?.length || 0), 0) || 0;
        setStats({
          townshipCount: data.stats?.townshipCount || data.townships?.length || 0,
          categoryCount: data.stats?.categoryCount || data.categories?.length || 0,
          aliasCount: data.stats?.aliasCount || data.aliases?.length || 0,
          communityCount: totalCommunities || data.stats?.communityCount || 0,
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
    { key: "townships", label: `${activeRegion ? activeRegion.name : ""} ${stats.townshipCount} 大法定镇街区划` },
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
        setNormalizedTestResult(data.normalized);
      }
    } catch (e) {}
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

      {/* 统一 Tab 栏与筛选栏 */}
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
                : t.key === "townships"
                ? townships.length
                : categories.length}
            </span>
          </button>
        ))}
      </div>

      {/* 别名 Tab 下的筛选栏 */}
      {activeTab === "aliases" && (
        <div className="filter-bar mb-4">
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
        </div>
      )}

      {/* Tab 1: 别名知识库映射列表 (Table) */}
      {activeTab === "aliases" && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
          <div className="table-scroll overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-3">俗称 / 别名 (Alias)</th>
                  <th className="px-4 py-3">对应标准规范全称 (Canonical)</th>
                  <th className="px-4 py-3">实体类型</th>
                  <th className="px-4 py-3">来源渠道</th>
                  <th className="px-4 py-3">替换生效</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredAliases.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-400 text-xs">
                      未找到符合条件的别名映射规则
                    </td>
                  </tr>
                ) : (
                  pagedAliases.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-medium">
                        <span className="rounded bg-amber-50 border border-amber-200/80 px-2 py-0.5 text-[11px] font-mono text-amber-800 font-semibold">
                          {item.alias}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <span className="text-emerald-600 mr-1.5 font-normal">➔</span>
                        {item.canonical}
                      </td>
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                            item.source === "AI_MINED"
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
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          已启用
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setPendingDelete({ id: item.id, alias: item.alias })}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
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
        </div>
      )}

      {/* Tab 2: 顺德 10 大法定镇街区划 */}
      {activeTab === "townships" && (
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
      )}

      {/* Tab 3: 7 大民生诉求分类标准 */}
      {activeTab === "categories" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {categories.map((c) => (
            <div
              key={c.category}
              className="bg-white rounded-xl border border-slate-200/90 p-4 hover:border-slate-300 transition-all shadow-2xs"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-purple-600"></span>
                  <h3 className="text-sm font-bold text-slate-900">{c.category}</h3>
                </div>
                <span className="text-[10px] font-medium rounded-full bg-purple-50 text-purple-700 px-2 py-0.5 border border-purple-200/80">
                  7大标准分类
                </span>
              </div>

              <div className="mb-2.5">
                <span className="text-[11px] text-slate-500 block mb-1">牵头负责科室:</span>
                <p className="text-xs font-semibold text-slate-800 bg-slate-50 p-2 rounded-lg border border-slate-200/80">
                  🏢 {c.leadDepartment}
                </p>
              </div>

              <div>
                <span className="text-[11px] text-slate-500 block mb-1">包含细分诉求事项:</span>
                <div className="flex flex-wrap gap-1">
                  {c.subItems.map((sub) => (
                    <span
                      key={sub}
                      className="rounded bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] text-slate-700"
                    >
                      • {sub}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
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
    </>
  );
}
