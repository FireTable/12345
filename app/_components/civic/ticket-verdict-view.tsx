"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  Building2,
  Tag,
  MapPin,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Layers,
  MessageSquareQuote,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { getUrgencyLabel } from "@/lib/civic-dto";
import { CivicGeoMap } from "./civic-geo-map";
import { geocodeAddressClient } from "@/lib/map/client-geocode";

export interface TicketVerdictData {
  id: string;
  ticketId?: string;
  title: string;
  rawTitle?: string;
  summarizeTitle?: string;
  category: string;
  region: string;
  urgency: string;
  status: string;
  createdAt: string;
  content?: string;
  channel?: string;
  caller_name?: string;
  caller_phone?: string;
  address?: string;
  cluster_id?: string;
  cluster_name?: string;
  cluster_info?: {
    id: string;
    title: string;
    mode_name?: string;
  } | null;
  multifreq?: boolean;
  confidence?: number;
  slaHours?: number | null;
  stabilityRisk?: boolean;
  canonicalSubject?: string;
  eventType?: string;
  isFakeClosure?: boolean;
}

/**
 * 1. AI 智能研判核心卡片 (现代扁平质感，无厚重边框)
 */
export function AiVerdictCard({ data }: { data: TicketVerdictData }) {
  const clusterId = data.cluster_info?.id || data.cluster_id || "";
  const clusterTitle = data.cluster_info?.title || data.cluster_name || (clusterId ? `多频主题 ${clusterId}` : "");

  return (
    <div className="bg-slate-50/90 rounded-xl p-4 border border-slate-200/90 space-y-3.5">
      {/* 头部：研判状态与置信度 */}
      <div className="flex items-center justify-between pb-2.5 border-b border-slate-200/60">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200/70">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            AI 智能研判解析
          </span>
          <span className="text-[11px] text-slate-500 font-medium">
            置信度 {data.confidence ?? 90}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          {data.stabilityRisk ? (
            <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" />
              涉稳预警
            </span>
          ) : (
            <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              涉稳平稳
            </span>
          )}
          <span className="text-[11px] font-medium text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
            {data.isFakeClosure ? "⚠️ 闭环异常" : "✓ 流程正常"}
          </span>
        </div>
      </div>

      {/* 4 项核心研判结论 - 采用精致轻量信息块 */}
      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div className="bg-white p-2.5 rounded-lg border border-slate-200/70 shadow-2xs">
          <div className="text-slate-400 text-[11px] flex items-center gap-1.5 mb-1">
            <Building2 className="w-3.5 h-3.5 text-blue-600" />
            <span>涉事/责任主体</span>
          </div>
          <div className="font-semibold text-slate-900 leading-snug">
            {data.canonicalSubject || "通用民生主体"}
          </div>
        </div>

        <div className="bg-white p-2.5 rounded-lg border border-slate-200/70 shadow-2xs">
          <div className="text-slate-400 text-[11px] flex items-center gap-1.5 mb-1">
            <Tag className="w-3.5 h-3.5 text-indigo-600" />
            <span>细分事件类型</span>
          </div>
          <div className="font-semibold text-slate-900 leading-snug">
            {data.eventType || data.category || "综合民生"}
          </div>
        </div>

        <div className="col-span-2 bg-white p-2.5 rounded-lg border border-slate-200/70 shadow-2xs">
          <div className="text-slate-400 text-[11px] flex items-center gap-1.5 mb-1">
            <MapPin className="w-3.5 h-3.5 text-emerald-600" />
            <span>微观事发地点</span>
          </div>
          <div className="font-semibold text-slate-900 leading-snug">
            {data.address || (data.region ? `${data.region}辖区` : "待研判定位")}
          </div>
        </div>

        <div className="bg-white p-2.5 rounded-lg border border-slate-200/70 shadow-2xs">
          <div className="text-slate-400 text-[11px] flex items-center gap-1.5 mb-1">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>建议办结时限</span>
          </div>
          <div className="font-semibold text-slate-900 leading-snug">
            {data.slaHours ? `${data.slaHours} 小时标准办结` : "常规办结"}
          </div>
        </div>

        <div className="bg-white p-2.5 rounded-lg border border-slate-200/70 shadow-2xs">
          <div className="text-slate-400 text-[11px] flex items-center gap-1.5 mb-1">
            <Layers className="w-3.5 h-3.5 text-purple-600" />
            <span>多频聚类态势</span>
          </div>
          <div className="font-semibold text-slate-900 leading-snug">
            {clusterId ? "已归入多频专题" : "独立分散诉求"}
          </div>
        </div>
      </div>

      {/* 若命中多频专题，展示轻量通告 */}
      {clusterId && (
        <div className="bg-blue-50/70 border border-blue-200/80 rounded-lg p-2.5 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="text-slate-600 shrink-0">多频专题：</span>
            <span className="font-bold text-blue-900 truncate">{clusterTitle}</span>
          </div>
          <Link
            href={`/themes/${clusterId}?ticketId=${encodeURIComponent(data.id)}&highlight=${encodeURIComponent(data.id)}#ticket-${encodeURIComponent(data.id)}`}
            className="text-blue-600 hover:text-blue-800 font-semibold flex items-center shrink-0 hover:underline"
          >
            <span>定位专题</span>
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * 2. 市民原始诉求正文展示
 */
export function CitizenVoiceCard({ data }: { data: TicketVerdictData }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!data.content) return;
    navigator.clipboard.writeText(data.content);
    setCopied(true);
    toast.success("诉求原文已复制到剪贴板");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-bold text-slate-800">
          <MessageSquareQuote className="w-4 h-4 text-blue-600" />
          <span>市民诉求原文</span>
        </div>
        <div className="flex items-center gap-3 text-slate-400">
          <span>共 {(data.content || "").length} 字 · {data.channel || "市民服务热线"}</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
            onClick={handleCopy}
            title="复制原文"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
        </div>
      </div>
      <div className="p-3 bg-slate-50 border-l-3 border-blue-600 rounded-r-lg text-slate-800 text-xs leading-relaxed whitespace-pre-wrap max-h-[220px] overflow-y-auto">
        {data.content || <span className="text-slate-400">暂无正文内容</span>}
      </div>
    </div>
  );
}

/**
 * 3. 工单基本信息经办属性
 */
export function TicketPropsGrid({ data }: { data: TicketVerdictData }) {
  const urgency = getUrgencyLabel(data.urgency);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5">
      <div className="text-xs font-bold text-slate-800 pb-2 border-b border-slate-100 flex items-center justify-between">
        <span>工单经办与受理要素</span>
        <span className="font-mono text-slate-400 text-[11px]">{data.id}</span>
      </div>
      <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
        <div className="flex items-center justify-between py-0.5">
          <span className="text-slate-400">所属镇街</span>
          <span className="font-medium text-slate-800">{data.region || "—"}</span>
        </div>
        <div className="flex items-center justify-between py-0.5">
          <span className="text-slate-400">反映人员</span>
          <span className="text-slate-800 font-medium">{data.caller_name || "热线市民"}</span>
        </div>
        <div className="flex items-center justify-between py-0.5">
          <span className="text-slate-400">联系电话</span>
          <span className="font-mono text-slate-700">{data.caller_phone || "—"}</span>
        </div>
        <div className="flex items-center justify-between py-0.5">
          <span className="text-slate-400">受理渠道</span>
          <span className="text-slate-800">{data.channel || "市民服务热线"}</span>
        </div>
        <div className="flex items-center justify-between py-0.5">
          <span className="text-slate-400">紧急程度</span>
          <span className={`font-semibold ${data.urgency === "URGENT" ? "text-rose-600" : "text-slate-700"}`}>
            {urgency}
          </span>
        </div>
        <div className="flex items-center justify-between py-0.5">
          <span className="text-slate-400">登记时间</span>
          <span className="font-mono text-slate-700">{data.createdAt}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * 4. 工单空间地理微观地点标注卡片 (天地图高精打点)
 */
export function TicketGeoMapCard({ data }: { data: TicketVerdictData }) {
  const [geo, setGeo] = React.useState<{
    lng?: number;
    lat?: number;
    formattedAddress?: string;
    township?: string;
    loading: boolean;
    error?: string;
  }>({ loading: true });

  const [relatedPoints, setRelatedPoints] = React.useState<any[]>([]);

  const queryAddress = data.address || data.region || "";
  const clusterId = data.cluster_id || data.cluster_info?.id;

  // 1. 解析当前工单主地点
  React.useEffect(() => {
    let cancelled = false;
    if (!queryAddress || queryAddress === "辖区" || queryAddress === "未指定") {
      setGeo({ loading: false, error: "暂无有效微观地址" });
      return;
    }

    setGeo({ loading: true });
    geocodeAddressClient(queryAddress, data.region)
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.lng && res.lat) {
          setGeo({
            lng: res.lng,
            lat: res.lat,
            formattedAddress: res.formattedAddress || queryAddress,
            township: res.township || data.region,
            loading: false,
          });
        } else {
          setGeo({ loading: false, error: res.error || "未匹配到精确坐标" });
        }
      })
      .catch((err) => {
        if (!cancelled) setGeo({ loading: false, error: err.message });
      });

    return () => {
      cancelled = true;
    };
  }, [queryAddress, data.region]);

  // 2. 若属于多频聚类群组，拉取同专题关联工单的空间位置
  React.useEffect(() => {
    let cancelled = false;
    if (!clusterId) {
      setRelatedPoints([]);
      return;
    }

    fetch(`/api/clusters/${encodeURIComponent(clusterId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (res) => {
        if (cancelled || !res || !res.tickets) return;
        const peers = (res.tickets as any[]).filter(
          (t) => (t.id !== data.id && t.ticketId !== data.ticketId) && (t.address || t.location)
        );
        // 取前 4 件同专题工单微观地点解析
        const samplePeers = peers.slice(0, 4);
        const resolved: any[] = [];
        for (const peer of samplePeers) {
          const addr = peer.address || peer.location;
          try {
            const gd = await geocodeAddressClient(addr, peer.region);
            if (gd.success && gd.lng && gd.lat) {
              resolved.push({
                id: peer.id || peer.ticketId,
                lng: gd.lng,
                lat: gd.lat,
                title: peer.title || peer.summarizeTitle || "关联工单",
                address: gd.formattedAddress || addr,
                township: gd.township || peer.region,
                isMain: false,
              });
            }
          } catch {}
        }
        if (!cancelled) {
          setRelatedPoints(resolved);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [clusterId, data.id]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-3.5 bg-blue-600 rounded-full" />
          <span className="text-xs font-bold text-slate-800">事发地点空间微观标注</span>
          <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium border border-blue-100">
            天地图高精底图
          </span>
          {relatedPoints.length > 0 && (
            <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-medium border border-amber-200">
              同群组 {relatedPoints.length} 处关联诉求
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 font-medium">
          {data.region ? `📍 ${data.region}` : ""}
        </div>
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-start gap-1.5 text-xs text-slate-700">
          <MapPin className="w-3.5 h-3.5 text-blue-600 mt-0.5 shrink-0" />
          <div className="leading-tight">
            <span className="font-semibold text-slate-900">{queryAddress || "暂无详细地址"}</span>
            {geo.formattedAddress && geo.formattedAddress !== queryAddress && (
              <span className="text-slate-400 text-[11px] block mt-0.5">标准解析：{geo.formattedAddress}</span>
            )}
          </div>
        </div>

        {geo.lng && geo.lat ? (
          <div className="mt-2 rounded-lg overflow-hidden border border-slate-200 shadow-inner">
            <CivicGeoMap
              mode="single"
              height={220}
              point={{
                id: data.id,
                lng: geo.lng,
                lat: geo.lat,
                title: data.title || "当前事发地点",
                township: geo.township || data.region,
                address: geo.formattedAddress || queryAddress,
                color: data.urgency === "URGENT" ? "#F53F3F" : "#1E5AFF",
                isMain: true,
              }}
              relatedPoints={relatedPoints}
            />
          </div>
        ) : (
          <div className="h-28 bg-slate-50 rounded-lg border border-dashed border-slate-200 flex flex-col items-center justify-center text-xs text-slate-400 gap-1.5">
            <MapPin className="w-5 h-5 text-slate-300" />
            <span>{geo.loading ? "正在精准定位事发空间位置..." : geo.error || "暂无坐标数据"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

