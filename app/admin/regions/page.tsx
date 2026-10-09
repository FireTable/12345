"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Building2,
  Database,
  MapPin,
  Sparkles,
  Plus,
  RefreshCw,
  Upload,
  CheckCircle2,
  Check,
  Trash2,
  Map,
  ShieldCheck,
  Layers,
  ExternalLink,
  BookOpen,
  AlertTriangle,
  Loader2,
  Star,
  Compass,
  KeyRound,
} from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";
import { useRegion, RegionInfo } from "@/app/_components/civic/region-context";
import { ConfirmDialog } from "@/app/_components/ui/confirm-dialog";
import { PageHeaderActions } from "@/app/_components/civic/page-header-actions";
import { toast } from "sonner";
import { resolveApiError } from "@/lib/api-codes";

interface RegionWithStats extends RegionInfo {
  ticketCount: number;
  themeCount: number;
  vocabCount: number;
  status?: string;
  createdAt?: string;
}

interface McpClientRow {
  id: string;
  name: string;
  userId: string;
  userName: string;
  userEmail: string;
  username: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface AiScoutResult {
  townships: Array<{
    name: string;
    fullName: string;
    aliases: string[];
    communities: string[];
    landmarks: string[];
  }>;
  departments: Array<{
    code: string;
    name: string;
    fullName: string;
    category: string;
  }>;
  categories: Array<{
    category: string;
    subItems: string[];
    leadDepartment: string;
  }>;
}

export default function AdminRegionsPage() {
  const { activeRegion, switchRegion } = useRegion();
  const [regions, setRegions] = useState<RegionWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [mcpClients, setMcpClients] = useState<McpClientRow[]>([]);
  const [revokingClientId, setRevokingClientId] = useState<string | null>(null);

  // AI Scout 向导状态
  const [showScoutModal, setShowScoutModal] = useState(false);
  const [scoutStep, setScoutStep] = useState<1 | 2>(1);
  const [scoutLoading, setScoutLoading] = useState(false);
  const [scoutForm, setScoutForm] = useState({
    province: "广东省",
    city: "广州市",
    district: "天河区",
    id: "gz_tianhe",
    isDefault: false,
  });
  const [scoutResult, setScoutResult] = useState<AiScoutResult | null>(null);
  const [savingNewRegion, setSavingNewRegion] = useState(false);
  const [scoutActiveTab, setScoutActiveTab] = useState<"townships" | "departments" | "categories">("townships");

  // SVG 地图上传模态框
  const [uploadModalRegion, setUploadModalRegion] = useState<RegionWithStats | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewSvg, setPreviewSvg] = useState<string | null>(null);

  // 删除站点确认弹窗
  const [deletingRegion, setDeletingRegion] = useState<RegionWithStats | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const fetchRegions = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/regions");
      const raw = await res.json();
      const list = raw.data?.regions || raw.regions;
      if (Array.isArray(list)) {
        setRegions(list);
      }
    } catch (err: any) {
      toast.error("获取地区站点列表失败");
    } finally {
      setLoading(false);
    }
  };

  const fetchMcpClients = async () => {
    try {
      const res = await fetch("/api/admin/mcp-clients");
      const raw = await res.json();
      const list = raw.data?.clients;
      setMcpClients(Array.isArray(list) ? list : []);
    } catch {
      toast.error("获取已接入的 Agent 失败");
    }
  };

  const revokeClient = async (id: string) => {
    try {
      setRevokingClientId(id);
      const res = await fetch("/api/admin/mcp-clients", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const raw = await res.json();
      if (!res.ok || !raw.success) {
        toast.error(resolveApiError(raw, "吊销失败"));
        return;
      }
      toast.success("已吊销，这把 access key 不能再调用");
      await fetchMcpClients();
    } catch {
      toast.error("吊销请求失败");
    } finally {
      setRevokingClientId(null);
    }
  };

  useEffect(() => {
    fetchRegions();
    fetchMcpClients();
  }, []);

  // 监听城市区县变化自动推荐英文 ID（全动态生成，无任何城市区县死逻辑写死）
  const handleDistrictChange = (district: string) => {
    setScoutForm((prev) => {
      const cleanDistrict = district.replace(/[区县市旗镇街道]/g, "").trim().toLowerCase();
      const cleanCity = (prev.city || "").replace(/[市盟州地区]/g, "").trim().toLowerCase();
      const dynamicSlug = cleanDistrict ? `${cleanCity ? cleanCity.slice(0, 4) + "_" : ""}${cleanDistrict}` : "region_new";
      return {
        ...prev,
        district,
        id: prev.id.startsWith("region") || prev.id.startsWith("gz_") || prev.id.startsWith("fs_") || !prev.id ? dynamicSlug : prev.id,
      };
    });
  };

  // AI 智能抓取政务区划
  const handleRunAiScout = async () => {
    if (!scoutForm.city.trim() || !scoutForm.district.trim()) {
      toast.error("请完整填写城市与区县名称");
      return;
    }

    try {
      setScoutLoading(true);
      const res = await fetch("/api/admin/regions/ai-scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          province: scoutForm.province.trim(),
          city: scoutForm.city.trim(),
          district: scoutForm.district.trim(),
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(resolveApiError(data, "AI 提取政务区划失败"));
      }

      setScoutResult(data.data);
      setScoutStep(2);
      toast.success(
        `AI 成功梳理出 ${data.data.townships.length} 个法定镇街与 ${data.data.departments?.length || 0} 个协同职能部门！`
      );
    } catch (err: any) {
      toast.error(err.message || "AI 提取失败，请检查网络或重试");
    } finally {
      setScoutLoading(false);
    }
  };

  // 保存新建地区并一键写入 Schema 和字典
  const handleCreateRegionConfirm = async () => {
    if (!scoutForm.id.trim() || !scoutResult) {
      toast.error("数据不完整");
      return;
    }

    try {
      setSavingNewRegion(true);

      // 1. 创建物理 Schema 与注册地区
      const res1 = await fetch("/api/admin/regions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: scoutForm.id.trim(),
          name: scoutForm.district.trim(),
          city: scoutForm.city.trim(),
          province: scoutForm.province.trim(),
          isDefault: scoutForm.isDefault,
        }),
      });
      const data1 = await res1.json();
      if (!data1.success) {
        throw new Error(resolveApiError(data1, "创建地区 Schema 失败"));
      }

      // 2. 批量写入该 Schema 的字典与别名
      const res2 = await fetch(`/api/admin/regions/${scoutForm.id.trim()}/seed-vocab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          townships: scoutResult.townships,
          departments: scoutResult.departments,
          categories: scoutResult.categories,
        }),
      });
      const data2 = await res2.json();
      if (!data2.success) {
        throw new Error(resolveApiError(data2, "字典同步失败"));
      }

      toast.success(`🎉 站点【${scoutForm.city} · ${scoutForm.district}】纳管初始化完毕！`);
      setShowScoutModal(false);
      setScoutStep(1);
      setScoutResult(null);

      await fetchRegions();

      // 自动切换至新创建的站点
      switchRegion(scoutForm.id.trim());
    } catch (err: any) {
      toast.error(err.message || "创建失败");
    } finally {
      setSavingNewRegion(false);
    }
  };

  // 设为默认站点
  const handleSetDefault = async (region: RegionWithStats) => {
    try {
      const res = await fetch(`/api/admin/regions/${region.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`已将【${region.name}】设为全局默认站点`);
        fetchRegions();
      } else {
        toast.error(resolveApiError(data, "设置失败"));
      }
    } catch (e: any) {
      toast.error("操作异常");
    }
  };

  // 释放/删除站点物理 Schema
  const handleDeleteConfirm = async () => {
    if (!deletingRegion) return;
    try {
      setDeletePending(true);
      const res = await fetch(`/api/admin/regions/${deletingRegion.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`已成功销毁站点【${deletingRegion.name}】及其物理 Schema`);
        setDeletingRegion(null);
        fetchRegions();
      } else {
        toast.error(resolveApiError(data, "删除失败"));
      }
    } catch (e: any) {
      toast.error("删除异常");
    } finally {
      setDeletePending(false);
    }
  };

  // SVG 地图上传处理
  const handleMapFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".svg")) {
      toast.error("请选择 .svg 格式的矢量地图文件");
      return;
    }
    setUploadFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreviewSvg(ev.target?.result as string);
    };
    reader.readAsText(file);
  };

  const handleUploadMapSubmit = async () => {
    if (!uploadModalRegion || !uploadFile) {
      toast.error("请先选择 SVG 文件");
      return;
    }

    try {
      setUploading(true);
      const fd = new FormData();
      fd.append("file", uploadFile);

      const res = await fetch(`/api/admin/regions/${uploadModalRegion.id}/upload-map`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`SVG 行政地图已成功绑定至【${uploadModalRegion.name}】`);
        setUploadModalRegion(null);
        setUploadFile(null);
        setPreviewSvg(null);
        fetchRegions();
      } else {
        toast.error(resolveApiError(data, "地图上传失败"));
      }
    } catch (e: any) {
      toast.error("上传异常");
    } finally {
      setUploading(false);
    }
  };

  // 官方高精区县边界在线拉取与持久化存库
  const [fetchingBoundaryId, setFetchingBoundaryId] = useState<string | null>(null);

  const handleFetchBoundary = async (region: RegionWithStats) => {
    setFetchingBoundaryId(region.id);
    try {
      const res = await fetch(`/api/admin/regions/${region.id}/fetch-boundary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || `已为【${region.name}】成功拉取并持久化官方高精行政边界`);
        fetchRegions();
      } else {
        toast.error(resolveApiError(data, "拉取官方边界失败"));
      }
    } catch (e: any) {
      toast.error("网络请求异常");
    } finally {
      setFetchingBoundaryId(null);
    }
  };

  // 计算多租户汇总指标
  const totalTickets = regions.reduce((acc, r) => acc + (r.ticketCount || 0), 0);
  const totalThemes = regions.reduce((acc, r) => acc + (r.themeCount || 0), 0);
  const totalVocab = regions.reduce((acc, r) => acc + (r.vocabCount || 0), 0);

  return (
    <>
      {/* 头部导航与操作栏 */}
      <div className="page-hero">
        <div>
          <div className="page-hero__title flex items-center gap-2">
            <span>12345 站点纳管与多租户控制台</span>
            <span className="rounded-full bg-blue-50 border border-blue-200/80 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
              SuperAdmin 物理 Schema 隔离
            </span>
          </div>
          <div className="page-hero__desc">
            支持全国省市县区 12345 站点动态纳管 · PostgreSQL Schema 物理隔离 · SuperAgent AI 智能梳理镇街字典 · 矢量行政地图绑定
          </div>
        </div>
        <PageHeaderActions
          onRefresh={fetchRegions}
          refreshing={loading}
        >
          <button
            type="button"
            className="btn btn--primary h-[34px] px-3.5 text-xs font-medium inline-flex items-center gap-1.5"
            onClick={() => {
              setScoutStep(1);
              setShowScoutModal(true);
            }}
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-300 shrink-0" />
            <span>AI 智能新建 12345 站点</span>
          </button>
        </PageHeaderActions>
      </div>

      {/* 统一指标卡片体系 */}
      <StatCardGrid columns={4}>
        <StatCard
          icon={Building2}
          tone="blue"
          label="已纳管 12345 站点"
          value={regions.length}
          sub="支持跨省市区县无上限扩展"
        />
        <StatCard
          icon={Database}
          tone="green"
          label="物理隔离 Schema"
          value={regions.length}
          sub="PostgreSQL 原生租户隔离"
        />
        <StatCard
          icon={MapPin}
          tone="purple"
          label="当前活动工作区"
          value={activeRegion ? `${activeRegion.city} · ${activeRegion.name}` : "--"}
          sub={`物理空间: ${activeRegion?.schemaName || "未选择"}`}
        />
        <StatCard
          icon={Layers}
          tone="orange"
          label="全平台研判总量"
          value={totalTickets}
          sub={`${totalThemes} 个治理主题 / ${totalVocab} 条词典`}
        />
      </StatCardGrid>

      <div className="mt-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-bold text-slate-900">已接入的 Agent</h2>
            <span className="text-xs text-slate-500 font-mono">({mcpClients.length})</span>
          </div>
          <span className="text-xs text-slate-400">
            MCP 地址 /api/mcp · 已登录后打开 /mcp/authorize 签发 access key
          </span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/90 divide-y divide-slate-100">
          {mcpClients.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">还没有接入的 Agent。</div>
          ) : (
            mcpClients.map((client) => (
              <div key={client.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{client.name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {client.userName || client.username || client.userId}
                    {client.userEmail ? ` · ${client.userEmail}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn h-[30px] px-3 text-xs font-medium text-rose-700 border border-rose-200 bg-rose-50"
                  onClick={() => revokeClient(client.id)}
                  disabled={revokingClientId === client.id}
                >
                  {revokingClientId === client.id ? "正在吊销" : "吊销"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 站点卡片矩阵 */}
      <div className="mt-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">纳管地区站点清单</h2>
            <span className="text-xs text-slate-500 font-mono">
              ({regions.length} 个独立 PostgreSQL Schema)
            </span>
          </div>
          <span className="text-xs text-slate-400">
            各站点具有独立的工单库、多频聚类库、网格字典与权限配置
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {regions.map((r) => {
            const isActive = activeRegion?.id === r.id;
            return (
              <div
                key={r.id}
                className={`bg-white rounded-xl border p-5 transition-all shadow-2xs relative flex flex-col justify-between ${
                  isActive
                    ? "border-blue-500 ring-2 ring-blue-500/10"
                    : "border-slate-200/90 hover:border-slate-300"
                }`}
              >
                <div>
                  {/* 卡片头部 */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm ${
                          isActive
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {r.name.slice(0, 2)}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-bold text-slate-900">
                            {r.city} · {r.name}
                          </h3>
                          {r.isDefault && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 border border-amber-200/80 px-1.5 py-0.2 text-[10px] font-medium text-amber-700">
                              <Star className="h-2.5 w-2.5 fill-amber-500" />
                              默认
                            </span>
                          )}
                          {isActive && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 border border-emerald-200/80 px-2 py-0.2 text-[10px] font-medium text-emerald-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              当前工作区
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          Schema: {r.schemaName}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {!r.isDefault && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(r)}
                          className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors"
                          title="设为系统默认站点"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeletingRegion(r)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                        title="释放站点物理 Schema"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 数据统计网格 */}
                  <div className="grid grid-cols-3 gap-2 py-3 px-3 my-3 rounded-lg bg-slate-50/80 border border-slate-100 text-center">
                    <div>
                      <div className="text-[10px] text-slate-500">已汇聚工单</div>
                      <div className="text-sm font-bold text-slate-800 font-mono">
                        {r.ticketCount.toLocaleString()}
                      </div>
                    </div>
                    <div className="border-x border-slate-200/60">
                      <div className="text-[10px] text-slate-500">多频主题</div>
                      <div className="text-sm font-bold text-blue-600 font-mono">
                        {r.themeCount.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500">标准字典词汇</div>
                      <div className="text-sm font-bold text-slate-800 font-mono">
                        {r.vocabCount.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* 状态指示器 */}
                  <div className="flex items-center justify-between text-xs py-1 text-slate-500 mb-4">
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                      PostgreSQL 物理隔离
                    </span>
                    <span className="flex items-center gap-1">
                      <Map className="h-3.5 w-3.5 text-blue-600" />
                      <span className="text-emerald-600 font-medium">天地图 GIS 行政区划</span>
                    </span>
                  </div>
                </div>

                {/* 底部操作按钮 */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleFetchBoundary(r)}
                      disabled={fetchingBoundaryId === r.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100/80 rounded-md transition-colors border border-blue-200/60"
                      title="从官方权威测绘源在线拉取区县级高精边界并存放在站点中"
                    >
                      {fetchingBoundaryId === r.id ? (
                        <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                      ) : (
                        <Compass className="h-3 w-3 text-blue-600" />
                      )}
                      <span>{fetchingBoundaryId === r.id ? "拉取中…" : "高精边界"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadModalRegion(r)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200/80 rounded-md transition-colors"
                      title="上传或更换该区域的矢量地图"
                    >
                      <Upload className="h-3 w-3" />
                      地图
                    </button>
                    <Link
                      href="/dict"
                      onClick={() => {
                        if (!isActive) switchRegion(r.id);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200/80 rounded-md transition-colors"
                      title="查看并维护该站点的标准字典"
                    >
                      <BookOpen className="h-3 w-3" />
                      字典
                    </Link>
                  </div>

                  {isActive ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 px-3 py-1 bg-emerald-50 rounded-md">
                      <Check className="h-3.5 w-3.5" />
                      已激活
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => switchRegion(r.id)}
                      className="btn btn--primary text-xs py-1 px-3 h-7"
                    >
                      进入工作区
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Scout 智能建站向导 Modal */}
      {showScoutModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150 flex flex-col max-h-[90vh]">
            {/* Modal 头部 */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-50/50 to-indigo-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    SuperAgent AI 智能新建 12345 站点向导
                  </h3>
                  <p className="text-xs text-slate-500">
                    输入任意省市与区县，大模型自动联网梳理法定辖区镇街、权责清单并初始化专属 Schema
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowScoutModal(false);
                  setScoutStep(1);
                  setScoutResult(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                ✕
              </button>
            </div>

            {/* 步骤条 */}
            <div className="px-6 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between text-xs font-medium">
              <div className="flex items-center gap-6">
                <div className={`flex items-center gap-1.5 ${scoutStep === 1 ? "text-blue-600 font-bold" : "text-slate-500"}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${scoutStep === 1 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-700"}`}>
                    1
                  </span>
                  目标行政区划与标识
                </div>
                <span className="text-slate-300">➔</span>
                <div className={`flex items-center gap-1.5 ${scoutStep === 2 ? "text-blue-600 font-bold" : "text-slate-400"}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${scoutStep === 2 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}>
                    2
                  </span>
                  AI 提取字典底座核验与创建
                </div>
              </div>
            </div>

            {/* Modal 内容区 */}
            <div className="p-6 overflow-y-auto flex-1">
              {scoutStep === 1 && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                    <div>
                      <label className="text-xs font-semibold text-slate-700 mb-1 block">
                        所属省份 / 直辖市 <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={scoutForm.province}
                        onChange={(e) => setScoutForm({ ...scoutForm, province: e.target.value })}
                        placeholder="例如：广东省、浙江省"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 mb-1 block">
                        所属地级市 <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={scoutForm.city}
                        onChange={(e) => setScoutForm({ ...scoutForm, city: e.target.value })}
                        placeholder="例如：广州市、深圳市、佛山市"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-700 mb-1 block">
                        管辖区县 / 县级市 <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={scoutForm.district}
                        onChange={(e) => handleDistrictChange(e.target.value)}
                        placeholder="例如：天河区、海珠区、南山区"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2">
                    <div>
                      <label className="text-xs font-semibold text-slate-700 mb-1 block">
                        站点英文唯一标识 (Schema ID) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={scoutForm.id}
                        onChange={(e) => setScoutForm({ ...scoutForm, id: e.target.value })}
                        placeholder="如: gz_tianhe, sz_nanshan"
                        className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-mono text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                      />
                      <span className="text-[11px] text-slate-400 mt-1 block">
                        将在 PostgreSQL 自动创建独立 Schema：<code className="text-blue-600 font-mono">region_{scoutForm.id}</code>
                      </span>
                    </div>

                    <div className="flex items-center pt-5">
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={scoutForm.isDefault}
                          onChange={(e) => setScoutForm({ ...scoutForm, isDefault: e.target.checked })}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                        />
                        设为平台默认站点 (新访客首选展示)
                      </label>
                    </div>
                  </div>

                  {/* 推荐热门区县快捷填充 */}
                  <div className="pt-2">
                    <span className="text-[11px] text-slate-400 block mb-1.5">快捷示范填入：</span>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { city: "广州市", district: "天河区", id: "gz_tianhe" },
                        { city: "广州市", district: "越秀区", id: "gz_yuexiu" },
                        { city: "广州市", district: "黄埔区", id: "gz_huangpu" },
                        { city: "深圳市", district: "南山区", id: "sz_nanshan" },
                        { city: "佛山市", district: "南海区", id: "fs_nanhai" },
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setScoutForm({
                              ...scoutForm,
                              city: item.city,
                              district: item.district,
                              id: item.id,
                            });
                          }}
                          className="px-2.5 py-1 text-[11px] rounded bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600 border border-slate-200/80 transition-colors"
                        >
                          {item.city} {item.district}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* AI 运行中状态 */}
                  {scoutLoading && (
                    <div className="p-8 rounded-xl bg-blue-50/60 border border-blue-100 flex flex-col items-center justify-center text-center">
                      <Loader2 className="h-8 w-8 text-blue-600 animate-spin mb-3" />
                      <div className="text-sm font-bold text-slate-800 mb-1">
                        SuperAgent 正在智能梳理【{scoutForm.province} {scoutForm.city} {scoutForm.district}】...
                      </div>
                      <div className="text-xs text-slate-500 max-w-md">
                        正在调用国家行政区划民政数据库与 12345 运行标准，全量梳理辖区所有街道/镇街全称、社区居委会、知名地标商圈及职能承办科室权责清单...
                      </div>
                    </div>
                  )}
                </div>
              )}

              {scoutStep === 2 && scoutResult && (
                <div className="space-y-4">
                  {/* 概览条 */}
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200/80 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span className="text-xs font-semibold text-emerald-900">
                        AI 智能梳理完成：包含 {scoutResult.townships.length} 个法定镇街、
                        {scoutResult.departments.length} 个协同部门及 {scoutResult.categories.length} 大民生分类
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setScoutStep(1)}
                      className="text-xs text-emerald-700 hover:underline"
                    >
                      重新调整区划
                    </button>
                  </div>

                  {/* 预览 Tab */}
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                    <button
                      type="button"
                      onClick={() => setScoutActiveTab("townships")}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        scoutActiveTab === "townships"
                          ? "bg-blue-600 text-white"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      法定镇街区划 ({scoutResult.townships.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setScoutActiveTab("departments")}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        scoutActiveTab === "departments"
                          ? "bg-blue-600 text-white"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      协同承办部门 ({scoutResult.departments.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setScoutActiveTab("categories")}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        scoutActiveTab === "categories"
                          ? "bg-blue-600 text-white"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      民生分类与科室 ({scoutResult.categories.length})
                    </button>
                  </div>

                  {/* Tab 内容 1: 镇街 */}
                  {scoutActiveTab === "townships" && (
                    <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
                      {scoutResult.townships.map((t, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg border border-slate-200/80 bg-slate-50/50 hover:bg-white transition-all text-xs"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-xs">{t.fullName}</span>
                              <span className="text-slate-400 font-mono text-[11px]">简称: {t.name}</span>
                            </div>
                            <span className="text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200/60 font-medium">
                              {t.communities?.length || 0} 个重点社区
                            </span>
                          </div>
                          {t.aliases && t.aliases.length > 0 && (
                            <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1 flex-wrap">
                              <span className="text-slate-400">别称/俗称:</span>
                              {t.aliases.map((a, i) => (
                                <span key={i} className="bg-amber-50 text-amber-800 border border-amber-200/60 px-1.5 py-0.2 rounded font-mono text-[10px]">
                                  {a}
                                </span>
                              ))}
                            </div>
                          )}
                          {t.landmarks && t.landmarks.length > 0 && (
                            <div className="text-[11px] text-slate-500 flex items-center gap-1 flex-wrap">
                              <span className="text-slate-400">核心地标:</span>
                              {t.landmarks.map((lm, i) => (
                                <span key={i} className="bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded text-[10px]">
                                  📍 {lm}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tab 内容 2: 部门 */}
                  {scoutActiveTab === "departments" && (
                    <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
                      {scoutResult.departments.map((d, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg border border-slate-200/80 bg-slate-50/50 hover:bg-white transition-all text-xs flex items-center justify-between"
                        >
                          <div>
                            <div className="font-bold text-slate-800">{d.fullName}</div>
                            <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                              简称: {d.name} · 代号: {d.code}
                            </div>
                          </div>
                          <span className="rounded bg-purple-50 text-purple-700 border border-purple-200/80 px-2 py-0.5 text-[10px] font-medium">
                            {d.category}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tab 内容 3: 诉求分类 */}
                  {scoutActiveTab === "categories" && (
                    <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
                      {scoutResult.categories.map((c, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg border border-slate-200/80 bg-slate-50/50 hover:bg-white transition-all text-xs"
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="font-bold text-slate-900">{c.category}</span>
                            <span className="text-[11px] text-slate-500 font-medium">
                              牵头科室: {c.leadDepartment}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {c.subItems.map((sub, i) => (
                              <span
                                key={i}
                                className="bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.2 rounded text-[10px]"
                              >
                                {sub}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal 底部操作栏 */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/60">
              <button
                type="button"
                className="btn btn--default"
                onClick={() => {
                  setShowScoutModal(false);
                  setScoutStep(1);
                  setScoutResult(null);
                }}
                disabled={scoutLoading || savingNewRegion}
              >
                取消
              </button>

              {scoutStep === 1 ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleRunAiScout}
                  disabled={scoutLoading}
                >
                  {scoutLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      AI 智能梳理中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-1.5 text-amber-300" />
                      开始 AI 梳理区划与权责
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleCreateRegionConfirm}
                  disabled={savingNewRegion}
                >
                  {savingNewRegion ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      正在创建 Schema 并初始化字典...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-1.5" />
                      确认并一键初始化专属 12345 站点
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SVG 矢量地图上传弹窗 */}
      {uploadModalRegion && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in duration-150">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              上传【{uploadModalRegion.name}】矢量行政地图 (SVG)
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              请上传标准 SVG 矢量行政区划地图，支持镇街高亮与交互透势呈现
            </p>

            <div className="space-y-4">
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-blue-500 transition-colors">
                <input
                  type="file"
                  accept=".svg"
                  id="svg-upload-input"
                  className="hidden"
                  onChange={handleMapFileChange}
                />
                <label htmlFor="svg-upload-input" className="cursor-pointer flex flex-col items-center">
                  <Upload className="h-8 w-8 text-blue-600 mb-2" />
                  <span className="text-xs font-semibold text-slate-700">
                    {uploadFile ? uploadFile.name : "点击选择或拖拽 SVG 地图文件"}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1">仅支持 .svg 格式</span>
                </label>
              </div>

              {previewSvg && (
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-[11px] font-semibold text-slate-600 mb-2">SVG 预览：</div>
                  <div
                    className="max-h-48 overflow-hidden flex items-center justify-center [&>svg]:max-h-48 [&>svg]:w-auto"
                    dangerouslySetInnerHTML={{ __html: previewSvg }}
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  className="btn btn--default"
                  onClick={() => {
                    setUploadModalRegion(null);
                    setUploadFile(null);
                    setPreviewSvg(null);
                  }}
                  disabled={uploading}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleUploadMapSubmit}
                  disabled={!uploadFile || uploading}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      上传中...
                    </>
                  ) : (
                    "确认上传并绑定"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 删除站点确认弹窗 */}
      <ConfirmDialog
        open={deletingRegion != null}
        title="销毁 12345 站点及物理 Schema"
        description={
          deletingRegion ? (
            <>
              确定释放并彻底删除【<b className="text-slate-900">{deletingRegion.name}</b>】站点吗？
              <br />
              <span className="text-rose-600 font-semibold block mt-1">
                ⚠️ 该操作将直接 DROP SCHEMA &quot;{deletingRegion.schemaName}&quot; CASCADE，清空该站点下所有工单与主题数据！
              </span>
            </>
          ) : null
        }
        confirmLabel="确认销毁"
        destructive
        pending={deletePending}
        onConfirm={handleDeleteConfirm}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeletingRegion(null);
        }}
      />
    </>
  );
}
