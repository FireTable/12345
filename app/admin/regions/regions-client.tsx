"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { fmtNum } from "@/lib/format-number";
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
  ShieldAlert,
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
import { SkBone, SkCard, SkStatCards } from "@/app/_components/civic/skeletons";
import { useRegion, RegionInfo } from "@/app/_components/civic/region-context";
import { useAuthRole } from "@/lib/auth/use-role";
import { ConfirmDialog } from "@/app/_components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/_components/ui/dialog";
import { PageHeaderActions } from "@/app/_components/civic/page-header-actions";
import { ComputeNodesPanel } from "@/app/_components/civic/compute-nodes-panel";
import { toast } from "sonner";
import { resolveApiError } from "@/lib/api-codes";

interface RegionWithStats extends RegionInfo {
  ticketCount: number;
  themeCount: number;
  vocabCount: number;
  categoryConfigJson?: string | null;
  status?: string;
  createdAt?: string;
}

function resolveIsEcommerce(
  region: RegionWithStats,
  contextRegions: RegionInfo[]
): boolean {
  if (region.domainProfile?.domainType === "ECOMMERCE_CS") return true;
  const ctx = contextRegions.find((c) => c.id === region.id);
  if (ctx?.domainProfile?.domainType === "ECOMMERCE_CS") return true;
  if (region.categoryConfigJson) {
    try {
      const parsed = JSON.parse(region.categoryConfigJson);
      const dt = parsed?.domainProfile?.domainType || parsed?.domainType;
      if (dt === "ECOMMERCE_CS") return true;
    } catch {
      // ignore malformed json
    }
  }
  return false;
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
  const { isAdmin, isPending: isRolePending } = useAuthRole();
  const { appDomain, activeRegion, regions: contextRegions, switchRegion } = useRegion();
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
  const [svgDragOver, setSvgDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewSvgUrl, setPreviewSvgUrl] = useState<string | null>(null);
  const regionsControllerRef = useRef<AbortController | null>(null);
  const mcpControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (previewSvgUrl) {
        URL.revokeObjectURL(previewSvgUrl);
      }
    };
  }, [previewSvgUrl]);

  useEffect(() => {
    return () => {
      regionsControllerRef.current?.abort();
      mcpControllerRef.current?.abort();
    };
  }, []);

  // 删除站点确认弹窗
  const [deletingRegion, setDeletingRegion] = useState<RegionWithStats | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  // 算力集群概览计数
  const [computeSummary, setComputeSummary] = useState<{
    envCount: number;
    dynamicCount: number;
    onlineCount: number;
  } | null>(null);

  const fetchRegions = async () => {
    regionsControllerRef.current?.abort();
    const controller = new AbortController();
    regionsControllerRef.current = controller;
    try {
      setLoading(true);
      const res = await fetch("/api/admin/regions", { signal: controller.signal });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(raw?.error || `HTTP ${res.status}`);
      }
      if (controller.signal.aborted) return;
      const list = raw?.data?.regions || raw?.regions;
      if (Array.isArray(list)) {
        setRegions(list);
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) return;
      toast.error("获取地区站点列表失败");
    } finally {
      if (regionsControllerRef.current === controller) {
        setLoading(false);
      }
    }
  };

  const fetchMcpClients = async () => {
    mcpControllerRef.current?.abort();
    const controller = new AbortController();
    mcpControllerRef.current = controller;
    try {
      const res = await fetch("/api/admin/mcp-clients", { signal: controller.signal });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(raw?.error || `HTTP ${res.status}`);
      }
      if (controller.signal.aborted) return;
      const list = raw?.data?.clients;
      setMcpClients(Array.isArray(list) ? list : []);
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) return;
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
    if (isRolePending || !isAdmin) return;
    fetchRegions();
    fetchMcpClients();
  }, [isRolePending, isAdmin]);

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
        `AI 成功梳理出 ${fmtNum(data.data.townships.length)} 个法定镇街与 ${fmtNum(data.data.departments?.length || 0)} 个协同职能部门！`
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
  const applySelectedSvgFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".svg")) {
      toast.error("请选择 .svg 格式的矢量地图文件");
      return;
    }
    setUploadFile(file);
    const nextUrl = URL.createObjectURL(new Blob([file], { type: "image/svg+xml" }));
    setPreviewSvgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return nextUrl;
    });
  };

  const handleMapFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    applySelectedSvgFile(e.target.files?.[0]);
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
        setPreviewSvgUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
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

  // 拆分政务 12345 站点与跨行业示范站点（电商客诉不混入政务 12345 站点数与研判总量）
  const govRegions = regions.filter((r) => !resolveIsEcommerce(r, contextRegions));
  const ecomRegions = regions.filter((r) => resolveIsEcommerce(r, contextRegions));
  const isEcommerceOnly =
    appDomain === "ECOMMERCE_CS" ||
    (regions.length > 0 && govRegions.length === 0 && ecomRegions.length > 0);

  const govTickets = govRegions.reduce((acc, r) => acc + (r.ticketCount || 0), 0);
  const govThemes = govRegions.reduce((acc, r) => acc + (r.themeCount || 0), 0);
  const govVocab = govRegions.reduce((acc, r) => acc + (r.vocabCount || 0), 0);

  const ecomTickets = ecomRegions.reduce((acc, r) => acc + (r.ticketCount || 0), 0);
  const ecomThemes = ecomRegions.reduce((acc, r) => acc + (r.themeCount || 0), 0);
  const ecomVocab = ecomRegions.reduce((acc, r) => acc + (r.vocabCount || 0), 0);

  const renderRegionCard = (r: RegionWithStats, isEcom: boolean) => {
    const isActive = activeRegion?.id === r.id;
    return (
      <div
        key={r.id}
        className={`bg-white rounded-xl border p-4 sm:p-5 transition-[border-color,box-shadow] shadow-2xs relative flex flex-col justify-between min-w-0 ${
          isActive
            ? isEcom
              ? "border-amber-500 ring-2 ring-amber-500/15"
              : "border-blue-500 ring-2 ring-blue-500/10"
            : "border-slate-200/90 hover:border-slate-300"
        }`}
      >
        <div className="min-w-0">
          {/* 卡片头部 */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${
                  isActive
                    ? isEcom
                      ? "bg-amber-600 text-white"
                      : "bg-blue-600 text-white"
                    : isEcom
                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : "bg-slate-100 text-slate-700"
                }`}
              >
                {r.name.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-900 break-words">
                    {r.city} · {r.name}
                  </h3>
                  {(isEcom || r.isDefault || isActive) && (
                    <span className="text-xs font-medium text-slate-600 inline-flex items-center gap-1.5 flex-wrap">
                      {isEcom && <span className="text-amber-700">电商客诉</span>}
                      {r.isDefault && (
                        <span className="inline-flex items-center gap-0.5 text-amber-700">
                          {isEcom ? "· " : ""}
                          <Star className="h-3 w-3 fill-amber-500 shrink-0" aria-hidden="true" />
                          默认
                        </span>
                      )}
                      {isActive && (
                        <span className="inline-flex items-center gap-0.5 text-emerald-700">
                          {isEcom || r.isDefault ? "· " : ""}
                          <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" aria-hidden="true" />
                          当前工作区
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5 truncate">
                  Schema: {r.schemaName}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {!r.isDefault && (
                <button
                  type="button"
                  onClick={() => handleSetDefault(r)}
                  aria-label={`将 ${r.name} 设为系统默认站点`}
                  className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] p-1.5 inline-flex items-center justify-center text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors cursor-pointer"
                  title="设为系统默认站点"
                >
                  <Star className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setDeletingRegion(r)}
                aria-label={`释放 ${r.name} 物理 Schema`}
                className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] p-1.5 inline-flex items-center justify-center text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                title="释放站点物理 Schema"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* 数据统计网格 */}
          <div className="grid grid-cols-3 divide-x divide-slate-200/70 py-3 px-2 sm:px-3 my-3 rounded-lg bg-slate-50/90 text-center">
            <div className="min-w-0 px-1">
              <div className="text-[11px] text-slate-500 truncate">
                {isEcom ? "已汇聚客诉" : "已汇聚工单"}
              </div>
              <div className="text-sm font-bold text-slate-800 font-mono tabular-nums">
                {r.ticketCount.toLocaleString()}
              </div>
            </div>
            <div className="min-w-0 px-1">
              <div className="text-[11px] text-slate-500 truncate">
                {isEcom ? "多频案卷" : "多频主题"}
              </div>
              <div className="text-sm font-bold text-blue-600 font-mono tabular-nums">
                {r.themeCount.toLocaleString()}
              </div>
            </div>
            <div className="min-w-0 px-1">
              <div className="text-[11px] text-slate-500 truncate">
                {isEcom ? "行业词典" : "标准字典词汇"}
              </div>
              <div className="text-sm font-bold text-slate-800 font-mono tabular-nums">
                {r.vocabCount.toLocaleString()}
              </div>
            </div>
          </div>

          {/* 状态指示器 */}
          <div className="flex items-center justify-between gap-2 flex-wrap text-xs py-1 text-slate-500 mb-4">
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
              PostgreSQL 物理隔离
            </span>
            {isEcom ? (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Layers className="h-3.5 w-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                <span className="text-amber-700 font-medium">行业场景包 · 渠道/仓网矩阵</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Map className="h-3.5 w-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                <span className="text-emerald-600 font-medium">天地图 GIS 行政区划</span>
              </span>
            )}
          </div>
        </div>

        {/* 底部操作按钮 */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {!isEcom && (
              <>
                <button
                  type="button"
                  onClick={() => handleFetchBoundary(r)}
                  disabled={fetchingBoundaryId === r.id}
                  className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[36px] px-2.5 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100/80 rounded-md transition-colors border border-blue-200/60 whitespace-nowrap cursor-pointer"
                  title="从官方权威测绘源在线拉取区县级高精边界并存放在站点中"
                >
                  {fetchingBoundaryId === r.id ? (
                    <Loader2 className="h-3 w-3 motion-safe:animate-spin text-blue-600 shrink-0" aria-hidden="true" />
                  ) : (
                    <Compass className="h-3 w-3 text-blue-600 shrink-0" aria-hidden="true" />
                  )}
                  <span>{fetchingBoundaryId === r.id ? "拉取中…" : "高精边界"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setUploadModalRegion(r)}
                  className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[36px] px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200/80 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                  title="上传或更换该区域的矢量地图"
                >
                  <Upload className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>地图</span>
                </button>
              </>
            )}
            <Link
              href="/dict"
              onClick={() => {
                if (!isActive) switchRegion(r.id);
              }}
              className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[36px] px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200/80 rounded-md transition-colors whitespace-nowrap"
              title={isEcom ? "查看并维护该行业场景的标准字典" : "查看并维护该站点的标准字典"}
            >
              <BookOpen className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{isEcom ? "行业词典" : "字典"}</span>
            </Link>
          </div>

          {isActive ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 px-3 py-1 bg-emerald-50 rounded-md whitespace-nowrap">
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              已激活
            </span>
          ) : (
            <button
              type="button"
              onClick={() => switchRegion(r.id)}
              className="btn btn--primary text-xs py-1 px-3 min-h-[44px] sm:min-h-[36px] whitespace-nowrap"
            >
              进入工作区
            </button>
          )}
        </div>
      </div>
    );
  };

  if (isRolePending) {
    return (
      <div className="sk-page space-y-4" aria-busy="true" aria-label="校验管理员权限">
        <div className="page-hero">
          <div className="space-y-2 flex-1">
            <SkBone w="260px" h={24} />
            <SkBone w="380px" h={14} />
          </div>
          <div className="flex items-center gap-2">
            <SkBone w={120} h={34} />
          </div>
        </div>
        <SkStatCards />
        <SkCard height={220}>
          <div className="space-y-3">
            <SkBone w="60%" h={16} />
            <SkBone w="85%" h={14} />
          </div>
        </SkCard>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto py-8 sm:py-14">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 sm:p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-slate-900">
              仅限管理员操作 · 多租户与算力控制台受限
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
              当前账号不具备管理员权限。站点纳管、物理 Schema 配置、算力节点与接入 Agent 管理仅对管理员开放。
            </p>
          </div>
          <div className="pt-2 flex items-center justify-center gap-3 flex-wrap">
            <Link href="/submit" className="btn btn--primary min-h-[40px] text-xs px-4">
              <span>前往市民/买家投诉端 (/submit)</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 头部导航与操作栏 */}
      <div className="page-hero">
        <div className="min-w-0">
          <h1 className="page-hero__title">
            {isEcommerceOnly ? "电商客诉多租户与算力控制台" : "12345 站点纳管与多租户控制台"}
          </h1>
          <div className="page-hero__desc">
            {isEcommerceOnly
              ? "全渠道电商客诉租户纳管 · PostgreSQL Schema 物理隔离 · 渠道仓网词典与 Colab GPU 算力热插拔"
              : "支持全国省市县区 12345 站点动态纳管 · PostgreSQL Schema 物理隔离 · SuperAgent AI 智能梳理镇街字典 · Colab GPU 算力热插拔"}
            {computeSummary
              ? `（算力池：${fmtNum(computeSummary.envCount + computeSummary.dynamicCount)} 节点 / ${fmtNum(computeSummary.onlineCount)} 在线）`
              : ""}
          </div>
        </div>
        <PageHeaderActions
          onRefresh={fetchRegions}
          refreshing={loading}
          className="flex-wrap"
        >
          {!isEcommerceOnly && (
            <button
              type="button"
              className="btn btn--primary min-h-[44px] sm:min-h-[36px] px-3.5 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
              onClick={() => {
                setScoutStep(1);
                setShowScoutModal(true);
              }}
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-300 shrink-0" aria-hidden="true" />
              <span>AI 智能新建 12345 站点</span>
            </button>
          )}
        </PageHeaderActions>
      </div>

      {/* 统一指标卡片体系（政务 12345 口径与跨行业示范口径严格拆分） */}
      <StatCardGrid columns={4}>
        <StatCard
          icon={Building2}
          tone="blue"
          label={isEcommerceOnly ? "已纳管电商客诉站点" : "已纳管 12345 站点"}
          value={isEcommerceOnly ? ecomRegions.length : govRegions.length}
          sub={
            isEcommerceOnly
              ? "支持多品牌与全渠道租户隔离"
              : ecomRegions.length > 0
                ? `另含 ${fmtNum(ecomRegions.length)} 个跨行业示范站`
                : "支持跨省市区县无上限扩展"
          }
        />
        <StatCard
          icon={Database}
          tone="green"
          label="物理隔离 Schema"
          value={regions.length}
          sub={
            isEcommerceOnly
              ? "PostgreSQL 原生电商租户隔离"
              : ecomRegions.length > 0
                ? `政务 ${fmtNum(govRegions.length)} + 跨行业示范 ${fmtNum(ecomRegions.length)}`
                : "PostgreSQL 原生租户隔离"
          }
        />
        <StatCard
          icon={MapPin}
          tone="purple"
          label="当前活动工作区"
          value={activeRegion ? `${activeRegion.city} · ${activeRegion.name}` : "--"}
          valueClassName="text-base sm:text-[20px] truncate"
          sub={`物理空间: ${activeRegion?.schemaName || "未选择"}`}
        />
        <StatCard
          icon={Layers}
          tone="orange"
          label={isEcommerceOnly ? "电商客诉研判总量" : "政务 12345 研判总量"}
          value={isEcommerceOnly ? ecomTickets : govTickets}
          sub={
            isEcommerceOnly
              ? `${fmtNum(ecomThemes)} 个客诉案卷 / ${fmtNum(ecomVocab)} 条行业词典`
              : ecomTickets > 0
                ? `${fmtNum(govThemes)} 主题 · 示范站 ${fmtNum(ecomTickets)} 单`
                : `${fmtNum(govThemes)} 个治理主题 / ${fmtNum(govVocab)} 条词典`
          }
        />
      </StatCardGrid>

      {/* 算力集群与 Colab GPU 热插拔控制台 */}
      <ComputeNodesPanel onSummaryChange={setComputeSummary} />

      <div className="mt-6 mb-8">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-slate-500 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900">已接入的 Agent</h2>
            <span className="text-xs text-slate-500 font-mono tabular-nums">({fmtNum(mcpClients.length)})</span>
          </div>
          <span className="text-xs text-slate-500">
            MCP 地址 /api/mcp · 已登录后打开 /mcp/authorize 签发 access key
          </span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/90 divide-y divide-slate-100">
          {mcpClients.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">还没有接入的 Agent。</div>
          ) : (
            mcpClients.map((client) => (
              <div key={client.id} className="flex items-center justify-between gap-3 flex-wrap px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900 truncate">{client.name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {client.userName || client.username || client.userId}
                    {client.userEmail ? ` · ${client.userEmail}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn min-h-[44px] sm:min-h-[36px] px-3 text-xs font-medium text-rose-700 border border-rose-200 bg-rose-50 shrink-0"
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

      {/* 站点清单分区 1：政务 12345 辖区站点 */}
      {govRegions.length > 0 && (
        <div className="mt-6 mb-8">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-slate-900">政务 12345 辖区站点</h2>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                ({fmtNum(govRegions.length)} 个独立 PostgreSQL Schema)
              </span>
            </div>
            <span className="text-xs text-slate-500">
              各政务区县具有独立的工单库、多频聚类库、镇街网格字典与 GIS 地图配置
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {govRegions.map((r) => renderRegionCard(r, false))}
          </div>
        </div>
      )}

      {/* 站点清单分区 2：电商客诉租户站点 */}
      {ecomRegions.length > 0 && (
        <div className="mt-6 mb-8">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-slate-900">
                {govRegions.length > 0 ? "跨行业能力验证 · 电商客诉示范" : "电商客诉租户站点"}
              </h2>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                ({fmtNum(ecomRegions.length)} 个独立行业 Schema · DomainProfile 行业包)
              </span>
            </div>
            <span className="text-xs text-slate-500">
              {govRegions.length > 0
                ? "复用平台多租户 Schema、PII 脱敏、假闭环与多频聚类引擎，独立口径不计入政务 12345 总量"
                : "各电商客诉租户具有独立的工单库、多频案卷库与全渠道仓网词典"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ecomRegions.map((r) => renderRegionCard(r, true))}
          </div>
        </div>
      )}

      {/* AI Scout 智能建站向导 Modal */}
      <Dialog
        open={showScoutModal}
        onOpenChange={(open) => {
          if (!open && !scoutLoading && !savingNewRegion) {
            setShowScoutModal(false);
            setScoutStep(1);
            setScoutResult(null);
          }
        }}
      >
        <DialogContent
          closeLabel="关闭向导弹窗"
          closeDisabled={scoutLoading || savingNewRegion}
          onEscapeKeyDown={(e) => {
            if (scoutLoading || savingNewRegion) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (scoutLoading || savingNewRegion) e.preventDefault();
          }}
          className="!w-[calc(100vw-1.5rem)] !max-w-3xl !max-h-[90dvh] !p-0 !gap-0 rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden !flex !flex-col"
        >
          {/* Modal 头部 */}
          <div className="px-4 sm:px-6 py-4 pr-14 border-b border-slate-100 flex items-center justify-between gap-2 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0" aria-hidden="true">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-sm sm:text-base font-bold text-slate-900">
                  SuperAgent AI 智能新建 12345 站点向导
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  输入任意省市与区县，大模型自动联网梳理法定辖区镇街、权责清单并初始化专属 Schema
                </DialogDescription>
              </div>
            </div>
          </div>

          {/* 步骤条 */}
          <div className="px-4 sm:px-6 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between text-xs font-medium overflow-x-auto shrink-0">
            <div className="flex items-center gap-3 sm:gap-6 whitespace-nowrap">
              <div className={`flex items-center gap-1.5 ${scoutStep === 1 ? "text-blue-600 font-bold" : "text-slate-500"}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${scoutStep === 1 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-700"}`}>
                  1
                </span>
                目标行政区划与标识
              </div>
              <span className="text-slate-300" aria-hidden="true">➔</span>
              <div className={`flex items-center gap-1.5 ${scoutStep === 2 ? "text-blue-600 font-bold" : "text-slate-500"}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${scoutStep === 2 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"}`}>
                  2
                </span>
                AI 提取字典底座核验与创建
              </div>
            </div>
          </div>

          {/* Modal 内容区 */}
          <div className="p-4 sm:p-6 overflow-y-auto flex-1">
            {scoutStep === 1 && (
              <form
                id="scout-step1-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleRunAiScout();
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                  <div>
                    <label htmlFor="scout-province" className="text-xs font-semibold text-slate-700 mb-1 block">
                      所属省份 / 直辖市 <span className="text-rose-500" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="scout-province"
                      type="text"
                      required
                      value={scoutForm.province}
                      onChange={(e) => setScoutForm({ ...scoutForm, province: e.target.value })}
                      placeholder="例如：广东省、浙江省"
                      className="w-full min-h-[44px] sm:min-h-0 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="scout-city" className="text-xs font-semibold text-slate-700 mb-1 block">
                      所属地级市 <span className="text-rose-500" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="scout-city"
                      type="text"
                      required
                      value={scoutForm.city}
                      onChange={(e) => setScoutForm({ ...scoutForm, city: e.target.value })}
                      placeholder="例如：广州市、深圳市、佛山市"
                      className="w-full min-h-[44px] sm:min-h-0 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="scout-district" className="text-xs font-semibold text-slate-700 mb-1 block">
                      管辖区县 / 县级市 <span className="text-rose-500" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="scout-district"
                      type="text"
                      required
                      value={scoutForm.district}
                      onChange={(e) => handleDistrictChange(e.target.value)}
                      placeholder="例如：天河区、海珠区、南山区"
                      className="w-full min-h-[44px] sm:min-h-0 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2">
                  <div>
                    <label htmlFor="scout-schema-id" className="text-xs font-semibold text-slate-700 mb-1 block">
                      站点英文唯一标识 (Schema ID) <span className="text-rose-500" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="scout-schema-id"
                      type="text"
                      required
                      aria-describedby="scout-schema-hint"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={scoutForm.id}
                      onChange={(e) => setScoutForm({ ...scoutForm, id: e.target.value })}
                      placeholder="如: gz_tianhe, sz_nanshan"
                      className="w-full min-h-[44px] sm:min-h-0 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-mono text-slate-800 focus:border-blue-500 focus:bg-white focus:outline-none"
                    />
                    <span id="scout-schema-hint" className="text-[11px] text-slate-500 mt-1 block">
                      将在 PostgreSQL 自动创建独立 Schema：<code className="text-blue-600 font-mono">region_{scoutForm.id}</code>
                    </span>
                  </div>

                  <div className="flex items-center pt-2 md:pt-5">
                    <label className="flex items-center gap-2 min-h-[44px] sm:min-h-0 cursor-pointer text-xs font-medium text-slate-700">
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
                  <span className="text-[11px] text-slate-500 block mb-1.5">快捷示范填入：</span>
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
                        className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 text-xs rounded bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600 border border-slate-200/80 transition-colors cursor-pointer"
                      >
                        {item.city} {item.district}
                      </button>
                    ))}
                  </div>
                </div>

                {/* AI 运行中状态 */}
                {scoutLoading && (
                  <div className="p-8 rounded-xl bg-blue-50/60 border border-blue-100 flex flex-col items-center justify-center text-center">
                    <Loader2 className="h-8 w-8 text-blue-600 motion-safe:animate-spin mb-3" aria-hidden="true" />
                    <div className="text-sm font-bold text-slate-800 mb-1">
                      SuperAgent 正在智能梳理【{scoutForm.province} {scoutForm.city} {scoutForm.district}】...
                    </div>
                    <div className="text-xs text-slate-500 max-w-md">
                      正在调用国家行政区划民政数据库与 12345 运行标准，全量梳理辖区所有街道/镇街全称、社区居委会、知名地标商圈及职能承办科室权责清单...
                    </div>
                  </div>
                )}
              </form>
            )}

            {scoutStep === 2 && scoutResult && (
              <div className="space-y-4">
                {/* 概览条 */}
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200/80 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                    <span className="text-xs font-semibold text-emerald-900">
                      AI 智能梳理完成：包含 {fmtNum(scoutResult.townships.length)} 个法定镇街、
                      {fmtNum(scoutResult.departments.length)} 个协同部门及 {fmtNum(scoutResult.categories.length)} 大民生分类
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setScoutStep(1)}
                    className="min-h-[44px] sm:min-h-[36px] px-2.5 py-1 text-xs text-emerald-700 hover:underline cursor-pointer"
                  >
                    重新调整区划
                  </button>
                </div>

                {/* 预览 Tab */}
                <div
                  role="tablist"
                  aria-label="AI 梳理结果预览分类"
                  onKeyDown={(e) => {
                    const keys = ["townships", "departments", "categories"] as const;
                    const idx = keys.indexOf(scoutActiveTab);
                    let next: (typeof keys)[number] | null = null;
                    if (e.key === "ArrowRight") next = keys[(idx + 1) % keys.length];
                    else if (e.key === "ArrowLeft") next = keys[(idx - 1 + keys.length) % keys.length];
                    else if (e.key === "Home") next = keys[0];
                    else if (e.key === "End") next = keys[keys.length - 1];
                    if (next) {
                      e.preventDefault();
                      setScoutActiveTab(next);
                      window.requestAnimationFrame(() => {
                        document.getElementById(`scout-tab-${next}`)?.focus();
                      });
                    }
                  }}
                  className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto whitespace-nowrap"
                >
                  <button
                    type="button"
                    role="tab"
                    id="scout-tab-townships"
                    aria-controls="scout-panel-townships"
                    aria-selected={scoutActiveTab === "townships"}
                    tabIndex={scoutActiveTab === "townships" ? 0 : -1}
                    onClick={() => setScoutActiveTab("townships")}
                    className={`min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-md border-b-2 transition-colors shrink-0 cursor-pointer ${scoutActiveTab === "townships"
                      ? "bg-blue-600 text-white border-blue-900"
                      : "text-slate-600 hover:bg-slate-100 border-transparent"
                      }`}
                  >
                    法定镇街区划 ({fmtNum(scoutResult.townships.length)})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="scout-tab-departments"
                    aria-controls="scout-panel-departments"
                    aria-selected={scoutActiveTab === "departments"}
                    tabIndex={scoutActiveTab === "departments" ? 0 : -1}
                    onClick={() => setScoutActiveTab("departments")}
                    className={`min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-md border-b-2 transition-colors shrink-0 cursor-pointer ${scoutActiveTab === "departments"
                      ? "bg-blue-600 text-white border-blue-900"
                      : "text-slate-600 hover:bg-slate-100 border-transparent"
                      }`}
                  >
                    协同承办部门 ({fmtNum(scoutResult.departments.length)})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="scout-tab-categories"
                    aria-controls="scout-panel-categories"
                    aria-selected={scoutActiveTab === "categories"}
                    tabIndex={scoutActiveTab === "categories" ? 0 : -1}
                    onClick={() => setScoutActiveTab("categories")}
                    className={`min-h-[44px] sm:min-h-[36px] px-3 py-1.5 text-xs font-semibold rounded-md border-b-2 transition-colors shrink-0 cursor-pointer ${scoutActiveTab === "categories"
                      ? "bg-blue-600 text-white border-blue-900"
                      : "text-slate-600 hover:bg-slate-100 border-transparent"
                      }`}
                  >
                    民生分类与科室 ({fmtNum(scoutResult.categories.length)})
                  </button>
                </div>

                {/* Tab 内容 1: 镇街 */}
                {scoutActiveTab === "townships" && (
                  <div
                    role="tabpanel"
                    id="scout-panel-townships"
                    aria-labelledby="scout-tab-townships"
                    tabIndex={0}
                    className="max-h-[360px] overflow-y-auto space-y-2 pr-1"
                  >
                    {scoutResult.townships.map((t, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-slate-50/70 hover:bg-slate-50 transition-colors text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-xs">{t.fullName}</span>
                            <span className="text-slate-500 font-mono text-[11px]">简称: {t.name}</span>
                          </div>
                          <span className="text-xs text-blue-700 font-medium tabular-nums">
                            {fmtNum(t.communities?.length || 0)} 个重点社区
                          </span>
                        </div>
                        {t.aliases && t.aliases.length > 0 && (
                          <div className="text-[11px] text-slate-600 mb-1 flex items-center gap-1 flex-wrap">
                            <span className="text-slate-500">俗称 / 别名: </span>
                            {t.aliases.map((a, i) => (
                              <span key={i} className="bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded font-mono text-[11px]">
                                {a}
                              </span>
                            ))}
                          </div>
                        )}
                        {t.landmarks && t.landmarks.length > 0 && (
                          <div className="text-[11px] text-slate-600 flex items-center gap-1 flex-wrap">
                            <span className="text-slate-500">核心地标:</span>
                            {t.landmarks.map((lm, i) => (
                              <span key={i} className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[11px]">
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
                  <div
                    role="tabpanel"
                    id="scout-panel-departments"
                    aria-labelledby="scout-tab-departments"
                    tabIndex={0}
                    className="max-h-[360px] overflow-y-auto space-y-2 pr-1"
                  >
                    {scoutResult.departments.map((d, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-slate-50/70 hover:bg-slate-50 transition-colors text-xs flex items-center justify-between gap-2 flex-wrap"
                      >
                        <div>
                          <div className="font-bold text-slate-800">{d.fullName}</div>
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                            简称: {d.name} · 代号: {d.code}
                          </div>
                        </div>
                        <span className="text-purple-700 font-medium text-xs">
                          {d.category}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tab 内容 3: 诉求分类 */}
                {scoutActiveTab === "categories" && (
                  <div
                    role="tabpanel"
                    id="scout-panel-categories"
                    aria-labelledby="scout-tab-categories"
                    tabIndex={0}
                    className="max-h-[360px] overflow-y-auto space-y-2 pr-1"
                  >
                    {scoutResult.categories.map((c, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-slate-50/70 hover:bg-slate-50 transition-colors text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                          <span className="font-bold text-slate-900">{c.category}</span>
                          <span className="text-[11px] text-slate-500 font-medium">
                            牵头科室: {c.leadDepartment}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {c.subItems.map((sub, i) => (
                            <span
                              key={i}
                              className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[11px]"
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
          <DialogFooter className="px-4 sm:px-6 py-4 border-t border-slate-100 flex flex-row items-center justify-between gap-2 flex-wrap bg-slate-50/60 shrink-0">
            <button
              type="button"
              className="btn btn--default min-h-[44px] sm:min-h-[36px]"
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
                type="submit"
                form="scout-step1-form"
                className="btn btn--primary min-h-[44px] sm:min-h-[36px]"
                disabled={scoutLoading}
              >
                {scoutLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 motion-safe:animate-spin" aria-hidden="true" />
                    AI 智能梳理中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1.5 text-amber-300" aria-hidden="true" />
                    开始 AI 梳理区划与权责
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary min-h-[44px] sm:min-h-[36px]"
                onClick={handleCreateRegionConfirm}
                disabled={savingNewRegion}
              >
                {savingNewRegion ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 motion-safe:animate-spin" aria-hidden="true" />
                    正在创建 Schema 并初始化字典...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-1.5" aria-hidden="true" />
                    确认并一键初始化专属 12345 站点
                  </>
                )}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SVG 矢量地图上传弹窗 */}
      <Dialog
        open={uploadModalRegion != null}
        onOpenChange={(open) => {
          if (!open && !uploading) {
            setUploadModalRegion(null);
            setUploadFile(null);
            setSvgDragOver(false);
            setPreviewSvgUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
          }
        }}
      >
        <DialogContent
          closeDisabled={uploading}
          closeLabel="关闭地图上传弹窗"
          onEscapeKeyDown={(e) => {
            if (uploading) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (uploading) e.preventDefault();
          }}
          className="max-w-lg gap-4"
        >
          <DialogHeader className="text-left space-y-1 pr-10">
            <DialogTitle>
              {uploadModalRegion ? `上传【${uploadModalRegion.name}】矢量行政地图 (SVG)` : "上传矢量行政地图 (SVG)"}
            </DialogTitle>
            <DialogDescription>
              请上传标准 SVG 矢量行政区划地图，支持镇街高亮与交互透势呈现
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setSvgDragOver(true);
              }}
              onDragLeave={() => setSvgDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setSvgDragOver(false);
                applySelectedSvgFile(e.dataTransfer.files?.[0]);
              }}
              className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors focus-within:ring-2 focus-within:ring-blue-500 ${
                svgDragOver
                  ? "border-blue-500 bg-blue-50/60"
                  : "border-slate-200 hover:border-blue-500"
              }`}
            >
              <input
                type="file"
                accept=".svg"
                id="svg-upload-input"
                className="sr-only"
                onChange={handleMapFileChange}
              />
              <label htmlFor="svg-upload-input" className="cursor-pointer flex flex-col items-center">
                <Upload className="h-8 w-8 text-blue-600 mb-2" aria-hidden="true" />
                <span className="text-xs font-semibold text-slate-700">
                  {uploadFile ? uploadFile.name : "点击选择或拖拽 SVG 地图文件"}
                </span>
                <span className="text-[11px] text-slate-500 mt-1">仅支持 .svg 格式</span>
              </label>
            </div>

            {previewSvgUrl && (
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[11px] font-semibold text-slate-600 mb-2">SVG 预览：</div>
                <div className="max-h-48 overflow-hidden flex items-center justify-center">
                  <img
                    src={previewSvgUrl}
                    alt="SVG 行政地图预览"
                    className="max-h-48 w-auto object-contain"
                  />
                </div>
              </div>
            )}

            <DialogFooter className="flex-row justify-end gap-2.5 pt-4 border-t border-slate-100">
              <button
                type="button"
                className="btn btn--default min-h-[44px] sm:min-h-[36px]"
                onClick={() => {
                  setUploadModalRegion(null);
                  setUploadFile(null);
                  setSvgDragOver(false);
                  setPreviewSvgUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                }}
                disabled={uploading}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn--primary min-h-[44px] sm:min-h-[36px]"
                onClick={handleUploadMapSubmit}
                disabled={!uploadFile || uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 motion-safe:animate-spin" aria-hidden="true" />
                    上传中...
                  </>
                ) : (
                  "确认上传并绑定"
                )}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

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
