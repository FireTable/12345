"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  AlertCircle,
  FileText,
  Sparkles,
  RefreshCw,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { fmtNum } from "@/lib/format-number";
import { useRegion } from "@/app/_components/civic/region-context";
import { VoiceChatComposer } from "@/app/_components/civic/voice-chat-composer";
import { appendRecognizedText, useStreamAsr } from "@/app/_hooks/use-stream-asr";
import {
  XiaochunStage,
  type XiaochunStageHandle,
} from "@/app/_components/agent/xiaochun-stage";
import { useAuthRole } from "@/lib/auth/use-role";
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
  contactEmail: string;
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
  contactEmail: "",
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
  PENDING: "待派单",
  DISPATCHED: "已派单",
  IN_PROGRESS: "处理中",
  PROCESSING: "处理中",
  RESOLVED: "已办结",
  CLOSED: "已办结",
  FINISHED: "已办结",
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
  UPDATE_STATUS: "状态变更",
  CORRECT_ENTITY: "信息补全",
  DETACH_THEME: "移出群组",
  DETACH_TICKET: "移出群组",
  REVIEW_APPROVE: "复核通过",
  REVIEW_DISMISS: "复核忽略",
};

const LOG_TASK_TYPE_LABELS: Record<string, string> = {
  MISSING_INFO: "要素补全",
  REOPEN_CALLBACK: "满意度回访",
  SLA_OVERDUE: "超期催办",
  REDLINE_BLOCK: "红线熔断",
};

function formatSubmitLogNote(note: string): string {
  return note
    .replace(
      /工单状态变更为\s+(PENDING|DISPATCHED|IN_PROGRESS|PROCESSING|RESOLVED|CLOSED|FINISHED|REOPENED)\b/g,
      (_full, code: string) => `工单状态变更为「${STATUS_LABELS[code] || code}」`
    )
    .replace(
      /\b(MISSING_INFO|REOPEN_CALLBACK|SLA_OVERDUE|REDLINE_BLOCK)\b/g,
      (code: string) => LOG_TASK_TYPE_LABELS[code] || code
    )
    .replace(/\baddress=/g, "具体地址=")
    .replace(/\bcanonicalSubject=/g, "涉事主体=")
    .replace(/\bsubdistrict=/g, "所属镇街=");
}

function formatLatestLog(log: CitizenTicketLogDto | string | null | undefined): string | null {
  if (!log) return null;
  if (typeof log === "string") return formatSubmitLogNote(log);
  const actionKey = (log.action || "").trim().toUpperCase();
  const actionLabel = LOG_ACTION_LABELS[actionKey] || log.action;
  const parts = [actionLabel];
  if (log.note) {
    parts.push(formatSubmitLogNote(log.note));
  } else if (log.toStatus) {
    const toKey = log.toStatus.trim().toUpperCase();
    parts.push(STATUS_LABELS[toKey] || log.toStatus);
  }
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

function normalizePhoneInput(value: string): {
  normalized: string;
  isValid: boolean;
} {
  const trimmed = value.trim();
  if (!trimmed) return { normalized: "", isValid: false };
  const asciiPhone = trimmed
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[－—–﹣]/g, "-")
    .replace(/＋/g, "+");
  const strippedPrefixPhone = asciiPhone.replace(/^(?:\+|00)86[\s-]*/, "");
  const compactMobile = strippedPrefixPhone.replace(/[\s-]/g, "");
  const compactLandline = strippedPrefixPhone.replace(/\s+/g, "");
  const isMobile = /^1[3-9]\d{9}$/.test(compactMobile);
  const isLandline = /^0\d{2,3}-?\d{7,8}$/.test(compactLandline);
  const normalized = isMobile
    ? compactMobile
    : isLandline
      ? compactLandline
      : asciiPhone;
  return { normalized, isValid: isMobile || isLandline };
}

function isValidPhone(value: string): boolean {
  return normalizePhoneInput(value).isValid;
}

function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function SlotStatusTag({
  filled,
  filledLabel = "已识别",
  pendingLabel = "待补充",
}: {
  filled: boolean;
  filledLabel?: string;
  pendingLabel?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap ${
        filled ? "text-emerald-700" : "text-amber-700"
      }`}
    >
      {filled ? (
        <>
          <CheckCircle2 size={13} aria-hidden="true" />
          <span>{filledLabel}</span>
        </>
      ) : (
        <span>{pendingLabel}</span>
      )}
    </span>
  );
}

async function scrollIntoViewAsync(
  element: HTMLElement,
  behavior: ScrollBehavior
): Promise<void> {
  const maybePromise: unknown = element.scrollIntoView({
    behavior,
    block: "start",
  });
  if (maybePromise instanceof Promise) {
    await maybePromise;
    return;
  }
  await new Promise<void>((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timeoutId);
      window.removeEventListener("scrollend", finish);
      window.removeEventListener("scroll", onScroll);
      resolve();
    };
    const onScroll = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(finish, 100);
    };
    window.addEventListener("scrollend", finish, { once: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    timeoutId = setTimeout(finish, 120);
  });
}

export default function SubmitPage() {
  const { activeRegion, appDomain, isLoading: regionLoading } = useRegion();
  const { isAdmin } = useAuthRole();
  const datalistId = useId();

  const [mode, setMode] = useState<SubmitMode>("voice");
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

  const isTianhe = Boolean(
    activeRegion?.id?.includes("tianhe") || activeRegion?.name?.includes("天河")
  );
  const isShunde = Boolean(
    activeRegion?.id?.includes("shunde") || activeRegion?.name?.includes("顺德")
  );

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
  const formRef = useRef<HTMLFormElement>(null);
  const voiceInputRef = useRef<HTMLTextAreaElement>(null);
  const [formValues, setFormValues] = useState<IntakeDraft>(EMPTY_DRAFT);
  const [interacted, setInteracted] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [receipt, setReceipt] = useState<SubmitReceipt | null>(null);

  const categoryRef = useRef<HTMLSelectElement>(null);
  const subdistrictRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const clearFormCustomValidities = useCallback(() => {
    categoryRef.current?.setCustomValidity("");
    subdistrictRef.current?.setCustomValidity("");
    contentRef.current?.setCustomValidity("");
    phoneRef.current?.setCustomValidity("");
    emailRef.current?.setCustomValidity("");
  }, []);

  const resetFormState = useCallback(() => {
    formDirtyRef.current = false;
    setFormValues(EMPTY_DRAFT);
    setInteracted({});
    setFieldErrors({});
    clearFormCustomValidities();
    requestAnimationFrame(() => {
      formRef.current?.reset();
    });
  }, [clearFormCustomValidities]);

  const validateFormField = useCallback(
    (name: keyof IntakeDraft, value: string, nextValues?: IntakeDraft): string => {
      const vals = nextValues || formValues;
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
      if (name === "contactPhone") {
        if (trimmed && !isValidPhone(trimmed)) {
          return "请输入有效的 11 位手机号码或区号座机";
        }
        if (!trimmed && !vals.contactEmail.trim()) {
          return "联系电话与电子邮箱请至少填写一项，以便工作人员联系回访";
        }
      }
      if (name === "contactEmail") {
        if (trimmed && !isValidEmail(trimmed)) {
          return "请输入有效的电子邮箱地址（如 name@example.com）";
        }
        if (!trimmed && !vals.contactPhone.trim()) {
          return "联系电话与电子邮箱请至少填写一项，以便工作人员联系回访";
        }
      }
      return "";
    },
    [formValues, regionUnitLabel]
  );

  const updateFormField = (name: keyof IntakeDraft, value: string) => {
    formDirtyRef.current = true;
    const nextValues = { ...formValues, [name]: value };
    setFormValues(nextValues);
    if (name === "contactPhone" || name === "contactEmail") {
      const phoneErr = validateFormField("contactPhone", nextValues.contactPhone, nextValues);
      const emailErr = validateFormField("contactEmail", nextValues.contactEmail, nextValues);
      phoneRef.current?.setCustomValidity(phoneErr);
      emailRef.current?.setCustomValidity(emailErr);
      setFieldErrors((prev) => ({
        ...prev,
        contactPhone: interacted.contactPhone ? phoneErr : "",
        contactEmail: interacted.contactEmail ? emailErr : "",
      }));
      if (!phoneErr && !emailErr) setLiveAnnouncement("");
      return;
    }
    if (fieldErrors[name]) {
      const nextErr = validateFormField(name, value, nextValues);
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
    if (name === "contactPhone" || name === "contactEmail") {
      // 只在其中至少一个已失焦且均为空，或自身格式有误时提示
      const nextInteracted = { ...interacted, [name]: true };
      const phoneErr =
        formValues.contactPhone.trim() && !isValidPhone(formValues.contactPhone)
          ? "请输入有效的 11 位手机号码或区号座机"
          : !formValues.contactPhone.trim() &&
              !formValues.contactEmail.trim() &&
              ((nextInteracted.contactPhone && nextInteracted.contactEmail) || Boolean(formValues.contactPhone || formValues.contactEmail))
            ? "联系电话与电子邮箱请至少填写一项"
            : "";
      const emailErr =
        formValues.contactEmail.trim() && !isValidEmail(formValues.contactEmail)
          ? "请输入有效的电子邮箱地址（如 name@example.com）"
          : "";
      setInteracted(nextInteracted);
      phoneRef.current?.setCustomValidity(phoneErr);
      emailRef.current?.setCustomValidity(emailErr);
      setFieldErrors((prev) => ({ ...prev, contactPhone: phoneErr, contactEmail: emailErr }));
      const firstErr = (name === "contactEmail" ? emailErr : phoneErr) || phoneErr || emailErr;
      if (firstErr) scheduleAnnouncement(firstErr);
      return;
    }
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
  const lastSpokenWelcomeIdRef = useRef<string | null>(null);
  const voiceDirtyRef = useRef<boolean>(false);
  const voiceSessionStartIdxRef = useRef(0);
  const formDirtyRef = useRef<boolean>(false);
  const [voiceMessages, setVoiceMessages] = useState<ChatMessage[]>([]);
  const [voiceDraft, setVoiceDraft] = useState<IntakeDraft>(EMPTY_DRAFT);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [readyToSubmit, setReadyToSubmit] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatPending, setChatPending] = useState<boolean>(false);
  const chatLogRef = useRef<HTMLDivElement>(null);

  const createWelcomeMessage = useCallback(
    (id = "welcome"): ChatMessage => ({
      id,
      role: "assistant",
      content: isEcommerce
        ? "您好，我是智能售后客服。请直接说话或输入您遇到的订单/商品问题，我会自动帮您梳理要素并生成客诉单。"
        : "您好，我是 12345 智能语音受理员。请直接说话或输入您要反映的情况，我会自动核对镇街、地点与诉求内容。",
    }),
    [isEcommerce]
  );

  // 初始化欢迎词随业务域变化（仅当尚无用户消息时刷新，保留既有欢迎消息 ID，避免覆盖重置/切区新 ID）
  useEffect(() => {
    setVoiceMessages((prev) => {
      if (prev.length <= 1) {
        const existingId = prev[0]?.role === "assistant" ? prev[0].id : undefined;
        return [createWelcomeMessage(existingId || "welcome")];
      }
      return prev;
    });
  }, [createWelcomeMessage]);

  useEffect(() => {
    if (chatLogRef.current && (voiceMessages.length > 1 || chatPending)) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [voiceMessages.length, chatPending]);

  // ----------------- 我的投诉进度 -----------------
  const [myTickets, setMyTickets] = useState<MyTicketItem[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState<boolean>(false);
  const [historyOpen, setHistoryOpen] = useState<boolean>(true);
  const [reopenTargetId, setReopenTargetId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState<string>("");
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const historyDetailsRef = useRef<HTMLDetailsElement>(null);
  const historySummaryRef = useRef<HTMLElement>(null);
  const progressScrollSeqRef = useRef(0);
  const optionsAbortRef = useRef<AbortController | null>(null);
  const ticketsAbortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  const regionQuery = activeRegion?.id ? `?region=${encodeURIComponent(activeRegion.id)}` : "";

  const fetchOptions = useCallback(async () => {
    optionsAbortRef.current?.abort();
    const controller = new AbortController();
    optionsAbortRef.current = controller;
    try {
      setOptionsLoading(true);
      const res = await fetch(`/api/intake/options${regionQuery}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok || controller.signal.aborted) return;
      const data = (await res.json()) as IntakeOptionsResponse;
      if (data && !controller.signal.aborted) {
        setOptions(data);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      if (optionsAbortRef.current === controller) {
        optionsAbortRef.current = null;
        setOptionsLoading(false);
      }
    }
  }, [regionQuery]);

  const fetchMyTickets = useCallback(async () => {
    ticketsAbortRef.current?.abort();
    const controller = new AbortController();
    ticketsAbortRef.current = controller;
    try {
      setTicketsLoading(true);
      const res = await fetch(`/api/intake/my-tickets${regionQuery}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok || controller.signal.aborted) return;
      const data = (await res.json()) as { success?: boolean; tickets?: MyTicketItem[] };
      if (Array.isArray(data.tickets) && !controller.signal.aborted) {
        setMyTickets(data.tickets);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    } finally {
      if (ticketsAbortRef.current === controller) {
        ticketsAbortRef.current = null;
        setTicketsLoading(false);
      }
    }
  }, [regionQuery]);

  useEffect(() => {
    void fetchOptions();
    void fetchMyTickets();
  }, [fetchOptions, fetchMyTickets]);

  useEffect(() => {
    const onRefresh = () => {
      void fetchMyTickets();
    };
    window.addEventListener("civic-data-refresh", onRefresh);
    return () => {
      window.removeEventListener("civic-data-refresh", onRefresh);
    };
  }, [fetchMyTickets]);

  useEffect(() => {
    return () => {
      optionsAbortRef.current?.abort();
      ticketsAbortRef.current?.abort();
      chatAbortRef.current?.abort();
    };
  }, []);

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
          contactPhone: payload.contactPhone.trim()
            ? normalizePhoneInput(payload.contactPhone).normalized
            : undefined,
          contactEmail: payload.contactEmail.trim() || undefined,
          source,
        }),
      });
      const data = (await res.json()) as SubmitReceipt & {
        success?: boolean;
        error?: string;
        code?: string;
        existingTicketNo?: string;
        existingTicketId?: string;
      };
      if (res.status === 409 && data.code === "DUPLICATE_TICKET") {
        const msg =
          data.error ||
          (data.existingTicketNo
            ? `检测到相同诉求正在处理中（工单号：${data.existingTicketNo}），请勿重复提交。`
            : "检测到相同诉求正在处理中，请勿重复提交。");
        toast.warning(msg);
        scheduleAnnouncement(msg);
        setHistoryOpen(true);
        if (historyDetailsRef.current) {
          historyDetailsRef.current.open = true;
        }
        void fetchMyTickets();
        if (source === "AGENT_VOICE") {
          setVoiceMessages((prev) => [
            ...prev,
            { id: `dup-${Date.now()}`, role: "assistant", content: msg },
          ]);
          void stageRef.current?.say(msg)?.catch(() => {});
        }
        return false;
      }
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
        resetFormState();
      } else {
        voiceDirtyRef.current = false;
        setVoiceDraft(EMPTY_DRAFT);
        setMissingFields([]);
        setReadyToSubmit(false);
        const ackText = `已为您正式受理并生成工单，回执单号为 ${data.ticketNo}，您可在下方我的投诉进度中实时跟踪。`;
        setVoiceMessages((prev) => {
          const next: ChatMessage[] = [
            ...prev,
            { id: `ack-${Date.now()}`, role: "assistant", content: ackText },
          ];
          voiceSessionStartIdxRef.current = next.length;
          return next;
        });
        void stageRef.current?.say(ackText)?.catch(() => {});
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
      contactEmail: validateFormField("contactEmail", formValues.contactEmail),
    };

    categoryRef.current?.setCustomValidity(errs.category);
    subdistrictRef.current?.setCustomValidity(errs.subdistrict);
    contentRef.current?.setCustomValidity(errs.content);
    phoneRef.current?.setCustomValidity(errs.contactPhone);
    emailRef.current?.setCustomValidity(errs.contactEmail);

    setInteracted({
      category: true,
      subdistrict: true,
      content: true,
      contactPhone: true,
      contactEmail: true,
    });
    setFieldErrors(errs);

    const firstKey = (["category", "subdistrict", "content", "contactPhone", "contactEmail"] as const).find(
      (k) => Boolean(errs[k])
    );
    if (firstKey) {
      const msg = errs[firstKey];
      setLiveAnnouncement(`表单校验未通过：${msg}`);
      if (firstKey === "category") categoryRef.current?.focus();
      else if (firstKey === "subdistrict") subdistrictRef.current?.focus();
      else if (firstKey === "content") contentRef.current?.focus();
      else if (firstKey === "contactPhone") phoneRef.current?.focus();
      else if (firstKey === "contactEmail") emailRef.current?.focus();
      return;
    }

    await submitPayload(formValues, "FORM");
  };

  const asrResetRef = useRef<() => void>(() => {});
  const asrActiveRef = useRef<boolean>(false);

  // ----------------- 语音对话发送 -----------------
  const sendVoiceTurn = useCallback(
    async (rawText: string) => {
      const clean = rawText.trim();
      if (!clean || chatPending) return;
      if (asrActiveRef.current) {
        asrResetRef.current();
      }

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: clean,
      };
      const nextHistory = [...voiceMessages, userMsg];
      setVoiceMessages(nextHistory);
      setChatInput("");
      setChatPending(true);

      chatAbortRef.current?.abort();
      const controller = new AbortController();
      chatAbortRef.current = controller;

      try {
        const sessionMessages = nextHistory.slice(voiceSessionStartIdxRef.current);
        const res = await fetch(`/api/intake/chat${regionQuery}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: sessionMessages.map((m) => ({ role: m.role, content: m.content })),
            draft: voiceDraft,
          }),
        });
        const data = (await res.json()) as {
          success?: boolean;
          intent?: "INTAKE" | "PROGRESS_QUERY";
          reply?: string;
          draft?: Partial<IntakeDraft>;
          missingFields?: string[];
          readyToSubmit?: boolean;
          error?: string;
        };
        if (controller.signal.aborted) return;

        if (!res.ok || !data.success) {
          const msg = data.error || "智能受理暂时繁忙，请稍后重试或切换表单提交";
          toast.error(msg);
          return;
        }

        if (data.intent === "PROGRESS_QUERY") {
          setHistoryOpen(true);
          if (historyDetailsRef.current) {
            historyDetailsRef.current.open = true;
          }
          void fetchMyTickets();
          const replyText =
            data.reply || "已为您展开下方「我的投诉进度」，请查看当前工单的最新办理状态。";
          setVoiceMessages((prev) => [
            ...prev,
            { id: `a-${Date.now()}`, role: "assistant", content: replyText },
          ]);
          void stageRef.current?.say(replyText)?.catch(() => {});
          return;
        }

        voiceDirtyRef.current = true;
        setVoiceDraft((prev) => ({
          title: data.draft?.title ?? prev.title,
          content: data.draft?.content ?? prev.content,
          subdistrict: data.draft?.subdistrict ?? prev.subdistrict,
          category: data.draft?.category ?? prev.category,
          subject: data.draft?.subject ?? prev.subject,
          address: data.draft?.address ?? prev.address,
          contactPhone: data.draft?.contactPhone ?? prev.contactPhone,
          contactEmail: data.draft?.contactEmail ?? prev.contactEmail,
        }));
        setMissingFields(Array.isArray(data.missingFields) ? data.missingFields : []);
        setReadyToSubmit(Boolean(data.readyToSubmit));

        const replyText =
          data.reply || "已记录您的问题，请核对下方提取的投诉要素，确认无误即可提交。";
        setVoiceMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "assistant", content: replyText },
        ]);
        void stageRef.current?.say(replyText)?.catch(() => {});
      } catch (err: unknown) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        toast.error(err instanceof Error ? err.message : "对话请求失败");
      } finally {
        if (chatAbortRef.current === controller) {
          chatAbortRef.current = null;
          setChatPending(false);
        }
      }
    },
    [chatPending, fetchMyTickets, regionQuery, voiceDraft, voiceMessages]
  );

  const asr = useStreamAsr({
    onFinalResult: (text) => {
      const clean = text.trim();
      if (!clean) return;
      setChatInput((prev) => appendRecognizedText(prev, clean));
      voiceInputRef.current?.focus();
    },
  });

  const prevRegionIdRef = useRef<string | undefined>(undefined);
  const asrStopRef = useRef(asr.stop);
  asrStopRef.current = asr.stop;
  asrResetRef.current = asr.reset;
  asrActiveRef.current =
    asr.isRecording || asr.status === "initializing" || asr.status === "downloading";

  useEffect(() => {
    const nextId = activeRegion?.id;
    if (prevRegionIdRef.current && nextId && prevRegionIdRef.current !== nextId) {
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      setChatPending(false);
      progressScrollSeqRef.current += 1;
      asrStopRef.current();
      stageRef.current?.stop();
      voiceDirtyRef.current = false;
      voiceSessionStartIdxRef.current = 0;
      formDirtyRef.current = false;
      setVoiceDraft(EMPTY_DRAFT);
      setMissingFields([]);
      setReadyToSubmit(false);
      setChatInput("");
      setVoiceMessages([createWelcomeMessage(`welcome-region-${nextId}-${Date.now()}`)]);
      setReceipt(null);
      setReopenTargetId(null);
      setReopenReason("");
      resetFormState();
    }
    if (nextId) {
      prevRegionIdRef.current = nextId;
    }
  }, [activeRegion?.id, createWelcomeMessage, resetFormState]);

  // 进入 /submit、切区或清空重说后，待区域与选项就绪自动触发欢迎语音播报一次
  useEffect(() => {
    if (
      regionLoading ||
      optionsLoading ||
      mode !== "voice" ||
      asr.isRecording ||
      asr.status === "initializing" ||
      asr.status === "downloading" ||
      chatPending
    ) {
      return;
    }
    if (voiceMessages.length !== 1) return;
    const welcomeMsg = voiceMessages[0];
    if (!welcomeMsg || welcomeMsg.role !== "assistant") return;
    if (welcomeMsg.content !== createWelcomeMessage(welcomeMsg.id).content) return;
    if (lastSpokenWelcomeIdRef.current === welcomeMsg.id) return;
    lastSpokenWelcomeIdRef.current = welcomeMsg.id;
    void stageRef.current?.say(welcomeMsg.content)?.catch(() => {});
  }, [
    regionLoading,
    optionsLoading,
    mode,
    asr.isRecording,
    asr.status,
    chatPending,
    voiceMessages,
    createWelcomeMessage,
  ]);

  const handleVoiceToggle = async () => {
    if (asr.isRecording || asr.status === "initializing" || asr.status === "downloading") {
      asr.stop();
    } else {
      stageRef.current?.stop();
      await asr.start();
    }
  };

  const submitComposerInput = () => {
    const pendingText =
      asr.isRecording && asr.interimText.trim()
        ? appendRecognizedText(chatInput, asr.interimText)
        : chatInput;
    void sendVoiceTurn(pendingText);
  };

  const handleVoiceDraftSubmit = async () => {
    const missing: string[] = [];
    if (!voiceDraft.category.trim()) missing.push("所属分类");
    if (!voiceDraft.subdistrict.trim()) missing.push(regionUnitLabel);
    if (voiceDraft.content.trim().length < 6) missing.push("至少 6 字诉求内容");
    const phoneTrim = voiceDraft.contactPhone.trim();
    const emailTrim = voiceDraft.contactEmail.trim();
    if (phoneTrim && !isValidPhone(phoneTrim)) {
      missing.push("有效的联系电话");
    } else if (emailTrim && !isValidEmail(emailTrim)) {
      missing.push("有效的电子邮箱");
    } else if (!phoneTrim && !emailTrim) {
      missing.push("联系电话或邮箱");
    }

    if (missing.length > 0) {
      const msg = `请先补充：${missing.join("、")}（可直接在本草稿卡片内填写或选择）`;
      toast.error(msg);
      scheduleAnnouncement(msg);
      return;
    }
    await submitPayload(voiceDraft, "AGENT_VOICE");
  };

  // ----------------- 重开投诉 -----------------
  const handleConfirmReopen = async (ticketId: string) => {
    if (reopeningId) return;
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
    if (next === "form" && mode !== "form") {
      if (voiceDirtyRef.current || (hasAnyVoiceDraft && !formDirtyRef.current)) {
        setFormValues((prev) => ({
          title: voiceDraft.title.trim() ? voiceDraft.title : prev.title,
          content: voiceDraft.content,
          subdistrict: voiceDraft.subdistrict,
          category: voiceDraft.category,
          subject: voiceDraft.subject,
          address: voiceDraft.address,
          contactPhone: voiceDraft.contactPhone,
          contactEmail: voiceDraft.contactEmail,
        }));
        setInteracted({});
        setFieldErrors({});
        clearFormCustomValidities();
        voiceDirtyRef.current = false;
        formDirtyRef.current = false;
      }
    } else if (next === "voice" && mode !== "voice") {
      const hasAnyFormValue = Boolean(
        formValues.title.trim() ||
          formValues.content.trim() ||
          formValues.subdistrict.trim() ||
          formValues.category.trim() ||
          formValues.subject.trim() ||
          formValues.address.trim() ||
          formValues.contactPhone.trim() ||
          formValues.contactEmail.trim()
      );
      if (formDirtyRef.current || (hasAnyFormValue && !voiceDirtyRef.current)) {
        setVoiceDraft((prev) => ({
          title: formValues.title.trim() ? formValues.title : prev.title,
          content: formValues.content,
          subdistrict: formValues.subdistrict,
          category: formValues.category,
          subject: formValues.subject,
          address: formValues.address,
          contactPhone: formValues.contactPhone,
          contactEmail: formValues.contactEmail,
        }));
        formDirtyRef.current = false;
        voiceDirtyRef.current = false;
      }
    }
    setMode(next);
    requestAnimationFrame(() => {
      const targetTab = next === "form" ? formTabRef.current : voiceTabRef.current;
      if (targetTab) {
        targetTab.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (focusTab) targetTab.focus();
      }
    });
  };

  const handleViewProgress = async () => {
    const scrollSeq = ++progressScrollSeqRef.current;
    setHistoryOpen(true);
    const detailsEl = historyDetailsRef.current;
    if (!detailsEl) return;
    detailsEl.open = true;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    await scrollIntoViewAsync(detailsEl, prefersReduced ? "auto" : "smooth");

    if (progressScrollSeqRef.current !== scrollSeq) return;
    historySummaryRef.current?.focus({ preventScroll: true });
  };

  const handleTabListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (e.key === "Home") {
        switchMode("voice", true);
        return;
      }
      if (e.key === "End") {
        switchMode("form", true);
        return;
      }
      switchMode(mode === "form" ? "voice" : "form", true);
    }
  };

  const regionShort = activeRegion?.name || "辖区";
  const sampleSubdistrict = subdistricts[0] || "中心街道";
  const quickVoiceDemos = isEcommerce
    ? [
        {
          title: "生鲜礼盒化冻变质无客服回应",
          text: "我买的生鲜礼盒拆开全化冻发臭了，客服一直不理人",
        },
        {
          title: "天猫旗舰店冷链礼盒变质申请赔付",
          text: "在天猫旗舰店买的SKU-GD2026-881冷链礼盒从华南冷链仓发出，收货化冻变质发臭要求退款赔付，电话13912345678",
        },
      ]
    : isShunde
      ? [
          {
            title: "夜间烧烤油烟噪音扰民",
            text: "大良这边晚上老有烧烤油烟吵得睡不着",
          },
          {
            title: "大良清晖路老广烧烤档夜间油烟",
            text: "大良街道清晖路88号老广烧烤档，每天晚上11点到凌晨2点油烟排风噪音严重扰民，联系电话13800138000",
          },
        ]
      : isTianhe
        ? [
            {
              title: "天河公园广场舞大喇叭扰民",
              text: "我住在天河公园附近，每天晚上9点后都有人在广场开大喇叭跳广场舞，吵得睡不着",
            },
            {
              title: "夜间烧烤油烟噪音扰民",
              text: "天河这边晚上老有烧烤油烟吵得睡不着",
            },
            {
              title: "天河南一路老广烧烤档夜间油烟",
              text: "天河南街道天河南一路88号老广烧烤档，每天晚上11点到凌晨2点油烟排风噪音严重扰民，联系电话13800138000",
            },
          ]
        : [
            {
              title: "天河公园广场舞大喇叭扰民",
              text: "我住在天河公园附近，每天晚上9点后都有人在广场开大喇叭跳广场舞，吵得睡不着",
            },
            {
              title: "夜间烧烤油烟噪音扰民",
              text: `${regionShort}这边晚上老有烧烤油烟吵得睡不着`,
            },
            {
              title: `${sampleSubdistrict}夜间烧烤油烟扰民`,
              text: `${sampleSubdistrict}新城路88号老广烧烤档，每天晚上11点到凌晨2点油烟排风噪音严重扰民，联系电话13800138000`,
            },
          ];

  const hasDraftCategory = Boolean(voiceDraft.category.trim());
  const hasDraftSubdistrict = Boolean(voiceDraft.subdistrict.trim());
  const hasDraftContent = voiceDraft.content.trim().length >= 6;
  const draftPhoneFormatError =
    Boolean(voiceDraft.contactPhone.trim()) && !isValidPhone(voiceDraft.contactPhone);
  const draftEmailFormatError =
    Boolean(voiceDraft.contactEmail.trim()) && !isValidEmail(voiceDraft.contactEmail);
  const hasDraftContact =
    (isValidPhone(voiceDraft.contactPhone) || isValidEmail(voiceDraft.contactEmail)) &&
    !draftPhoneFormatError &&
    !draftEmailFormatError;
  const filledRequiredCount = [
    hasDraftCategory,
    hasDraftSubdistrict,
    hasDraftContent,
    hasDraftContact,
  ].filter(Boolean).length;
  const hasAnyVoiceDraft = Boolean(
    voiceDraft.category.trim() ||
      voiceDraft.subdistrict.trim() ||
      voiceDraft.subject.trim() ||
      voiceDraft.address.trim() ||
      voiceDraft.contactPhone.trim() ||
      voiceDraft.contactEmail.trim() ||
      voiceDraft.content.trim()
  );
  const missingRequiredLabels = [
    !hasDraftCategory ? "所属分类" : "",
    !hasDraftSubdistrict ? regionUnitLabel : "",
    !hasDraftContent ? "诉求内容（至少 6 字）" : "",
    draftPhoneFormatError
      ? "有效的联系电话"
      : draftEmailFormatError
        ? "有效的电子邮箱"
        : !hasDraftContact
          ? "联系电话或邮箱"
          : "",
  ].filter(Boolean);
  const isVoiceDraftReady = missingRequiredLabels.length === 0;
  const latestVoiceCaption =
    [...voiceMessages].reverse().find((m) => m.role === "assistant")?.content || "";

  const updateVoiceDraftField = (name: keyof IntakeDraft, value: string) => {
    voiceDirtyRef.current = true;
    setVoiceDraft((prev) => ({ ...prev, [name]: value }));
  };

  const handleResetVoiceChat = () => {
    if (chatPending) return;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    asr.stop();
    stageRef.current?.stop();
    voiceDirtyRef.current = false;
    voiceSessionStartIdxRef.current = 0;
    setVoiceDraft(EMPTY_DRAFT);
    setMissingFields([]);
    setReadyToSubmit(false);
    setChatInput("");
    setVoiceMessages([createWelcomeMessage(`welcome-reset-${Date.now()}`)]);
  };

  return (
    <div className={`submit-shell${mode === "voice" ? " submit-shell--voice" : ""}`}>
      {/* 页面级单一礼貌播报区 */}
      <div className="visually-hidden" aria-live="polite">
        {liveAnnouncement}
      </div>

      {isAdmin ? (
        <div
          role="region"
          aria-label="管理员预览模式提示"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-white shadow-sm"
        >
          <span className="font-medium">
            {isEcommerce
              ? "当前为管理员预览模式（买家客诉提交端）"
              : "当前为管理员预览模式（市民投诉提交端）"}
          </span>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 min-h-[36px] text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            返回管理后台
          </Link>
        </div>
      ) : null}

      {/* 极简页头 */}
      <header className="submit-header">
        <h1 className="submit-header__title">
          {isEcommerce ? "售后客诉提交与进度追踪" : "民生诉求提交与进度追踪"}
        </h1>
        <p className="submit-header__sub">
          {isEcommerce
            ? "支持自主填写或通过智能语音客服反映订单与商品问题，自动脱敏建单并跟踪处理闭环。"
            : "支持自主填写或通过智能语音受理员反映身边问题，自动脱敏分派并实时追踪办理结果。"}
        </p>
      </header>

      {/* 提交成功回执卡 */}
      {receipt ? (
        <section
          aria-label="受理回执"
          className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 text-slate-900"
        >
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
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
                  <p className="mt-1.5 text-xs text-slate-700 bg-white/80 rounded-md px-2.5 py-1.5 border border-emerald-200/70 break-words">
                    隐私脱敏摘要：{receipt.maskedPreview}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <button
                type="button"
                onClick={() => void handleViewProgress()}
                className="inline-flex min-h-12 sm:min-h-10 items-center gap-1 rounded-md border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
              >
                <ChevronDown size={14} aria-hidden="true" />
                <span>查看下方进度</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setReceipt(null);
                  requestAnimationFrame(() => {
                    if (mode === "form") {
                      categoryRef.current?.focus();
                    } else {
                      voiceInputRef.current?.focus();
                    }
                  });
                }}
                className="inline-flex min-h-12 sm:min-h-10 items-center rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 cursor-pointer"
              >
                继续提交
              </button>
            </div>
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
            ref={voiceTabRef}
            type="button"
            role="tab"
            id="tab-voice"
            aria-selected={mode === "voice"}
            tabIndex={mode === "voice" ? 0 : -1}
            onClick={() => switchMode("voice")}
            className="submit-tab"
          >
            <span className="submit-tab__title">
              <Sparkles size={16} aria-hidden="true" className="shrink-0" />
              <span>智能对话受理</span>
            </span>
            <span className="submit-tab__sub">说话或打字，AI 自动填单</span>
          </button>

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
            <span className="submit-tab__title">
              <FileText size={16} aria-hidden="true" className="shrink-0" />
              <span>传统表单填报</span>
            </span>
            <span className="submit-tab__sub">自主填写各项要素</span>
          </button>
        </div>

        {/* Tab 1: 基础表单填报 */}
        <div role="tabpanel" aria-labelledby="tab-form" hidden={mode !== "form"}>
          <div className="submit-panel-body">
            <form
              ref={formRef}
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
                  placeholder={
                    isEcommerce
                      ? "例如：天猫旗舰店 / 华南冷链仓"
                      : isShunde
                        ? "例如：大良街道"
                        : isTianhe
                          ? "例如：天河南街道"
                          : `例如：${sampleSubdistrict}`
                  }
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
                    isEcommerce
                      ? "例如：订单 202611200081 / 广州市天河区"
                      : isShunde
                        ? "例如：大良街道清晖路 88 号"
                        : isTianhe
                          ? "例如：天河南一路 88 号"
                          : "例如：新城路 88 号"
                  }
                  enterKeyHint="next"
                  aria-invalid="false"
                  aria-describedby="submit-address-hint"
                  className="submit-control"
                />
              </div>

              <div className="submit-field">
                <div className="submit-label">
                  联系方式（电话或邮箱至少填一项） <span className="submit-required-mark" aria-hidden="true">*</span>
                </div>
                <span id="submit-contact-hint" className="submit-hint">
                  填手机号或邮箱均可，便于处理进度通知与回访；入库自动隐私气隙脱敏保护
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                  <div>
                    <label htmlFor="submit-phone" className="block text-xs font-medium text-slate-600 mb-1">
                      联系电话
                    </label>
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
                      enterKeyHint="next"
                      aria-invalid={Boolean(interacted.contactPhone && fieldErrors.contactPhone)}
                      aria-describedby={
                        interacted.contactPhone && fieldErrors.contactPhone
                          ? "submit-contact-hint submit-phone-error"
                          : "submit-contact-hint"
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

                  <div>
                    <label htmlFor="submit-email" className="block text-xs font-medium text-slate-600 mb-1">
                      电子邮箱
                    </label>
                    <input
                      ref={emailRef}
                      id="submit-email"
                      name="contactEmail"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={formValues.contactEmail}
                      onChange={(e) => {
                        e.currentTarget.setCustomValidity("");
                        updateFormField("contactEmail", e.target.value);
                      }}
                      onBlur={(e) => handleFieldBlur("contactEmail", e.currentTarget)}
                      placeholder="例如：citizen@example.com"
                      enterKeyHint="done"
                      aria-invalid={Boolean(interacted.contactEmail && fieldErrors.contactEmail)}
                      aria-describedby={
                        interacted.contactEmail && fieldErrors.contactEmail
                          ? "submit-contact-hint submit-email-error"
                          : "submit-contact-hint"
                      }
                      className={`submit-control${
                        interacted.contactEmail && fieldErrors.contactEmail
                          ? " user-invalid-fallback"
                          : ""
                      }`}
                    />
                    <div
                      id="submit-email-error"
                      className={`submit-error${
                        interacted.contactEmail && fieldErrors.contactEmail ? " is-visible" : ""
                      }`}
                    >
                      <AlertCircle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{fieldErrors.contactEmail || "请输入有效的电子邮箱"}</span>
                    </div>
                  </div>
                </div>
              </div>

              <button type="submit" disabled={submitting} className="submit-btn-primary">
                {submitting ? "正在提交并脱敏建单..." : "提交投诉"}
              </button>
            </form>
          </div>
        </div>

        {/* Tab 2: 智能对话受理（左侧 3D 数字人舞台 + 右侧全高对话与卡片流） */}
        <div role="tabpanel" aria-labelledby="tab-voice" hidden={mode !== "voice"}>
          <div className="submit-panel-body submit-panel-body--voice">
            <div className="voice-layout">
              {/* 左侧：3D 语音形象舞台 */}
              <div className="voice-stage-col">
                <XiaochunStage
                  ref={stageRef}
                  variant="stage"
                  backdropTone="light"
                  title={isEcommerce ? "智能售后客服" : "12345 智能语音受理员"}
                  caption={latestVoiceCaption}
                  width="100%"
                  height="100%"
                  lazy={false}
                  outfit="xiaochun_civic"
                />
              </div>

              {/* 右侧：主流对话工作区（顶栏 + 对话/内联确认卡 + 底部一体化输入胶囊） */}
              <div className="voice-chat-col">
                {/* 轻量对话顶栏 */}
                <div className="voice-chat-bar">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-slate-900 truncate">
                      {isEcommerce ? "智能售后客服" : "12345 智能语音受理员"}
                    </span>
                    {hasAnyVoiceDraft && (
                      <span
                        className={`text-xs font-medium tabular-nums whitespace-nowrap ${
                          isVoiceDraftReady ? "text-emerald-700" : "text-blue-700"
                        }`}
                      >
                        已填齐 {filledRequiredCount}/4 项必填
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {voiceMessages.length > 1 && (
                      <button
                        type="button"
                        disabled={chatPending}
                        onClick={handleResetVoiceChat}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 min-h-[44px] sm:min-h-[30px] text-[11px] font-medium text-slate-600 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw size={11} aria-hidden="true" />
                        <span>清空重说</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 全高对话消息与内联确认卡滚动区 */}
                <div
                  ref={chatLogRef}
                  className="voice-chat-thread"
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

                  {/* 首轮未发言时的自然场景引导（发第一句后自动收起） */}
                  {voiceMessages.length <= 1 && !chatPending && (
                    <div className="space-y-2 pt-1">
                      <div className="text-xs text-slate-500">
                        您可以直接开口说话，或点选常见场景快速开始：
                      </div>
                      <div className="flex flex-col gap-2">
                        {quickVoiceDemos.map((demo) => (
                          <button
                            key={demo.title}
                            type="button"
                            disabled={chatPending}
                            onClick={() => void sendVoiceTurn(demo.text)}
                            className="w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-xs hover:border-blue-400 hover:bg-blue-50/50 transition-colors cursor-pointer disabled:opacity-60"
                          >
                            <div className="font-semibold text-slate-900">{demo.title}</div>
                            <div className="mt-0.5 text-slate-500 line-clamp-1">{demo.text}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI 思考态脉冲 */}
                  {chatPending && (
                    <div
                      role="progressbar"
                      aria-label="正在理解诉求并提取要素"
                      className="voice-msg voice-msg--assistant inline-flex items-center gap-2.5 text-slate-600"
                    >
                      <span className="voice-thinking-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                      <span className="text-xs">正在理解诉求并提取要素…</span>
                    </div>
                  )}

                  {/* 对话内联：实时抽取的诉求工单确认卡（扁平网格布局，无嵌套白框） */}
                  {hasAnyVoiceDraft && (
                    <div className="mt-1 rounded-xl border border-slate-200 bg-slate-50/75 p-3.5 sm:p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-slate-900 flex items-center gap-1.5">
                            <Sparkles size={14} className="text-blue-600 shrink-0" aria-hidden="true" />
                            <span>诉求工单草稿</span>
                          </div>
                          <p id="voice-draft-status" className="text-[13px] text-slate-600 mt-0.5">
                            {isVoiceDraftReady
                              ? readyToSubmit || missingFields.length === 0
                                ? "关键要素已齐全，可直接确认提交。"
                                : `基础必填已齐备，建议继续补充「${missingFields.join("、")}」以便精准派单，或直接提交。`
                              : `还需补充：${missingRequiredLabels.join("、")}`}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div className="min-w-0">
                          <label
                            htmlFor="draft-category-select"
                            className="flex items-center justify-between gap-2 text-[13px] font-medium text-slate-700"
                          >
                            <span>
                              所属分类 <span className="text-red-600" aria-hidden="true">*</span>
                            </span>
                            <SlotStatusTag filled={hasDraftCategory} />
                          </label>
                          <select
                            id="draft-category-select"
                            value={voiceDraft.category}
                            onChange={(e) => updateVoiceDraftField("category", e.target.value)}
                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 min-h-[44px] sm:min-h-[40px] text-base sm:text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none"
                          >
                            <option value="">请选择投诉分类</option>
                            {categories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                            {voiceDraft.category && !categories.includes(voiceDraft.category) && (
                              <option value={voiceDraft.category}>{voiceDraft.category}</option>
                            )}
                          </select>
                        </div>

                        <div className="min-w-0">
                          <label
                            htmlFor="draft-subdistrict-select"
                            className="flex items-center justify-between gap-2 text-[13px] font-medium text-slate-700"
                          >
                            <span>
                              {regionUnitLabel} <span className="text-red-600" aria-hidden="true">*</span>
                            </span>
                            <SlotStatusTag filled={hasDraftSubdistrict} />
                          </label>
                          {subdistricts.length > 0 ? (
                            <select
                              id="draft-subdistrict-select"
                              value={voiceDraft.subdistrict}
                              onChange={(e) => updateVoiceDraftField("subdistrict", e.target.value)}
                              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 min-h-[44px] sm:min-h-[40px] text-base sm:text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none"
                            >
                              <option value="">请选择{regionUnitLabel}</option>
                              {subdistricts.map((item) => (
                                <option key={item} value={item}>
                                  {item}
                                </option>
                              ))}
                              {voiceDraft.subdistrict && !subdistricts.includes(voiceDraft.subdistrict) && (
                                <option value={voiceDraft.subdistrict}>{voiceDraft.subdistrict}</option>
                              )}
                            </select>
                          ) : (
                            <input
                              id="draft-subdistrict-select"
                              type="text"
                              value={voiceDraft.subdistrict}
                              onChange={(e) => updateVoiceDraftField("subdistrict", e.target.value)}
                              placeholder={`请输入${regionUnitLabel}`}
                              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 min-h-[44px] sm:min-h-[40px] text-base sm:text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none"
                            />
                          )}
                        </div>

                        <div className="min-w-0">
                          <label htmlFor="draft-subject-input" className="block text-[13px] font-medium text-slate-700">
                            {subjectLabel}（选填）
                          </label>
                          <input
                            id="draft-subject-input"
                            type="text"
                            value={voiceDraft.subject}
                            onChange={(e) => updateVoiceDraftField("subject", e.target.value)}
                            placeholder={isEcommerce ? "例如：SKU-GD2026-881 生鲜礼盒" : "例如：老广烧烤档"}
                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 min-h-[44px] sm:min-h-[40px] text-base sm:text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none"
                          />
                        </div>

                        <div className="min-w-0">
                          <label htmlFor="draft-address-input" className="block text-[13px] font-medium text-slate-700">
                            {addressLabel}（选填）
                          </label>
                          <input
                            id="draft-address-input"
                            type="text"
                            value={voiceDraft.address}
                            onChange={(e) => updateVoiceDraftField("address", e.target.value)}
                            placeholder={
                              isEcommerce
                                ? "例如：订单 202611200081 / 广州市天河区"
                                : isShunde
                                  ? "例如：大良街道清晖路 88 号"
                                  : isTianhe
                                    ? "例如：天河南一路 88 号"
                                    : "例如：新城路 88 号"
                            }
                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 min-h-[44px] sm:min-h-[40px] text-base sm:text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none"
                          />
                        </div>

                        <div className="sm:col-span-2 min-w-0 border-t border-slate-200/80 pt-3">
                          <div className="flex items-center justify-between gap-2 text-[13px] font-medium text-slate-700">
                            <span>
                              联系方式（电话或邮箱至少填一项） <span className="text-red-600" aria-hidden="true">*</span>
                            </span>
                            <SlotStatusTag
                              filled={hasDraftContact}
                              filledLabel="已填写"
                              pendingLabel={
                                draftPhoneFormatError || draftEmailFormatError ? "格式有误" : "二选一必填"
                              }
                            />
                          </div>
                          <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div className="min-w-0">
                              <label htmlFor="draft-phone-input" className="sr-only">
                                联系电话
                              </label>
                              <input
                                id="draft-phone-input"
                                type="tel"
                                inputMode="tel"
                                autoComplete="tel"
                                value={voiceDraft.contactPhone}
                                onChange={(e) => updateVoiceDraftField("contactPhone", e.target.value)}
                                placeholder="联系电话（如 13800138000）"
                                aria-invalid={draftPhoneFormatError}
                                className={`w-full rounded-lg border px-3 py-2 min-h-[44px] sm:min-h-[40px] text-base sm:text-sm text-slate-900 focus:bg-white focus:outline-none ${
                                  draftPhoneFormatError
                                    ? "border-red-400 bg-red-50/40 focus:border-red-500"
                                    : "border-slate-300 bg-white focus:border-blue-500"
                                }`}
                              />
                            </div>
                            <div className="min-w-0">
                              <label htmlFor="draft-email-input" className="sr-only">
                                电子邮箱
                              </label>
                              <input
                                id="draft-email-input"
                                type="email"
                                inputMode="email"
                                autoComplete="email"
                                value={voiceDraft.contactEmail}
                                onChange={(e) => updateVoiceDraftField("contactEmail", e.target.value)}
                                placeholder="或电子邮箱（如 user@example.com）"
                                aria-invalid={draftEmailFormatError}
                                className={`w-full rounded-lg border px-3 py-2 min-h-[44px] sm:min-h-[40px] text-base sm:text-sm text-slate-900 focus:bg-white focus:outline-none ${
                                  draftEmailFormatError
                                    ? "border-red-400 bg-red-50/40 focus:border-red-500"
                                    : "border-slate-300 bg-white focus:border-blue-500"
                                }`}
                              />
                            </div>
                          </div>
                          {(draftPhoneFormatError || draftEmailFormatError) && (
                            <p className="mt-1 text-[13px] text-red-600">
                              {draftPhoneFormatError
                                ? "电话格式不正确（支持 11 位手机号或区号座机）"
                                : "邮箱格式不正确（如 name@example.com）"}
                            </p>
                          )}
                        </div>

                        <div className="sm:col-span-2 min-w-0 border-t border-slate-200/80 pt-3">
                          <label
                            htmlFor="draft-content-textarea"
                            className="flex items-center justify-between gap-2 text-[13px] font-medium text-slate-700"
                          >
                            <span>
                              诉求内容 <span className="text-red-600" aria-hidden="true">*</span>
                            </span>
                            <SlotStatusTag
                              filled={hasDraftContent}
                              pendingLabel={
                                voiceDraft.content.trim().length > 0 ? "需至少 6 字" : "待补充"
                              }
                            />
                          </label>
                          <textarea
                            id="draft-content-textarea"
                            rows={2}
                            value={voiceDraft.content}
                            onChange={(e) => updateVoiceDraftField("content", e.target.value)}
                            placeholder="可以直接修改或补充具体情况（至少 6 个字）"
                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 min-h-[76px] text-base sm:text-sm font-medium leading-relaxed text-slate-900 focus:border-blue-500 focus:outline-none resize-y"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <button
                          type="button"
                          disabled={submitting || !isVoiceDraftReady}
                          aria-describedby="voice-draft-status"
                          onClick={() => void handleVoiceDraftSubmit()}
                          className={
                            isVoiceDraftReady
                              ? "inline-flex min-h-11 sm:min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed [text-wrap:balance]"
                              : "inline-flex min-h-11 sm:min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3.5 py-2 text-sm font-medium text-slate-500 cursor-not-allowed [text-wrap:balance]"
                          }
                        >
                          {submitting ? (
                            <>
                              <CheckCircle2 size={15} aria-hidden="true" />
                              <span>正在提交...</span>
                            </>
                          ) : !isVoiceDraftReady ? (
                            <>
                              <AlertCircle size={15} aria-hidden="true" />
                              <span>请先补充：{missingRequiredLabels.join("、")}</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 size={15} aria-hidden="true" />
                              <span>一键确认提交投诉</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 底部统一语音/文本一体化输入条 */}
                <VoiceChatComposer
                  inputId="voice-chat-input"
                  label="输入诉求内容"
                  value={chatInput}
                  onChange={setChatInput}
                  onSubmit={submitComposerInput}
                  placeholder="说话或输入问题…"
                  disabled={chatPending}
                  asr={asr}
                  onVoiceToggle={handleVoiceToggle}
                  inputRef={voiceInputRef}
                  submitAriaLabel="发送消息"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 底部轻量化折叠「我的投诉进度」 */}
      <details
        ref={historyDetailsRef}
        className="submit-history-details"
        open={historyOpen}
        onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
      >
        <summary ref={historySummaryRef} className="submit-history-summary">
          <span className="inline-flex items-center gap-2">
            <span>我的投诉进度</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 tabular-nums">
              {fmtNum(myTickets.length)}
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
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 min-h-[44px] sm:min-h-[30px] text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
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
                  : STATUS_LABELS[(ticket.status || "").trim().toUpperCase()] || ticket.status;
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
                      <time className="text-xs text-slate-500 tabular-nums">
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
                                className="inline-flex min-h-11 sm:min-h-10 items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 cursor-pointer disabled:opacity-60"
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
                                className="inline-flex min-h-11 sm:min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
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
                            className="inline-flex min-h-11 sm:min-h-10 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 cursor-pointer"
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
