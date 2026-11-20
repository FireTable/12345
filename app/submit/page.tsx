"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Send,
  CheckCircle2,
  AlertCircle,
  FileText,
  Sparkles,
  RefreshCw,
  ChevronDown,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useRegion } from "@/app/_components/civic/region-context";
import { useStreamAsr } from "@/app/_hooks/use-stream-asr";
import {
  XiaochunStage,
  type XiaochunStageHandle,
} from "@/app/_components/agent/xiaochun-stage";
import "./submit.css";

type SubmitMode = "form" | "voice";

interface IntakeOptionsResponse {
  success?: boolean;
  regionId?: string;
  regionName?: string;
  domainProfile?: {
    domainType?: "GOV_12345" | "ECOMMERCE_CS";
    displayName?: string;
    categories?: string[];
    channels?: string[];
    terminology?: {
      regionUnit?: string;
      subject?: string;
      ticketNoun?: string;
    };
  };
  subdistricts?: string[];
  categories?: string[];
  channels?: string[];
}

interface IntakeDraft {
  title: string;
  content: string;
  subdistrict: string;
  category: string;
  subject: string;
  address: string;
  contactPhone: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface SubmitReceipt {
  ticketId: string;
  ticketNo: string;
  status: string;
  urgency: string;
  slaHours?: number;
  maskedPreview?: string;
}

interface CitizenTicketLogDto {
  action: string;
  note: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  operator: string | null;
  createdAt: string;
}

interface MyTicketItem {
  id: string;
  ticketNo: string;
  title: string | null;
  content: string;
  subdistrict: string | null;
  category: string | null;
  status: string;
  closureStatus: string | null;
  isFakeClosure: boolean;
  themeId: string | null;
  themeTitle: string | null;
  latestLog: CitizenTicketLogDto | string | null;
  createdAt: string;
}

const EMPTY_DRAFT: IntakeDraft = {
  title: "",
  content: "",
  subdistrict: "",
  category: "",
  subject: "",
  address: "",
  contactPhone: "",
};

const DEFAULT_GOV_CATEGORIES = [
  "城市管理",
  "市场监管",
  "社会治理",
  "交通出行",
  "生态环境",
  "劳动社保",
  "公共安全",
];

const DEFAULT_ECOM_CATEGORIES = [
  "商品质量与破损",
  "物流延误与丢件",
  "货不对板与宣传不符",
  "退款与价保纠纷",
  "假冒伪劣与欺诈",
  "客服推诿与售后超时",
  "食安与合规红线",
];

const STATUS_LABELS: Record<string, string> = {
  PENDING: "待研判分派",
  IN_PROGRESS: "处置办理中",
  PROCESSING: "处置办理中",
  DISPATCHED: "已派单处理",
  RESOLVED: "已办结",
  CLOSED: "已办结",
  REOPENED: "重开核查中",
};

const URGENCY_LABELS: Record<string, string> = {
  URGENT: "紧急",
  HIGH: "高",
  MEDIUM: "中",
  NORMAL: "常规",
  LOW: "一般",
};

const LOG_ACTION_LABELS: Record<string, string> = {
  DISPATCH: "已派单",
  ADVANCE: "推进办理",
  ESCALATE: "升级督办",
  RESOLVE: "已办结",
  REOPEN: "重开核查",
  CORRECT_ENTITY: "信息补全",
};

function formatLatestLog(log: CitizenTicketLogDto | string | null | undefined): string | null {
  if (!log) return null;
  if (typeof log === "string") return log;
  const actionLabel = LOG_ACTION_LABELS[log.action] || log.action;
  const parts = [actionLabel];
  if (log.note) parts.push(log.note);
  else if (log.toStatus) parts.push(STATUS_LABELS[log.toStatus] || log.toStatus);
  return parts.join(" · ");
}

function isTicketResolved(t: MyTicketItem): boolean {
  if (t.isFakeClosure || t.status === "REOPENED" || t.closureStatus === "REOPENED") {
    return false;
  }
  const s = (t.status || "").toUpperCase();
  const c = (t.closureStatus || "").toUpperCase();
  return s === "RESOLVED" || s === "CLOSED" || c === "RESOLVED" || c === "CLOSED" || t.closureStatus === "已办结";
}

function isValidPhoneIfPresent(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^(1[3-9]\d{9}|0\d{2,3}-?\d{7,8})$/.test(trimmed);
}

export default function SubmitPage() {
  const { activeRegion, appDomain } = useRegion();
  const datalistId = useId();

  const [mode, setMode] = useState<SubmitMode>("form");
  const formTabRef = useRef<HTMLButtonElement>(null);
  const voiceTabRef = useRef<HTMLButtonElement>(null);

  const [options, setOptions] = useState<IntakeOptionsResponse | null>(null);
  const [optionsLoading, setOptionsLoading] = useState<boolean>(true);

  // 单一页面级礼貌错误/状态播报区
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("");
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAnnouncement = useCallback((msg: string) => {
    if (announceTimerRef.current) {
      clearTimeout(announceTimerRef.current);
    }
    setLiveAnnouncement("");
    announceTimerRef.current = setTimeout(() => {
      setLiveAnnouncement(msg);
    }, 450);
  }, []);

  useEffect(() => {
    return () => {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    };
  }, []);

  const isEcommerce =
    options?.domainProfile?.domainType === "ECOMMERCE_CS" ||
    activeRegion?.domainProfile?.domainType === "ECOMMERCE_CS" ||
    (!activeRegion && appDomain === "ECOMMERCE_CS");

  const regionUnitLabel =
    options?.domainProfile?.terminology?.regionUnit ||
    activeRegion?.domainProfile?.terminology?.regionUnit ||
    (isEcommerce ? "渠道/仓网" : "所属镇街");

  const subjectLabel =
    options?.domainProfile?.terminology?.subject ||
    activeRegion?.domainProfile?.terminology?.subject ||
    (isEcommerce ? "涉事商品/SKU/店铺" : "涉事主体/商户");

  const addressLabel = isEcommerce ? "订单号 / 收货地或仓库" : "事发详细地址";

  const categories =
    options?.categories && options.categories.length > 0
      ? options.categories
      : options?.domainProfile?.categories && options.domainProfile.categories.length > 0
        ? options.domainProfile.categories
        : isEcommerce
          ? DEFAULT_ECOM_CATEGORIES
          : DEFAULT_GOV_CATEGORIES;

  const subdistricts =
    options?.subdistricts && options.subdistricts.length > 0
      ? options.subdistricts
      : options?.channels && options.channels.length > 0
        ? options.channels
        : activeRegion?.domainProfile?.channels || [];

  // ----------------- 表单状态与交互后校验 -----------------
  const [formValues, setFormValues] = useState<IntakeDraft>(EMPTY_DRAFT);
  const [interacted, setInteracted] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [receipt, setReceipt] = useState<SubmitReceipt | null>(null);

  const categoryRef = useRef<HTMLSelectElement>(null);
  const subdistrictRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const validateFormField = useCallback(
    (name: keyof IntakeDraft, value: string): string => {
      const trimmed = value.trim();
      if (name === "category" && !trimmed) {
        return "请选择所属投诉分类";
      }
      if (name === "subdistrict" && !trimmed) {
        return `请填写或选择${regionUnitLabel}`;
      }
      if (name === "content") {
        if (!trimmed) return "请填写投诉详细内容";
        if (trimmed.length < 6) return "详细内容至少需要 6 个字，请补充关键经过";
      }
      if (name === "contactPhone" && !isValidPhoneIfPresent(value)) {
        return "请输入 11 位手机号码或区号座机（也可留空）";
      }
      return "";
    },
    [regionUnitLabel]
  );

  const updateFormField = (name: keyof IntakeDraft, value: string) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) {
      const nextErr = validateFormField(name, value);
      if (!nextErr) {
        setFieldErrors((prev) => ({ ...prev, [name]: "" }));
        setLiveAnnouncement("");
      }
    }
  };

  const handleFieldBlur = (
    name: keyof IntakeDraft,
    el?: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
  ) => {
    setInteracted((prev) => ({ ...prev, [name]: true }));
    const err = validateFormField(name, formValues[name]);
    if (el && "setCustomValidity" in el) {
      el.setCustomValidity(err);
    }
    setFieldErrors((prev) => ({ ...prev, [name]: err }));
    if (err) {
      scheduleAnnouncement(err);
    }
  };

  // ----------------- 语音 Agent & 对话状态 -----------------
  const stageRef = useRef<XiaochunStageHandle>(null);
  const [voiceMessages, setVoiceMessages] = useState<ChatMessage[]>([]);
  const [voiceDraft, setVoiceDraft] = useState<IntakeDraft>(EMPTY_DRAFT);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [readyToSubmit, setReadyToSubmit] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatPending, setChatPending] = useState<boolean>(false);
  const chatLogRef = useRef<HTMLDivElement>(null);

  // 初始化欢迎词随业务域变化
  useEffect(() => {
    setVoiceMessages([
      {
        id: "welcome",
        role: "assistant",
        content: isEcommerce
          ? "您好，我是售后客诉专员小蠢。请直接点击语音按钮或下方快捷场景告诉我您遇到的订单/商品问题，我会自动帮您提取要素生成客诉单。"
          : "您好，我是民声语音受理专员小蠢。请点击语音按钮或直接输入您要反映的情况，我会自动核对镇街、地点与诉求内容。",
      },
    ]);
  }, [isEcommerce, activeRegion?.id]);

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [voiceMessages]);

  // ----------------- 我的投诉进度 -----------------
  const [myTickets, setMyTickets] = useState<MyTicketItem[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState<boolean>(false);
  const [historyOpen, setHistoryOpen] = useState<boolean>(true);
  const [reopenTargetId, setReopenTargetId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState<string>("");
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const regionQuery = activeRegion?.id ? `?region=${encodeURIComponent(activeRegion.id)}` : "";

  const fetchOptions = useCallback(async () => {
    try {
      setOptionsLoading(true);
      const res = await fetch(`/api/intake/options${regionQuery}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as IntakeOptionsResponse;
      if (data) {
        setOptions(data);
      }
    } catch {
      // ignore
    } finally {
      setOptionsLoading(false);
    }
  }, [regionQuery]);

  const fetchMyTickets = useCallback(async () => {
    try {
      setTicketsLoading(true);
      const res = await fetch(`/api/intake/my-tickets${regionQuery}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { success?: boolean; tickets?: MyTicketItem[] };
      if (Array.isArray(data.tickets)) {
        setMyTickets(data.tickets);
      }
    } catch {
      // ignore
    } finally {
      setTicketsLoading(false);
    }
  }, [regionQuery]);

  useEffect(() => {
    void fetchOptions();
    void fetchMyTickets();
  }, [fetchOptions, fetchMyTickets]);

  // ----------------- 提交逻辑（Tab 1 & Tab 2 共用） -----------------
  const submitPayload = async (payload: IntakeDraft, source: "FORM" | "AGENT_VOICE") => {
    try {
      setSubmitting(true);
      const res = await fetch(`/api/intake/submit${regionQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: payload.title.trim() || undefined,
          content: payload.content.trim(),
          subdistrict: payload.subdistrict.trim(),
          category: payload.category.trim(),
          subject: payload.subject.trim() || undefined,
          address: payload.address.trim() || undefined,
          contactPhone: payload.contactPhone.trim() || undefined,
          source,
        }),
      });
      const data = (await res.json()) as SubmitReceipt & { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        const msg = data.error || "提交失败，请检查填写内容后重试";
        toast.error(msg);
        scheduleAnnouncement(msg);
        return false;
      }

      setReceipt({
        ticketId: data.ticketId,
        ticketNo: data.ticketNo,
        status: data.status || "PENDING",
        urgency: data.urgency || "NORMAL",
        slaHours: data.slaHours,
        maskedPreview: data.maskedPreview,
      });
      toast.success(`投诉已成功受理，回执单号：${data.ticketNo}`);
      setLiveAnnouncement(`投诉提交成功，回执单号 ${data.ticketNo}`);
      setHistoryOpen(true);
      void fetchMyTickets();

      if (source === "FORM") {
        setFormValues(EMPTY_DRAFT);
        setInteracted({});
        setFieldErrors({});
      } else {
        setVoiceDraft(EMPTY_DRAFT);
        setMissingFields([]);
        setReadyToSubmit(false);
        const ackText = `已为您正式受理并生成工单，回执单号为 ${data.ticketNo}，您可在下方我的投诉进度中实时跟踪。`;
        setVoiceMessages((prev) => [
          ...prev,
          { id: `ack-${Date.now()}`, role: "assistant", content: ackText },
        ]);
        void stageRef.current?.say(ackText);
      }
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "网络异常，提交失败";
      toast.error(msg);
      scheduleAnnouncement(msg);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const errs: Record<string, string> = {
      category: validateFormField("category", formValues.category),
      subdistrict: validateFormField("subdistrict", formValues.subdistrict),
      content: validateFormField("content", formValues.content),
      contactPhone: validateFormField("contactPhone", formValues.contactPhone),
    };

    categoryRef.current?.setCustomValidity(errs.category);
    subdistrictRef.current?.setCustomValidity(errs.subdistrict);
    contentRef.current?.setCustomValidity(errs.content);
    phoneRef.current?.setCustomValidity(errs.contactPhone);

    setInteracted({
      category: true,
      subdistrict: true,
      content: true,
      contactPhone: true,
    });
    setFieldErrors(errs);

    const firstKey = (["category", "subdistrict", "content", "contactPhone"] as const).find(
      (k) => Boolean(errs[k])
    );
    if (firstKey) {
      const msg = errs[firstKey];
      setLiveAnnouncement(`表单校验未通过：${msg}`);
      if (firstKey === "category") categoryRef.current?.focus();
      else if (firstKey === "subdistrict") subdistrictRef.current?.focus();
      else if (firstKey === "content") contentRef.current?.focus();
      else if (firstKey === "contactPhone") phoneRef.current?.focus();
      return;
    }

    await submitPayload(formValues, "FORM");
  };

  // ----------------- 语音对话发送 -----------------
  const sendVoiceTurn = useCallback(
    async (rawText: string) => {
      const clean = rawText.trim();
      if (!clean || chatPending) return;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: clean,
      };
      const nextHistory = [...voiceMessages, userMsg];
      setVoiceMessages(nextHistory);
      setChatInput("");
      setChatPending(true);

      try {
        const res = await fetch(`/api/intake/chat${regionQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextHistory.map((m) => ({ role: m.role, content: m.content })),
            draft: voiceDraft,
          }),
        });
        const data = (await res.json()) as {
          success?: boolean;
          reply?: string;
          draft?: Partial<IntakeDraft>;
          missingFields?: string[];
          readyToSubmit?: boolean;
          error?: string;
        };

        if (!res.ok || !data.success) {
          const msg = data.error || "智能受理暂时繁忙，请稍后重试或切换表单提交";
          toast.error(msg);
          return;
        }

        const mergedDraft: IntakeDraft = {
          title: data.draft?.title ?? voiceDraft.title,
          content: data.draft?.content ?? voiceDraft.content,
          subdistrict: data.draft?.subdistrict ?? voiceDraft.subdistrict,
          category: data.draft?.category ?? voiceDraft.category,
          subject: data.draft?.subject ?? voiceDraft.subject,
          address: data.draft?.address ?? voiceDraft.address,
          contactPhone: data.draft?.contactPhone ?? voiceDraft.contactPhone,
        };
        setVoiceDraft(mergedDraft);
        setMissingFields(Array.isArray(data.missingFields) ? data.missingFields : []);
        setReadyToSubmit(Boolean(data.readyToSubmit));

        const replyText =
          data.reply || "已记录您的问题，请核对下方提取的投诉要素，确认无误即可提交。";
        setVoiceMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", content: replyText },
        ]);
        void stageRef.current?.say(replyText);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "对话请求失败");
      } finally {
        setChatPending(false);
      }
    },
    [chatPending, regionQuery, voiceDraft, voiceMessages]
  );

  const asr = useStreamAsr({
    onFinalResult: (text) => {
      void sendVoiceTurn(text);
    },
  });

  const handleVoiceToggle = async () => {
    if (asr.isRecording) {
      asr.stop();
    } else {
      await asr.start();
    }
  };

  const handleVoiceTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      void sendVoiceTurn(chatInput);
    }
  };

  const handleVoiceChatFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendVoiceTurn(chatInput);
  };

  const handleVoiceDraftSubmit = async () => {
    const missing: string[] = [];
    if (voiceDraft.content.trim().length < 6) missing.push("至少 6 字投诉内容");
    if (!voiceDraft.category.trim()) missing.push("所属分类");
    if (!voiceDraft.subdistrict.trim()) missing.push(regionUnitLabel);

    if (missing.length > 0) {
      const msg = `请先补充：${missing.join("、")}（可继续语音或文字对话，或点击同步到表单微调）`;
      toast.error(msg);
      scheduleAnnouncement(msg);
      return;
    }
    await submitPayload(voiceDraft, "AGENT_VOICE");
  };

  // ----------------- 重开投诉 -----------------
  const handleConfirmReopen = async (ticketId: string) => {
    try {
      setReopeningId(ticketId);
      const res = await fetch(`/api/intake/my-tickets/${encodeURIComponent(ticketId)}/reopen${regionQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reopenReason.trim() || "问题仍未彻底解决，申请重新核查处理",
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string; ticketNo?: string };
      if (!res.ok || !data.success) {
        toast.error(data.error || "申请重开失败，请稍后重试");
        return;
      }
      toast.success(`工单 ${data.ticketNo || ""} 已重开，系统将重新督办核查`);
      setReopenTargetId(null);
      setReopenReason("");
      void fetchMyTickets();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "网络异常，申请重开失败");
    } finally {
      setReopeningId(null);
    }
  };

  // ----------------- Mode Tabs 键盘交互 -----------------
  const switchMode = (next: SubmitMode, focusTab = false) => {
    setMode(next);
    if (focusTab) {
      requestAnimationFrame(() => {
        if (next === "form") formTabRef.current?.focus();
        else voiceTabRef.current?.focus();
      });
    }
  };

  const handleTabListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (e.key === "Home") {
        switchMode("form", true);
        return;
      }
      if (e.key === "End") {
        switchMode("voice", true);
        return;
      }
      switchMode(mode === "form" ? "voice" : "form", true);
    }
  };

  const quickVoiceDemos = isEcommerce
    ? [
        {
          label: "示例 1：残缺诉求（触发追问 SKU/渠道）",
          text: "我买的生鲜礼盒拆开全化冻发臭了，客服一直不理人",
        },
        {
          label: "示例 2：完整诉求（自动填单）",
          text: "在天猫旗舰店买的SKU-GD2026-881冷链礼盒从华南冷链仓发出，收货化冻变质发臭要求退款赔付，电话13912345678",
        },
      ]
    : [
        {
          label: "示例 1：残缺诉求（触发追问地点）",
          text: "天河这边晚上老有烧烤油烟吵得睡不着",
        },
        {
          label: "示例 2：完整诉求（自动填单）",
          text: "天河南街道天河南一路88号老广烧烤档，每天晚上11点到凌晨2点油烟排风噪音严重扰民，联系电话13800138000",
        },
      ];

  return (
    <div className="submit-shell">
      {/* 页面级单一礼貌播报区 */}
      <div className="visually-hidden" aria-live="polite">
        {liveAnnouncement}
      </div>

      {/* 极简页头 */}
      <header className="submit-header">
        <div className="submit-header__eyebrow">
          <ShieldCheck size={14} aria-hidden="true" />
          <span>
            {activeRegion ? `${activeRegion.city} · ${activeRegion.name}` : "在线受理服务台"}
          </span>
        </div>
        <h1 className="submit-header__title">
          {isEcommerce ? "售后客诉提交与进度追踪" : "民生诉求提交与进度追踪"}
        </h1>
        <p className="submit-header__sub">
          {isEcommerce
            ? "支持自主填写或语音向「小蠢」反映订单与商品问题，自动脱敏建单并跟踪处理闭环。"
            : "支持自主填写或语音向「小蠢」反映身边问题，自动脱敏分派并实时追踪办理结果。"}
        </p>
      </header>

      {/* 提交成功回执卡 */}
      {receipt ? (
        <section
          aria-label="受理回执"
          className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 text-slate-900"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-emerald-900">
                  {isEcommerce ? "客诉已受理建单" : "诉求已受理分派"} · 回执单号{" "}
                  <span className="font-mono tabular-nums">{receipt.ticketNo}</span>
                </div>
                <div className="mt-1 text-xs text-emerald-800 flex flex-wrap gap-x-3 gap-y-1">
                  <span>状态：{STATUS_LABELS[receipt.status] || receipt.status}</span>
                  <span>
                    紧急度：{URGENCY_LABELS[receipt.urgency] || receipt.urgency}
                  </span>
                  {receipt.slaHours ? (
                    <span className="tabular-nums">承诺响应：{receipt.slaHours} 小时内</span>
                  ) : null}
                </div>
                {receipt.maskedPreview ? (
                  <p className="mt-1.5 text-xs text-slate-700 bg-white/80 rounded-md px-2.5 py-1.5 border border-emerald-200/70">
                    隐私脱敏摘要：{receipt.maskedPreview}
                  </p>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReceipt(null)}
              className="shrink-0 rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 cursor-pointer"
            >
              继续提交
            </button>
          </div>
        </section>
      ) : null}

      {/* 主操作卡片：二选一 Mode Tabs */}
      <section className="submit-card" aria-label="投诉提交工作台">
        <div
          role="tablist"
          aria-label="投诉提交方式"
          className="submit-tablist"
          onKeyDown={handleTabListKeyDown}
        >
          <button
            ref={formTabRef}
            type="button"
            role="tab"
            id="tab-form"
            aria-selected={mode === "form"}
            tabIndex={mode === "form" ? 0 : -1}
            onClick={() => switchMode("form")}
            className="submit-tab"
          >
            <FileText size={16} aria-hidden="true" />
            <span>基础表单填报</span>
          </button>

          <button
            ref={voiceTabRef}
            type="button"
            role="tab"
            id="tab-voice"
            aria-selected={mode === "voice"}
            tabIndex={mode === "voice" ? 0 : -1}
            onClick={() => switchMode("voice")}
            className="submit-tab"
          >
            <Sparkles size={16} aria-hidden="true" />
            <span>Agent 语音受理（小蠢）</span>
          </button>
        </div>

        {/* Tab 1: 基础表单填报 */}
        <div role="tabpanel" aria-labelledby="tab-form" hidden={mode !== "form"}>
          <div className="submit-panel-body">
            <form
              noValidate
              onSubmit={handleFormSubmit}
              aria-labelledby="tab-form"
              className="submit-form"
            >
              <div className="submit-field">
                <label htmlFor="submit-category" className="submit-label">
                  所属分类 <span className="submit-required-mark" aria-hidden="true">*</span>
                </label>
                <span id="submit-category-hint" className="submit-hint">
                  {optionsLoading ? "正在加载分类选项..." : "请选择最贴近您诉求的问题分类"}
                </span>
                <select
                  ref={categoryRef}
                  id="submit-category"
                  name="category"
                  required
                  value={formValues.category}
                  onChange={(e) => {
                    e.currentTarget.setCustomValidity("");
                    updateFormField("category", e.target.value);
                  }}
                  onBlur={(e) => handleFieldBlur("category", e.currentTarget)}
                  aria-invalid={Boolean(interacted.category && fieldErrors.category)}
                  aria-describedby={
                    interacted.category && fieldErrors.category
                      ? "submit-category-hint submit-category-error"
                      : "submit-category-hint"
                  }
                  className={`submit-control${
                    interacted.category && fieldErrors.category ? " user-invalid-fallback" : ""
                  }`}
                >
                  <option value="">请选择投诉分类</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <div
                  id="submit-category-error"
                  className={`submit-error${
                    interacted.category && fieldErrors.category ? " is-visible" : ""
                  }`}
                >
                  <AlertCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{fieldErrors.category || "请选择所属投诉分类"}</span>
                </div>
              </div>

              <div className="submit-field">
                <label htmlFor="submit-subdistrict" className="submit-label">
                  {regionUnitLabel} <span className="submit-required-mark" aria-hidden="true">*</span>
                </label>
                <span id="submit-subdistrict-hint" className="submit-hint">
                  {isEcommerce
                    ? "可从下拉推荐选择店铺/仓库，或直接输入购买渠道"
                    : "可从下拉推荐选择所属镇街，或直接输入具体街道名称"}
                </span>
                <input
                  ref={subdistrictRef}
                  id="submit-subdistrict"
                  name="subdistrict"
                  type="text"
                  list={datalistId}
                  required
                  value={formValues.subdistrict}
                  onChange={(e) => {
                    e.currentTarget.setCustomValidity("");
                    updateFormField("subdistrict", e.target.value);
                  }}
                  onBlur={(e) => handleFieldBlur("subdistrict", e.currentTarget)}
                  placeholder={isEcommerce ? "例如：天猫旗舰店 / 华南冷链仓" : "例如：天河南街道"}
                  autoComplete="off"
                  enterKeyHint="next"
                  aria-invalid={Boolean(interacted.subdistrict && fieldErrors.subdistrict)}
                  aria-describedby={
                    interacted.subdistrict && fieldErrors.subdistrict
                      ? "submit-subdistrict-hint submit-subdistrict-error"
                      : "submit-subdistrict-hint"
                  }
                  className={`submit-control${
                    interacted.subdistrict && fieldErrors.subdistrict
                      ? " user-invalid-fallback"
                      : ""
                  }`}
                />
                <datalist id={datalistId}>
                  {subdistricts.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                <div
                  id="submit-subdistrict-error"
                  className={`submit-error${
                    interacted.subdistrict && fieldErrors.subdistrict ? " is-visible" : ""
                  }`}
                >
                  <AlertCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{fieldErrors.subdistrict || `请填写${regionUnitLabel}`}</span>
                </div>
              </div>

              <div className="submit-field">
                <label htmlFor="submit-title" className="submit-label">
                  诉求简述（选填）
                </label>
                <span id="submit-title-hint" className="submit-hint">
                  一句话概括核心诉求，留空将自动从详情生成
                </span>
                <input
                  id="submit-title"
                  name="title"
                  type="text"
                  maxLength={80}
                  value={formValues.title}
                  onChange={(e) => updateFormField("title", e.target.value)}
                  placeholder={
                    isEcommerce
                      ? "例如：冷链生鲜礼盒化冻发臭申请退款赔付"
                      : "例如：夜间餐饮油烟及排风噪音扰民"
                  }
                  enterKeyHint="next"
                  aria-invalid="false"
                  aria-describedby="submit-title-hint"
                  className="submit-control"
                />
              </div>

              <div className="submit-field">
                <label htmlFor="submit-content" className="submit-label">
                  投诉详细内容 <span className="submit-required-mark" aria-hidden="true">*</span>
                </label>
                <span id="submit-content-hint" className="submit-hint">
                  至少 6 个字，建议写明发生时间、具体地点或订单商品情况以及您的核心诉求
                </span>
                <textarea
                  ref={contentRef}
                  id="submit-content"
                  name="content"
                  required
                  minLength={6}
                  rows={4}
                  value={formValues.content}
                  onChange={(e) => {
                    e.currentTarget.setCustomValidity("");
                    updateFormField("content", e.target.value);
                  }}
                  onBlur={(e) => handleFieldBlur("content", e.currentTarget)}
                  placeholder={
                    isEcommerce
                      ? "请详细描述订单商品问题、沟通经过与期望赔付或退换方案..."
                      : "请详细描述事发时间、具体路段门牌、影响情况与期望解决方式..."
                  }
                  aria-invalid={Boolean(interacted.content && fieldErrors.content)}
                  aria-describedby={
                    interacted.content && fieldErrors.content
                      ? "submit-content-hint submit-content-error"
                      : "submit-content-hint"
                  }
                  className={`submit-control submit-control--textarea${
                    interacted.content && fieldErrors.content ? " user-invalid-fallback" : ""
                  }`}
                />
                <div
                  id="submit-content-error"
                  className={`submit-error${
                    interacted.content && fieldErrors.content ? " is-visible" : ""
                  }`}
                >
                  <AlertCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{fieldErrors.content || "请填写至少 6 个字的详细内容"}</span>
                </div>
              </div>

              <div className="submit-field">
                <label htmlFor="submit-subject" className="submit-label">
                  {subjectLabel}（选填）
                </label>
                <span id="submit-subject-hint" className="submit-hint">
                  {isEcommerce ? "如有商品 SKU 编码、店铺名称可一并填写" : "如有具体商户、楼盘或施工单位名称可一并填写"}
                </span>
                <input
                  id="submit-subject"
                  name="subject"
                  type="text"
                  value={formValues.subject}
                  onChange={(e) => updateFormField("subject", e.target.value)}
                  placeholder={isEcommerce ? "例如：SKU-GD2026-881 生鲜礼盒" : "例如：老广烧烤档"}
                  enterKeyHint="next"
                  aria-invalid="false"
                  aria-describedby="submit-subject-hint"
                  className="submit-control"
                />
              </div>

              <div className="submit-field">
                <label htmlFor="submit-address" className="submit-label">
                  {addressLabel}（选填）
                </label>
                <span id="submit-address-hint" className="submit-hint">
                  {isEcommerce ? "可填写订单号、发货仓或收货城市区县" : "精准路名门牌有助于快速派单核查"}
                </span>
                <input
                  id="submit-address"
                  name="address"
                  type="text"
                  autoComplete="street-address"
                  value={formValues.address}
                  onChange={(e) => updateFormField("address", e.target.value)}
                  placeholder={
                    isEcommerce ? "例如：订单 202611200081 / 广州市天河区" : "例如：天河南一路 88 号"
                  }
                  enterKeyHint="next"
                  aria-invalid="false"
                  aria-describedby="submit-address-hint"
                  className="submit-control"
                />
              </div>

              <div className="submit-field">
                <label htmlFor="submit-phone" className="submit-label">
                  联系电话（选填）
                </label>
                <span id="submit-phone-hint" className="submit-hint">
                  11 位手机号或区号座机；系统入库将进行隐私气隙脱敏保护
                </span>
                <input
                  ref={phoneRef}
                  id="submit-phone"
                  name="contactPhone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={formValues.contactPhone}
                  onChange={(e) => {
                    e.currentTarget.setCustomValidity("");
                    updateFormField("contactPhone", e.target.value);
                  }}
                  onBlur={(e) => handleFieldBlur("contactPhone", e.currentTarget)}
                  placeholder="例如：13800138000"
                  enterKeyHint="done"
                  aria-invalid={Boolean(interacted.contactPhone && fieldErrors.contactPhone)}
                  aria-describedby={
                    interacted.contactPhone && fieldErrors.contactPhone
                      ? "submit-phone-hint submit-phone-error"
                      : "submit-phone-hint"
                  }
                  className={`submit-control${
                    interacted.contactPhone && fieldErrors.contactPhone
                      ? " user-invalid-fallback"
                      : ""
                  }`}
                />
                <div
                  id="submit-phone-error"
                  className={`submit-error${
                    interacted.contactPhone && fieldErrors.contactPhone ? " is-visible" : ""
                  }`}
                >
                  <AlertCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{fieldErrors.contactPhone || "请输入有效的电话号码"}</span>
                </div>
              </div>

              <button type="submit" disabled={submitting} className="submit-btn-primary">
                {submitting ? "正在提交并脱敏建单..." : "提交投诉"}
              </button>
            </form>
          </div>
        </div>

        {/* Tab 2: Agent 语音受理（小蠢 + Stream ASR） */}
        <div role="tabpanel" aria-labelledby="tab-voice" hidden={mode !== "voice"}>
          <div className="submit-panel-body">
            <div className="voice-layout">
              {/* 小蠢 3D 舞台 */}
              <div className="voice-stage-col">
                <XiaochunStage
                  ref={stageRef}
                  title={isEcommerce ? "售后客诉专员 · 小蠢" : "民声语音受理专员 · 小蠢"}
                  subtitle={isEcommerce ? "智能识别订单/SKU与退款诉求" : "智能识别镇街/地点与民声诉求"}
                  width={260}
                  height={330}
                  lazy="click"
                  scene="light"
                  outfit="xiaochun_office_lady"
                />
              </div>

              {/* 语音控制 + 对话流 + 辅助输入框 */}
              <div className="voice-control-col">
                <div>
                  <button
                    type="button"
                    onClick={() => void handleVoiceToggle()}
                    aria-pressed={asr.isRecording}
                    className={`voice-record-btn${asr.isRecording ? " is-recording" : ""}`}
                  >
                    {asr.isRecording ? (
                      <>
                        <MicOff size={18} aria-hidden="true" />
                        <span>点击停止录音并发送</span>
                      </>
                    ) : (
                      <>
                        <Mic size={18} aria-hidden="true" />
                        <span>
                          {asr.status === "downloading"
                            ? `正在准备语音模型 (${asr.downloadPercent}%)`
                            : asr.status === "initializing"
                              ? "正在初始化麦克风..."
                              : "点击开始语音投诉"}
                        </span>
                      </>
                    )}
                  </button>

                  {/* 语音引擎状态与实时音量/中间字 */}
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{asr.statusHint}</span>
                      <span className="shrink-0 font-mono text-[11px] text-slate-500">
                        {asr.backend === "stream-asr"
                          ? "Stream-ASR"
                          : asr.backend === "web-speech"
                            ? "Web Speech"
                            : "待命"}
                      </span>
                    </div>

                    {asr.status === "downloading" ? (
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full bg-blue-600 transition-all"
                          style={{ width: `${asr.downloadPercent}%` }}
                        />
                      </div>
                    ) : null}

                    {asr.isRecording ? (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-500 shrink-0">
                            VAD: {asr.vadState}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full bg-emerald-500 transition-all duration-75"
                              style={{ width: `${Math.round(asr.audioLevel * 100)}%` }}
                            />
                          </div>
                        </div>
                        {asr.interimText ? (
                          <div className="text-slate-800 bg-white rounded px-2 py-1 border border-slate-200">
                            实时识别：{asr.interimText}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {asr.error ? (
                      <p className="mt-1.5 text-red-600 font-medium">{asr.error}</p>
                    ) : null}
                  </div>
                </div>

                {/* 动态双域快捷演示语音文本 */}
                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-1.5">
                    无麦快捷演示语音（一键模拟口述）：
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {quickVoiceDemos.map((demo) => (
                      <button
                        key={demo.label}
                        type="button"
                        disabled={chatPending}
                        onClick={() => void sendVoiceTurn(demo.text)}
                        className="w-full min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 hover:border-blue-400 hover:bg-blue-50/60 transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <div className="font-semibold text-blue-700">{demo.label}</div>
                        <div className="mt-0.5 text-slate-600 line-clamp-2">{demo.text}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 对话气泡记录 */}
                <div
                  ref={chatLogRef}
                  className="voice-chat-log"
                  aria-label="语音受理对话记录"
                >
                  {voiceMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`voice-msg ${
                        msg.role === "user" ? "voice-msg--user" : "voice-msg--assistant"
                      }`}
                    >
                      {msg.content}
                    </div>
                  ))}
                  {chatPending ? (
                    <div className="voice-msg voice-msg--assistant text-slate-500">
                      小蠢正在整理投诉要素...
                    </div>
                  ) : null}
                </div>

                {/* 辅助文字输入框（严格 IME 安全回车） */}
                <form onSubmit={handleVoiceChatFormSubmit} className="space-y-2">
                  <label
                    htmlFor="voice-chat-input"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    辅助文字补充（Enter 发送，Shift+Enter 换行）
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <textarea
                      id="voice-chat-input"
                      rows={2}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={handleVoiceTextareaKeyDown}
                      placeholder="补充地点、订单号或具体问题..."
                      className="submit-control min-h-[48px] flex-1 !py-2.5"
                    />
                    <button
                      type="submit"
                      disabled={chatPending}
                      className="submit-btn-primary sm:w-28 shrink-0"
                    >
                      <Send size={15} aria-hidden="true" />
                      <span>发送</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* 实时抽取投诉草稿摘要 */}
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    实时抽取的投诉草稿摘要
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {readyToSubmit
                      ? "核心要素已齐全，可直接确认提交。"
                      : missingFields.length > 0
                        ? `待补充要素：${missingFields.join("、")}`
                        : "开始语音或文字描述后，系统将自动提取关键信息。"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFormValues((prev) => ({
                      title: voiceDraft.title || prev.title,
                      content: voiceDraft.content || prev.content,
                      subdistrict: voiceDraft.subdistrict || prev.subdistrict,
                      category: voiceDraft.category || prev.category,
                      subject: voiceDraft.subject || prev.subject,
                      address: voiceDraft.address || prev.address,
                      contactPhone: voiceDraft.contactPhone || prev.contactPhone,
                    }));
                    switchMode("form", true);
                    toast.info("已将草稿同步至表单，可进一步细化修改");
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  同步到表单微调
                </button>
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-white border border-slate-200/80 p-2.5">
                  <dt className="text-slate-500">所属分类</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {voiceDraft.category || "待识别"}
                  </dd>
                </div>
                <div className="rounded-lg bg-white border border-slate-200/80 p-2.5">
                  <dt className="text-slate-500">{regionUnitLabel}</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {voiceDraft.subdistrict || "待识别"}
                  </dd>
                </div>
                <div className="rounded-lg bg-white border border-slate-200/80 p-2.5">
                  <dt className="text-slate-500">{subjectLabel}</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {voiceDraft.subject || "未提及"}
                  </dd>
                </div>
                <div className="rounded-lg bg-white border border-slate-200/80 p-2.5">
                  <dt className="text-slate-500">{addressLabel}</dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {voiceDraft.address || "未提及"}
                  </dd>
                </div>
                <div className="rounded-lg bg-white border border-slate-200/80 p-2.5 sm:col-span-2">
                  <dt className="text-slate-500">诉求内容摘要</dt>
                  <dd className="mt-1 font-medium text-slate-900 whitespace-pre-wrap">
                    {voiceDraft.content || "等待语音或文字输入..."}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleVoiceDraftSubmit()}
                  className="submit-btn-primary flex-1"
                >
                  <CheckCircle2 size={17} aria-hidden="true" />
                  <span>{submitting ? "正在提交投诉..." : "一键确认提交投诉"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 底部轻量化折叠「我的投诉进度」 */}
      <details
        className="submit-history-details"
        open={historyOpen}
        onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
      >
        <summary className="submit-history-summary">
          <span className="inline-flex items-center gap-2">
            <span>我的投诉进度</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 tabular-nums">
              {myTickets.length}
            </span>
          </span>
          <ChevronDown
            size={18}
            className={`text-slate-500 transition-transform ${historyOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </summary>

        <div className="border-t border-slate-200/80 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">
              仅展示您本人在当前站点的投诉记录与办理回执
            </span>
            <button
              type="button"
              onClick={() => void fetchMyTickets()}
              disabled={ticketsLoading}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw size={13} className={ticketsLoading ? "animate-spin" : ""} aria-hidden="true" />
              <span>刷新</span>
            </button>
          </div>

          {ticketsLoading && myTickets.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">正在加载您的投诉记录...</div>
          ) : myTickets.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">
              暂无本人提交的投诉记录，可在上方提交您的第一条诉求。
            </div>
          ) : (
            <ul className="space-y-3">
              {myTickets.map((ticket) => {
                const resolved = isTicketResolved(ticket);
                const reopened =
                  ticket.isFakeClosure ||
                  ticket.status === "REOPENED" ||
                  ticket.closureStatus === "REOPENED";
                const statusLabel = reopened
                  ? "已重开核查"
                  : STATUS_LABELS[ticket.status] || ticket.status;
                const latestLogText = formatLatestLog(ticket.latestLog);

                return (
                  <li
                    key={ticket.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
                          {ticket.ticketNo}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                            reopened
                              ? "bg-amber-100 text-amber-800"
                              : resolved
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {statusLabel}
                        </span>
                        {ticket.category ? (
                          <span className="text-xs text-slate-600">{ticket.category}</span>
                        ) : null}
                        {ticket.subdistrict ? (
                          <span className="text-xs text-slate-500">· {ticket.subdistrict}</span>
                        ) : null}
                      </div>
                      <time className="text-xs text-slate-400 tabular-nums">
                        {ticket.createdAt ? new Date(ticket.createdAt).toLocaleString("zh-CN") : ""}
                      </time>
                    </div>

                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {ticket.title || ticket.content}
                    </p>
                    {ticket.title && ticket.content !== ticket.title ? (
                      <p className="mt-1 text-xs text-slate-600 line-clamp-2">{ticket.content}</p>
                    ) : null}

                    {ticket.themeTitle || latestLogText ? (
                      <div className="mt-2 flex flex-col gap-1 text-xs text-slate-600">
                        {ticket.themeTitle ? (
                          <span>归属多频专题：{ticket.themeTitle}</span>
                        ) : null}
                        {latestLogText ? <span>最新进度：{latestLogText}</span> : null}
                      </div>
                    ) : null}

                    {resolved ? (
                      <div className="mt-3 pt-2.5 border-t border-slate-200/80">
                        {reopenTargetId === ticket.id ? (
                          <div className="space-y-2">
                            <label
                              htmlFor={`reopen-reason-${ticket.id}`}
                              className="block text-xs font-medium text-slate-700"
                            >
                              请说明未解决原因（选填）
                            </label>
                            <input
                              id={`reopen-reason-${ticket.id}`}
                              type="text"
                              value={reopenReason}
                              onChange={(e) => setReopenReason(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                                  void handleConfirmReopen(ticket.id);
                                }
                              }}
                              placeholder="例如：夜间噪音依旧反复出现，尚未实质整改"
                              className="submit-control !min-h-[44px]"
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={reopeningId === ticket.id}
                                onClick={() => void handleConfirmReopen(ticket.id)}
                                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 cursor-pointer disabled:opacity-60"
                              >
                                <RotateCcw size={13} aria-hidden="true" />
                                <span>
                                  {reopeningId === ticket.id ? "正在提交..." : "确认申请重开"}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setReopenTargetId(null);
                                  setReopenReason("");
                                }}
                                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setReopenTargetId(ticket.id);
                              setReopenReason("");
                            }}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 cursor-pointer"
                          >
                            <RotateCcw size={13} aria-hidden="true" />
                            <span>问题未解决 · 申请重开核查</span>
                          </button>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
