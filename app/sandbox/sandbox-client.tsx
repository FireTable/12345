"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Sparkles,
  Shield,
  Cpu,
  BookOpen,
  Brain,
  GitMerge,
  FileCheck2,
  Play,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Database,
  Loader2,
  ExternalLink,
  Clock,
} from "lucide-react";
import { useRegion } from "@/app/_components/civic/region-context";
import { useAuthRole } from "@/lib/auth/use-role";
import { ConfirmDialog } from "@/app/_components/ui/confirm-dialog";
import { categoryBadgeStyle, getUrgencyLabel } from "@/lib/civic-dto";

type XrayResult = {
  step1_anonymize: {
    maskedText: string;
    entities: Array<{ type: string; original: string; token: string }>;
    durationUs: number;
  };
  step2_systemOne: {
    intent: string;
    urgency: string;
    slaHours: number;
    stabilityRisk: boolean;
    category: string;
    adapter: string;
    durationMs: number;
  };
  step3_vocab: {
    matchedTownship: string | null;
    aliasHits: Array<{ alias: string; canonical: string }>;
    durationMs: number;
  };
  step4_systemTwo: {
    subject: string;
    location: string;
    eventType: string;
    category: string;
    summarizeTitle: string;
    confidence: number;
    reasoning?: string | null;
    endpoint?: string | null;
    backend: string;
    durationMs: number;
  };
  step5_clusterMatch: {
    similarTickets: Array<{
      ticketNo: string;
      title: string;
      similarity: number;
      status: string;
      closedAt?: string | null;
    }>;
    matchedTheme: {
      id: string;
      title: string;
      handlingStatus: string;
      riskLevel: string;
    } | null;
    willTriggerFakeClosure: boolean;
    threshold: number;
    durationMs: number;
  };
  step6_restoreAndAdvice: {
    restoredSubject: string;
    restoredLocation: string;
    recommendedAction: string;
    leadDepartment: string;
    slaHint: string;
    persistedTicketNo?: string;
  };
};

const STAGE_META = [
  { key: 1, title: "01 · 可逆脱敏 Diff", icon: Shield },
  { key: 2, title: "02 · System-1 快思考神经引擎", icon: Cpu },
  { key: 3, title: "03 · 法定白名单与别名归一", icon: BookOpen },
  { key: 4, title: "04 · System-2 慢思考结构化抽取", icon: Brain },
  { key: 5, title: "05 · 语义吸附与假闭环探测", icon: GitMerge },
  { key: 6, title: "06 · 反向脱敏还原与公文建议", icon: FileCheck2 },
] as const;

export default function SandboxXrayPage() {
  const { activeRegion } = useRegion();
  const { isAdmin, isPending: isRolePending } = useAuthRole();

  const [title, setTitle] = useState("");
  const [subdistrict, setSubdistrict] = useState("");
  const [content, setContent] = useState("");

  const [running, setRunning] = useState(false);
  const [xrayError, setXrayError] = useState<string | null>(null);
  const [result, setResult] = useState<XrayResult | null>(null);
  const [revealedStage, setRevealedStage] = useState(0);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [presetHint, setPresetHint] = useState<string | null>(null);
  const [loadingPreset3, setLoadingPreset3] = useState(false);
  const presetControllerRef = useRef<AbortController | null>(null);
  const xrayControllerRef = useRef<AbortController | null>(null);

  const [persistConfirmOpen, setPersistConfirmOpen] = useState(false);
  const [persisting, setPersisting] = useState(false);
  const [persistedOk, setPersistedOk] = useState(false);

  const isEcommerce = activeRegion?.domainProfile?.domainType === "ECOMMERCE_CS";
  const isTianhe = Boolean(
    activeRegion?.id?.includes("tianhe") || activeRegion?.name?.includes("天河")
  );
  const isShunde = Boolean(
    activeRegion?.id?.includes("shunde") || activeRegion?.name?.includes("顺德")
  );

  useEffect(() => {
    return () => {
      presetControllerRef.current?.abort();
      xrayControllerRef.current?.abort();
    };
  }, []);

  // 逐级亮起动画（不阻塞真实返回，遵循系统减少动态偏好设置）
  useEffect(() => {
    if (!result) {
      setRevealedStage(0);
      return;
    }
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setRevealedStage(6);
      return;
    }
    setRevealedStage(1);
    const timers: number[] = [];
    for (let step = 2; step <= 6; step++) {
      timers.push(
        window.setTimeout(() => {
          setRevealedStage(step);
        }, (step - 1) * 75)
      );
    }
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [result]);

  function applyPreset1() {
    setPresetHint(null);
    setXrayError(null);
    setPersistedOk(false);
    if (isEcommerce) {
      setTitle("华南冷链仓 SKU-GD2026-881 礼盒化冻发臭，拒赔将向 12315 举报");
      setSubdistrict("华南冷链仓");
      setContent(
        "本人张某（13800138999）在天猫旗舰店下单的 SKU-GD2026-881 冻干生鲜礼盒由华南冷链仓发货，到货全程化冻发酸，食用后出现轻微腹泻，客服推诿仅退 20 元优惠券，要求全额退款并按食安法赔付，否则立即向 12315 市场监管举报！"
      );
    } else if (isTianhe) {
      setTitle("天河南一路商圈货车夜间占道违停");
      setSubdistrict("天河南街道");
      setContent(
        "昨晚22点至今，天河南一路正佳广场西侧通道多辆粤A82K9*厢式货车长期占用消防通道违停卸货，市民张先生（13800138000）反映严重影响夜间通行与消防安全。"
      );
    } else if (isShunde) {
      setTitle("大良清晖路商圈货车夜间占道违停");
      setSubdistrict("大良街道");
      setContent(
        "昨晚22点至今，大良街道清晖路商圈通道多辆粤X82K9*厢式货车长期占用消防通道违停卸货，市民张先生（13800138000）反映严重影响夜间通行与消防安全。"
      );
    } else {
      const regionLabel = activeRegion?.name || "辖区";
      setTitle(`${regionLabel}核心商圈货车夜间占道违停`);
      setSubdistrict("");
      setContent(
        `昨晚22点至今，${regionLabel}中心商圈西侧通道多辆厢式货车长期占用消防通道违停卸货，市民张先生（13800138000）反映影响通行与消防安全。`
      );
    }
  }

  function applyPreset2() {
    setPresetHint(null);
    setXrayError(null);
    setPersistedOk(false);
    if (isEcommerce) {
      setTitle("抖音直播间下单羽绒服充绒严重缩水与宣传不符");
      setSubdistrict("抖音直播间");
      setContent(
        "在抖音官方直播间下单的 SKU-WJ-2026 鹅绒服，由华东中心仓发出（运单 SF1498827711220），收货吊牌充绒量与直播间主播口头承诺严重不符且外箱破损淋湿，联系旗舰店客服两日无人处理。"
      );
    } else if (isTianhe) {
      setTitle("岗顶电脑城后街夜宵油烟直排扰民");
      setSubdistrict("石牌街道");
      setContent(
        "岗顶旧电脑城后街几家夜宵大排档每晚油烟和风机噪音很大，楼上住户窗户都不敢开，盼生态环境和执法部门现场核查。"
      );
    } else {
      setTitle("容奇大桥脚夜宵餐饮油烟直排扰民");
      setSubdistrict(isShunde ? "容桂街道" : "");
      setContent(
        "容奇大桥脚附近几家夜宵大排档每晚油烟和风机噪音很大，周边住户窗户都不敢开，希望尽快治理油烟直排问题。"
      );
    }
  }

  async function applyPreset3() {
    if (!isAdmin) return;
    presetControllerRef.current?.abort();
    const controller = new AbortController();
    presetControllerRef.current = controller;
    setLoadingPreset3(true);
    setPresetHint(null);
    setXrayError(null);
    setPersistedOk(false);
    try {
      const headers: Record<string, string> = {};
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      const res = await fetch("/api/clusters", { headers, signal: controller.signal });
      if (!res.ok) {
        throw new Error(`专题索引拉取失败 (${res.status})`);
      }
      const json = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      const list = Array.isArray(json?.topClusters) ? json.topClusters : [];
      const resolved = list.find(
        (c: any) =>
          c?.status?.code === "RESOLVED" ||
          c?.status?.label === "已办结" ||
          (c?.status?.progress ?? 0) >= 100
      );
      if (resolved) {
        const subject = resolved.canonicalSubject || resolved.title || resolved.type;
        const location = resolved.canonicalLocation || resolved.region || activeRegion?.name || "";
        const town =
          resolved.region && !String(resolved.region).includes("等")
            ? String(resolved.region).split("·")[0].trim()
            : "";
        setTitle(`【复发】${resolved.title || subject}`);
        setSubdistrict(town);
        setContent(
          `之前已答复办结的「${location}」${subject}问题近日再次复发回潮，现场诉求情况与前期工单高度一致，未得到彻底整改，请求立即重开督办核查。`
        );
        setPresetHint(`已自动匹配当前站点已办结群组：${resolved.title || resolved.id}`);
        return;
      }
      setTitle("已办结施工噪音问题短期内再次回潮");
      setSubdistrict(isTianhe ? "猎德街道" : isShunde ? "北滘镇" : "");
      setContent(
        `上周回复已办结的${isTianhe ? "猎德大道" : isShunde ? "北滘新城" : activeRegion?.name || "辖区"}夜间违规施工噪音问题昨晚再次发生，凌晨仍有重型机械作业，属于假闭环复发诉求。`
      );
      setPresetHint("当前站点暂未检索到已办结群组，已填充典型假闭环复发测试文本");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError" || controller.signal.aborted) return;
      setTitle("已办结路段占道问题短期再次复发");
      setContent("上周回复已办结的占道经营及噪音问题昨晚再次回潮，请求复核重开督办。");
      setPresetHint("当前站点专题索引拉取异常，已填充通用假闭环复发测试文本");
    } finally {
      if (presetControllerRef.current === controller) {
        setLoadingPreset3(false);
      }
    }
  }

  async function executeRunXray() {
    if (!isAdmin) return;
    if (!content.trim()) {
      const msg = "请输入需要透视的市民诉求正文";
      setXrayError(msg);
      toast.error(msg);
      return;
    }
    xrayControllerRef.current?.abort();
    const controller = new AbortController();
    xrayControllerRef.current = controller;
    setRunning(true);
    setXrayError(null);
    setResult(null);
    setReasoningOpen(false);
    setPersistedOk(false);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      const res = await fetch("/api/sandbox/xray", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          title: title.trim() || undefined,
          subdistrict: subdistrict.trim() || undefined,
          content: content.trim(),
          regionId: activeRegion?.id,
          persist: false,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!res.ok || !json.success) {
        throw new Error(json.error || `透视执行失败 (${res.status})`);
      }
      const payload = (json.data || json) as XrayResult;
      setResult(payload);
      toast.success("全链路 X-Ray 透视完成（只读演练，未写入业务库）");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError" || controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "全链路透视请求失败";
      setXrayError(msg);
      toast.error(msg);
    } finally {
      if (xrayControllerRef.current === controller) {
        setRunning(false);
      }
    }
  }

  function handleRunXray(e: React.FormEvent) {
    e.preventDefault();
    void executeRunXray();
  }

  async function handleConfirmPersist() {
    if (!isAdmin || !content.trim() || persisting) return;
    setPersisting(true);
    try {
      const cleanContent = content.trim().replace(/\r?\n+/g, " ");
      const line = [
        title.trim() ? `${title.trim()}。` : "",
        subdistrict.trim() ? `[${subdistrict.trim()}] ` : "",
        cleanContent,
      ]
        .join("")
        .trim();

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      const res = await fetch("/api/tickets/paste", {
        method: "POST",
        headers,
        body: JSON.stringify({ texts: [line] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `入库失败 (${res.status})`);
      }
      const inserted = json.data?.insertedCount ?? json.insertedCount ?? 0;
      const dup = json.data?.duplicateCount ?? json.duplicateCount ?? 0;
      setPersistConfirmOpen(false);
      setPersistedOk(true);
      if (inserted > 0) {
        toast.success(`已真实入库 ${inserted} 条工单，后台已触发增量聚类与研判`);
      } else if (dup > 0) {
        toast.info("检测到同内容/同单号工单已存在（去重跳过）");
      } else {
        toast.success("已提交入库流转");
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("civic-data-refresh"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "真实入库失败");
    } finally {
      setPersisting(false);
    }
  }

  const s1 = result?.step1_anonymize;
  const s2 = result?.step2_systemOne;
  const s3 = result?.step3_vocab;
  const s4 = result?.step4_systemTwo;
  const s5 = result?.step5_clusterMatch;
  const s6 = result?.step6_restoreAndAdvice;

  if (isRolePending || !isAdmin) {
    return null;
  }

  return (
    <>
      <div className="page-hero">
        <div className="min-w-0">
          <h1 className="page-hero__title flex-wrap">
            <span>全链路 AI 透视演练台</span>
            <span className="badge-pill badge-pill--info text-xs font-semibold">
              X-Ray Sandbox
            </span>
          </h1>
          <div className="page-hero__sub">
            {activeRegion ? `${activeRegion.city} · ${activeRegion.name}` : "当前辖区"} ·
            逐阶段透明展示「可逆脱敏 ➔ System-1 快思考 ➔ 白名单归一 ➔ System-2 慢思考 ➔ 语义吸附与假闭环 ➔ 还原建议」（默认只读不落库）
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
            <Shield className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            只读透视模式 (persist: false)
          </span>
        </div>
      </div>

      {/* 预置示例 + 工单输入面板 */}
      <div className="card mb-5">
        <div className="card__header flex-wrap gap-2.5">
          <h2 className="card__title flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
            <span>模拟工单输入与典型场景一键填充</span>
          </h2>
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <button
              type="button"
              onClick={applyPreset1}
              className="btn btn--default text-xs min-h-[44px] sm:min-h-0 py-2 sm:py-1.5 px-2.5"
            >
              {isEcommerce ? "① 冷链食安红线归因" : "① 主体违停精确对齐"}
            </button>
            <button
              type="button"
              onClick={applyPreset2}
              className="btn btn--default text-xs min-h-[44px] sm:min-h-0 py-2 sm:py-1.5 px-2.5"
            >
              {isEcommerce ? "② 虚假宣传与物流履约" : "② 口语俗称别名归一"}
            </button>
            <button
              type="button"
              disabled={loadingPreset3}
              onClick={() => void applyPreset3()}
              className="btn btn--default text-xs min-h-[44px] sm:min-h-0 py-2 sm:py-1.5 px-2.5 text-rose-700 border-rose-200 hover:border-rose-400"
            >
              {loadingPreset3 ? "正在检索已办结群组…" : "③ 已办结复发假闭环预警"}
            </button>
          </div>
        </div>
        <div className="card__body">
          {presetHint && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{presetHint}</span>
            </div>
          )}
          <form onSubmit={handleRunXray} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 min-w-0">
                <label htmlFor="sandbox-ticket-title" className="block text-xs font-medium text-slate-600 mb-1">
                  工单标题（可选）
                </label>
                <input
                  id="sandbox-ticket-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：夜间建筑施工噪音扰民诉求（留空则由 AI 自动提炼）"
                  className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="min-w-0">
                <label htmlFor="sandbox-ticket-subdistrict" className="block text-xs font-medium text-slate-600 mb-1">
                  {activeRegion?.domainProfile?.terminology?.regionUnit || "所属镇街"}（可选）
                </label>
                <input
                  id="sandbox-ticket-subdistrict"
                  type="text"
                  value={subdistrict}
                  onChange={(e) => setSubdistrict(e.target.value)}
                  placeholder={
                    isEcommerce
                      ? "如：天猫旗舰店 / 华南冷链仓"
                      : isTianhe
                        ? "如：天河南街道"
                        : isShunde
                          ? "如：大良街道"
                          : "如：镇街名称"
                  }
                  className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label htmlFor="sandbox-ticket-content" className="block text-xs font-medium text-slate-600 mb-1">
                {isEcommerce ? "客诉工单正文（必填）" : "市民诉求正文（必填）"}
              </label>
              <textarea
                id="sandbox-ticket-content"
                rows={4}
                required
                aria-describedby="sandbox-xray-hint"
                enterKeyHint="send"
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  if (xrayError) setXrayError(null);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.metaKey || e.ctrlKey) &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    if (content.trim() && !running) void executeRunXray();
                  }
                }}
                placeholder={
                  isEcommerce
                    ? "输入电商客诉原文（可包含手机号、SKU、渠道仓网或运单号，系统将演示可逆脱敏与全链路研判）…"
                    : "输入市民热线诉求原文（可包含电话、门牌、车牌或口语地标俗称，系统将演示可逆脱敏与全链路研判）…"
                }
                className="w-full p-3 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 leading-relaxed focus:outline-none focus:border-blue-500 resize-y"
              />
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
              <span id="sandbox-xray-hint" className="text-[11px] text-slate-500 min-w-0 break-words">
                支持 Cmd/Ctrl + Enter 提交；演练过程不会修改数据库，也不会影响 {activeRegion?.name || "当前区"} 基线工单计数。
              </span>
              <button
                type="submit"
                disabled={running || !content.trim()}
                className="btn btn--primary text-xs min-h-[44px] sm:min-h-0 px-4 py-2 disabled:opacity-50"
              >
                {running ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                    <span>正在执行 6 阶段透视…</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>开始全链路 X-Ray 透视</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {xrayError && (
        <div
          role="alert"
          className="card mb-5 border-rose-200 bg-rose-50/70 px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
        >
          <div className="flex items-center gap-2 text-xs text-rose-800 min-w-0">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
            <span className="break-words">透视演练异常：{xrayError}</span>
          </div>
          <button
            type="button"
            disabled={running || !content.trim()}
            onClick={() => void executeRunXray()}
            className="btn btn--default text-xs min-h-[44px] sm:min-h-0 px-3 text-rose-700 border-rose-300 hover:bg-rose-100 shrink-0"
          >
            重试透视
          </button>
        </div>
      )}

      {/* 6 阶段进度条导航 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
        {STAGE_META.map((st) => {
          const Icon = st.icon;
          const active = running && !result;
          const lit = revealedStage >= st.key;
          return (
            <div
              key={st.key}
              className={`min-w-0 rounded-xl border px-3 py-2.5 flex items-center gap-2 transition-all ${
                lit
                  ? "bg-blue-50/80 border-blue-300 text-blue-900 shadow-2xs"
                  : active
                    ? "bg-white border-blue-200 text-slate-700"
                    : "bg-white border-slate-900/[0.08] text-slate-500"
              }`}
            >
              <Icon
                aria-hidden="true"
                className={`w-4 h-4 shrink-0 ${
                  lit ? "text-blue-600" : active ? "text-blue-400" : "text-slate-400"
                }`}
              />
              <span className="text-[11px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
                {st.title}
              </span>
            </div>
          );
        })}
      </div>

      {/* 6 阶段详细透视卡片 */}
      {result ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 阶段 1: 可逆脱敏 Diff */}
            <div
              className={`card min-w-0 transition-opacity duration-200 ${
                revealedStage >= 1 ? "opacity-100" : "opacity-40"
              }`}
            >
              <div className="card__header flex-wrap gap-2">
                <h2 className="card__title flex items-center gap-2 min-w-0">
                  <Shield className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span>01 · 可逆脱敏 Diff</span>
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono tabular-nums whitespace-nowrap bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                  <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                  {s1?.durationUs ?? 0} μs
                </span>
              </div>
              <div className="card__body space-y-3 text-xs">
                <div>
                  <div className="text-[11px] text-slate-500 mb-1.5">识别并替换的敏感实体</div>
                  {s1 && s1.entities.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {s1.entities.map((ent, idx) => (
                        <span
                          key={`${ent.token}-${idx}`}
                          className="inline-flex flex-wrap items-center gap-1.5 max-w-full px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-[11px]"
                        >
                          <span className="font-mono text-[10px] text-emerald-700 font-semibold shrink-0">
                            {ent.type}
                          </span>
                          <span className="line-through text-slate-500 break-all">{ent.original}</span>
                          <ArrowRight className="w-3 h-3 text-emerald-600 shrink-0" aria-hidden="true" />
                          <span className="font-mono font-bold text-emerald-900 break-all">{ent.token}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 bg-slate-50 px-2.5 py-2 rounded-lg border border-slate-200/70">
                      未检测到需替换的手机/身份证/姓名/门牌号等个人隐私实体
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">送入大模型前的脱敏文本</div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-slate-700 leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {s1?.maskedText || content}
                  </div>
                </div>
              </div>
            </div>

            {/* 阶段 2: System-1 快思考神经引擎 */}
            <div
              className={`card min-w-0 transition-opacity duration-200 ${
                revealedStage >= 2 ? "opacity-100" : "opacity-40"
              }`}
            >
              <div className="card__header flex-wrap gap-2">
                <h2 className="card__title flex items-center gap-2 min-w-0">
                  <Cpu className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
                  <span>02 · System-1 快思考神经引擎</span>
                </h2>
                <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono whitespace-nowrap bg-blue-50 text-blue-700 border border-blue-200">
                    {s2?.adapter || "onnx"}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono tabular-nums whitespace-nowrap bg-slate-100 text-slate-700 border border-slate-200">
                    <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {s2?.durationMs ?? 0} ms
                  </span>
                </div>
              </div>
              <div className="card__body grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                  <div className="text-[11px] text-slate-500 mb-1">诉求意图</div>
                  <div className="font-semibold text-slate-900 break-words">{s2?.intent || "—"}</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                  <div className="text-[11px] text-slate-500 mb-1">法定分类初判</div>
                  <div className="min-w-0">
                    {s2?.category ? (
                      <span
                        className="badge-pill text-[11px] max-w-full"
                        style={categoryBadgeStyle(s2.category)}
                      >
                        {s2.category}
                      </span>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                  <div className="text-[11px] text-slate-500 mb-1">紧迫度 / 建议时限</div>
                  <div className="font-semibold text-slate-900 tabular-nums">
                    {getUrgencyLabel(s2?.urgency)} · {s2?.slaHours ?? "—"}h
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                  <div className="text-[11px] text-slate-500 mb-1">涉稳护栏判定</div>
                  <div className="font-semibold">
                    {s2?.stabilityRisk ? (
                      <span className="text-rose-600">存在涉稳风险</span>
                    ) : (
                      <span className="text-emerald-700">涉稳平稳</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 阶段 3: 法定白名单与别名归一 */}
            <div
              className={`card min-w-0 transition-opacity duration-200 ${
                revealedStage >= 3 ? "opacity-100" : "opacity-40"
              }`}
            >
              <div className="card__header flex-wrap gap-2">
                <h2 className="card__title flex items-center gap-2 min-w-0">
                  <BookOpen className="w-4 h-4 text-indigo-600 shrink-0" aria-hidden="true" />
                  <span>03 · 法定白名单与别名归一</span>
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono tabular-nums whitespace-nowrap bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                  <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                  {s3?.durationMs ?? 0} ms
                </span>
              </div>
              <div className="card__body space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2 flex-wrap p-2.5 rounded-lg bg-slate-50 border border-slate-200/80">
                  <span className="text-slate-500 shrink-0">命中法定镇街 / 节点</span>
                  <span className="font-semibold text-slate-900 break-words min-w-0">
                    {s3?.matchedTownship || "未匹配到明确镇街"}
                  </span>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1.5">口语俗称 ➔ 标准名词映射</div>
                  {s3 && s3.aliasHits.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {s3.aliasHits.map((hit, idx) => (
                        <span
                          key={`${hit.alias}-${idx}`}
                          className="inline-flex flex-wrap items-center gap-1.5 max-w-full px-2.5 py-1 rounded-md bg-indigo-50 border border-indigo-200 text-[11px]"
                        >
                          <span className="text-slate-700 break-words">{hit.alias}</span>
                          <ArrowRight className="w-3 h-3 text-indigo-500 shrink-0" aria-hidden="true" />
                          <span className="font-semibold text-indigo-900 break-words">{hit.canonical}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 bg-slate-50 px-2.5 py-2 rounded-lg border border-slate-200/70">
                      未命中额外口语别名映射条目
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 阶段 4: System-2 慢思考结构化抽取 */}
            <div
              className={`card min-w-0 transition-opacity duration-200 ${
                revealedStage >= 4 ? "opacity-100" : "opacity-40"
              }`}
            >
              <div className="card__header flex-wrap gap-2">
                <h2 className="card__title flex items-center gap-2 min-w-0">
                  <Brain className="w-4 h-4 text-purple-600 shrink-0" aria-hidden="true" />
                  <span>04 · System-2 慢思考结构化抽取</span>
                </h2>
                <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono whitespace-nowrap border ${
                      s4?.backend === "fallback"
                        ? "bg-amber-50 text-amber-800 border-amber-200"
                        : "bg-purple-50 text-purple-700 border-purple-200"
                    }`}
                  >
                    {s4?.backend === "fallback" ? "fallback 规则兜底" : s4?.backend || "llm"}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono tabular-nums whitespace-nowrap bg-slate-100 text-slate-700 border border-slate-200">
                    <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {s4?.durationMs ?? 0} ms
                  </span>
                </div>
              </div>
              <div className="card__body space-y-2.5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="sm:col-span-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                    <div className="text-[11px] text-slate-500 mb-0.5">提炼标准标题</div>
                    <div className="font-semibold text-slate-900 break-words">{s4?.summarizeTitle || "—"}</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                    <div className="text-[11px] text-slate-500 mb-0.5">涉事主体</div>
                    <div className="font-semibold text-slate-900 break-words">{s4?.subject || "—"}</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                    <div className="text-[11px] text-slate-500 mb-0.5">标准地点</div>
                    <div className="font-semibold text-slate-900 break-words">{s4?.location || "—"}</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                    <div className="text-[11px] text-slate-500 mb-0.5">细分事件 / 分类</div>
                    <div className="font-semibold text-slate-900 break-words">
                      {s4?.eventType || "—"} · {s4?.category || "—"}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                    <div className="text-[11px] text-slate-500 mb-0.5">抽取置信度 / 节点</div>
                    <div className="font-semibold text-slate-900 font-mono tabular-nums break-all">
                      {s4?.confidence ?? 0}%
                      {s4?.endpoint ? ` · ${s4.endpoint}` : ""}
                    </div>
                  </div>
                </div>
                {s4?.reasoning && (
                  <div className="border-t border-slate-100 pt-2">
                    <button
                      type="button"
                      aria-expanded={reasoningOpen}
                      onClick={() => setReasoningOpen((prev) => !prev)}
                      className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[24px] py-1 text-[11px] font-semibold text-purple-700 hover:underline cursor-pointer"
                    >
                      <span>{reasoningOpen ? "收起思维链 (Reasoning)" : "展开思维链 (Reasoning)"}</span>
                      {reasoningOpen ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
                    </button>
                    {reasoningOpen && (
                      <div className="mt-1.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-h-40 overflow-y-auto">
                        {s4.reasoning}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 阶段 5: 语义吸附与假闭环探测 */}
            <div
              className={`card min-w-0 transition-opacity duration-200 ${
                revealedStage >= 5 ? "opacity-100" : "opacity-40"
              }`}
            >
              <div className="card__header flex-wrap gap-2">
                <h2 className="card__title flex items-center gap-2 min-w-0">
                  <GitMerge className="w-4 h-4 text-cyan-600 shrink-0" aria-hidden="true" />
                  <span>05 · 语义吸附与假闭环探测</span>
                </h2>
                <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono tabular-nums whitespace-nowrap bg-cyan-50 text-cyan-800 border border-cyan-200">
                    阈值 {s5?.threshold ?? 0.72}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono tabular-nums whitespace-nowrap bg-slate-100 text-slate-700 border border-slate-200">
                    <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                    {s5?.durationMs ?? 0} ms
                  </span>
                </div>
              </div>
              <div className="card__body space-y-3 text-xs">
                {s5?.willTriggerFakeClosure && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-300 text-rose-800 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="font-bold text-rose-900">
                        触发假闭环复发预警！
                      </div>
                      <div className="text-[11px] mt-0.5 break-words">
                        该诉求命中已办结专题群组并在复发检测时间窗内，真实入库后将自动标记「疑似假闭环」并将原群组重开升级为高危督办。
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[11px] text-slate-500 mb-1">匹配多频专题群组</div>
                  {s5?.matchedTheme ? (
                    <div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200 flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-blue-950 whitespace-nowrap overflow-hidden text-ellipsis">
                          {s5.matchedTheme.title}
                        </div>
                        <div className="text-[11px] text-blue-700 mt-0.5 break-words">
                          状态：{s5.matchedTheme.handlingStatus} · 风险：{s5.matchedTheme.riskLevel}
                        </div>
                      </div>
                      <Link
                        href={`/themes/${encodeURIComponent(s5.matchedTheme.id)}`}
                        className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[24px] px-1.5 py-1 sm:py-0.5 text-[11px] font-semibold text-blue-700 hover:underline shrink-0 whitespace-nowrap"
                      >
                        <span>查看群组</span>
                        <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                      </Link>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 bg-slate-50 px-2.5 py-2 rounded-lg border border-slate-200/70">
                      未吸附到既有群组，入库后将作为独立新诉求或新专题起点
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-[11px] text-slate-500 mb-1">
                    检索到的相似历史工单 ({s5?.similarTickets?.length ?? 0})
                  </div>
                  {s5 && s5.similarTickets.length > 0 ? (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                      {s5.similarTickets.map((t, idx) => (
                        <div
                          key={`${t.ticketNo}-${idx}`}
                          className="p-2 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2 min-w-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-slate-800 whitespace-nowrap overflow-hidden text-ellipsis">
                              <span className="font-mono text-[11px] text-slate-500 mr-1.5">
                                #{t.ticketNo}
                              </span>
                              {t.title}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                              状态：{t.status}
                              {t.closedAt ? ` · 办结：${String(t.closedAt).slice(0, 10)}` : ""}
                            </div>
                          </div>
                          <span className="font-mono text-[11px] font-semibold tabular-nums text-cyan-800 bg-cyan-50 border border-cyan-200 px-2 py-0.5 rounded shrink-0 whitespace-nowrap">
                            {Math.round(t.similarity * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500">暂无相似历史工单</div>
                  )}
                </div>
              </div>
            </div>

            {/* 阶段 6: 反向脱敏还原与公文建议 */}
            <div
              className={`card min-w-0 transition-opacity duration-200 ${
                revealedStage >= 6 ? "opacity-100" : "opacity-40"
              }`}
            >
              <div className="card__header flex-wrap gap-2">
                <h2 className="card__title flex items-center gap-2 min-w-0">
                  <FileCheck2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span>06 · 反向脱敏还原与公文处置建议</span>
                </h2>
                <span className="badge-pill badge-pill--success text-[11px] shrink-0">
                  {s6?.slaHint || "常规时限"}
                </span>
              </div>
              <div className="card__body space-y-2.5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                    <div className="text-[11px] text-slate-500 mb-0.5">还原后涉事主体</div>
                    <div className="font-semibold text-slate-900 break-words">
                      {s6?.restoredSubject || "—"}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                    <div className="text-[11px] text-slate-500 mb-0.5">还原后事发地点</div>
                    <div className="font-semibold text-slate-900 break-words">
                      {s6?.restoredLocation || "—"}
                    </div>
                  </div>
                  <div className="sm:col-span-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 min-w-0">
                    <div className="text-[11px] text-slate-500 mb-0.5">建议牵头承办部门</div>
                    <div className="font-semibold text-blue-800 break-words">
                      {s6?.leadDepartment || "—"}
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">公文级协同处置建议</div>
                  <div className="p-3 rounded-lg bg-emerald-50/50 border border-emerald-200/80 text-slate-800 leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {s6?.recommendedAction || "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 底部可选真实入库确认栏 */}
          <div className="card min-w-0">
            <div className="card__body flex items-center justify-between gap-4 flex-wrap py-3.5">
              <div className="flex items-start sm:items-center gap-2 text-xs text-slate-600 min-w-0 flex-1">
                <Database className="w-4 h-4 text-blue-600 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
                <span className="break-words">
                  当前展示为只读透视结果（未写入数据库）。如需测试真实入库与自动聚类，可手动触发单条入库流转。
                </span>
              </div>
              <div className="flex items-center gap-2 max-w-full">
                {persistedOk ? (
                  <Link
                    href="/tickets"
                    className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 max-w-full flex-wrap"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>已入库流转，前往工单中心查看</span>
                    <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={persisting}
                    onClick={() => setPersistConfirmOpen(true)}
                    className="btn btn--default min-h-[44px] sm:min-h-0 text-xs border-blue-200 text-blue-700 hover:border-blue-400 !whitespace-normal text-center leading-snug max-w-full"
                  >
                    <Database className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>真实入库流转（写入本区并触发增量研判）</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="empty-hint">
            选择上方典型场景或输入模拟工单正文，点击「开始全链路 X-Ray 透视」即可实时观测 6 阶段 AI 处置链路。
          </div>
        </div>
      )}

      <ConfirmDialog
        open={persistConfirmOpen}
        title="确认将该演练工单真实入库？"
        description={`提交后将向【${activeRegion?.name || "当前区"}】写入 1 条真实工单并触发后台增量聚类研判；该操作将变更当前站点工单列表。`}
        confirmLabel="确认写入并流转"
        pending={persisting}
        onConfirm={() => void handleConfirmPersist()}
        onOpenChange={setPersistConfirmOpen}
      />
    </>
  );
}
