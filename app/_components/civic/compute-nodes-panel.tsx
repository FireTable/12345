"use client";

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Cpu,
  Plus,
  RefreshCw,
  Trash2,
  Activity,
  Power,
  KeyRound,
  CheckCircle2,
  XCircle,
  Loader2,
  Cloud,
  Server,
  Sparkles,
} from "lucide-react";
import { ConfirmDialog } from "@/app/_components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/_components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";

export interface EnvComputeNode {
  id?: string;
  name: string;
  role: "SYSTEM_TWO" | "EMBEDDING" | string;
  provider?: "LOCAL" | "COLAB" | "CLOUD" | string;
  endpoint: string;
  model?: string | null;
  hasApiKey?: boolean;
  apiKeyHint?: string | null;
  enabled?: boolean;
  lastStatus?: string | null;
  lastLatencyMs?: number | null;
}

export interface DynamicComputeNode {
  id: string;
  name: string;
  role: "SYSTEM_TWO" | "EMBEDDING" | string;
  provider: "LOCAL" | "COLAB" | "CLOUD" | string;
  endpoint: string;
  model?: string | null;
  enabled: boolean;
  hasApiKey?: boolean;
  apiKeyHint?: string | null;
  lastStatus?: string | null;
  lastLatencyMs?: number | null;
  lastCheckedAt?: string | null;
}

interface ProbeOutcome {
  online: boolean;
  latencyMs: number | null;
  models: string[];
  error?: string;
}

const ROLE_LABELS: Record<string, string> = {
  SYSTEM_TWO: "System-2 大模型",
  EMBEDDING: "Embedding 向量",
};

function providerBadge(provider?: string | null) {
  const p = (provider || "LOCAL").toUpperCase();
  if (p === "COLAB") {
    return {
      label: "COLAB GPU",
      cls: "bg-amber-50 text-amber-800 border-amber-200",
    };
  }
  if (p === "CLOUD") {
    return {
      label: "CLOUD API",
      cls: "bg-sky-50 text-sky-700 border-sky-200",
    };
  }
  return {
    label: "LOCAL",
    cls: "bg-slate-100 text-slate-700 border-slate-200",
  };
}

export function ComputeNodesPanel({
  onSummaryChange,
}: {
  onSummaryChange?: (summary: {
    envCount: number;
    dynamicCount: number;
    onlineCount: number;
  }) => void;
}) {
  const [envNodes, setEnvNodes] = useState<EnvComputeNode[]>([]);
  const [nodes, setNodes] = useState<DynamicComputeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingNode, setDeletingNode] = useState<DynamicComputeNode | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 接入弹窗状态（绝不回显或持久留存明文 apiKey）
  const [addOpen, setAddOpen] = useState(false);
  const [formName, setFormName] = useState("Colab L4 GPU 节点");
  const [formRole, setFormRole] = useState<"SYSTEM_TWO" | "EMBEDDING">("SYSTEM_TWO");
  const [formProvider, setFormProvider] = useState<"COLAB" | "LOCAL" | "CLOUD">("COLAB");
  const [formEndpoint, setFormEndpoint] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formModel, setFormModel] = useState("");
  const [probingModal, setProbingModal] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeOutcome | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchNodes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/compute-nodes");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "获取算力节点列表失败");
      }
      const payload = json.data || json;
      const nextEnv = Array.isArray(payload?.envNodes) ? (payload.envNodes as EnvComputeNode[]) : [];
      const nextNodes = Array.isArray(payload?.nodes) ? (payload.nodes as DynamicComputeNode[]) : [];
      setEnvNodes(nextEnv);
      setNodes(nextNodes);
      if (onSummaryChange) {
        const onlineDyn = nextNodes.filter((n) => n.enabled && n.lastStatus === "ONLINE").length;
        const onlineEnv = nextEnv.filter((n) => n.lastStatus === "ONLINE").length;
        onSummaryChange({
          envCount: nextEnv.length,
          dynamicCount: nextNodes.length,
          onlineCount: onlineDyn + onlineEnv,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "获取算力节点失败");
    } finally {
      setLoading(false);
    }
  }, [onSummaryChange]);

  useEffect(() => {
    void fetchNodes();
  }, [fetchNodes]);

  function resetModal() {
    setFormName("Colab L4 GPU 节点");
    setFormRole("SYSTEM_TWO");
    setFormProvider("COLAB");
    setFormEndpoint("");
    setFormApiKey("");
    setFormModel("");
    setProbeResult(null);
  }

  async function handleProbeTemp() {
    if (!formEndpoint.trim()) {
      toast.error("请先填写 Endpoint URL");
      return;
    }
    setProbingModal(true);
    setProbeResult(null);
    try {
      const res = await fetch("/api/admin/compute-nodes/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: formEndpoint.trim(),
          apiKey: formApiKey.trim() || undefined,
          role: formRole,
          provider: formProvider,
        }),
      });
      const json = await res.json().catch(() => ({}));
      const data = json?.data?.probe || json?.data || json;
      const online =
        typeof data?.online === "boolean"
          ? data.online
          : typeof data?.ok === "boolean"
            ? data.ok
            : typeof data?.status === "string"
              ? data.status.toUpperCase() === "ONLINE"
              : Boolean(json?.success);
      const latencyMs = typeof data?.latencyMs === "number" ? data.latencyMs : null;
      const models = Array.isArray(data?.models) ? (data.models as string[]) : [];
      const errorMsg = !online ? (data?.error || json?.error || "探活失败") : undefined;

      setProbeResult({
        online: res.ok && online,
        latencyMs,
        models,
        error: res.ok ? errorMsg : json?.error || `HTTP ${res.status}`,
      });

      if (res.ok && online) {
        toast.success(`探测成功${latencyMs != null ? ` (${latencyMs} ms)` : ""}`);
      } else {
        toast.error(errorMsg || json?.error || "节点连通性探测失败");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "探测请求异常";
      setProbeResult({ online: false, latencyMs: null, models: [], error: msg });
      toast.error(msg);
    } finally {
      setProbingModal(false);
    }
  }

  async function handleCreateNode(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim() || !formEndpoint.trim()) {
      toast.error("请填写节点名称与 Endpoint URL");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/compute-nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          role: formRole,
          provider: formProvider,
          endpoint: formEndpoint.trim(),
          ...(formApiKey.trim() ? { apiKey: formApiKey.trim() } : {}),
          ...(formModel.trim() ? { model: formModel.trim() } : {}),
          probe: true,
          probeNow: true,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `创建失败 (${res.status})`);
      }
      toast.success(`已接入算力节点「${formName.trim()}」`);
      setAddOpen(false);
      resetModal();
      await fetchNodes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加入算力池失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleEnabled(node: DynamicComputeNode) {
    if (togglingId) return;
    setTogglingId(node.id);
    try {
      const res = await fetch(`/api/admin/compute-nodes/${encodeURIComponent(node.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !node.enabled }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "更新节点状态失败");
      }
      toast.success(!node.enabled ? `已启用「${node.name}」` : `已停用「${node.name}」`);
      await fetchNodes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleProbeExisting(node: DynamicComputeNode) {
    if (probingId) return;
    setProbingId(node.id);
    try {
      const res = await fetch("/api/admin/compute-nodes/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: node.id }),
      });
      const json = await res.json().catch(() => ({}));
      const data = json?.data?.probe || json?.data || json;
      const online =
        typeof data?.online === "boolean"
          ? data.online
          : typeof data?.ok === "boolean"
            ? data.ok
            : typeof data?.status === "string"
              ? data.status.toUpperCase() === "ONLINE"
              : false;
      const latency = typeof data?.latencyMs === "number" ? data.latencyMs : null;
      if (!res.ok) {
        throw new Error(json?.error || `探活失败 (${res.status})`);
      }
      if (online) {
        toast.success(`「${node.name}」在线${latency != null ? ` · ${latency} ms` : ""}`);
      } else {
        toast.error(`「${node.name}」离线：${data?.error || json?.error || "不可达"}`);
      }
      await fetchNodes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "节点探活失败");
    } finally {
      setProbingId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingNode || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/compute-nodes/${encodeURIComponent(deletingNode.id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "删除节点失败");
      }
      toast.success(`已移除算力节点「${deletingNode.name}」`);
      setDeletingNode(null);
      await fetchNodes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-6 mb-8">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Cpu className="h-4 w-4 text-blue-600 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900">
              算力集群与 Colab GPU 热插拔管理
            </h2>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              ({envNodes.length} 基础 + {nodes.length} 动态挂载)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            支持热接入 Google Colab L4/T4 GPU（Cloudflare / Tailscale 隧道）与远程 OpenAI 兼容节点，Token 仅服务端加密/脱敏存储
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchNodes()}
            className="btn btn--default h-[34px] sm:h-[32px] px-3 text-xs whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${loading ? "animate-spin" : ""}`} />
            <span>刷新节点</span>
          </button>
          <button
            type="button"
            onClick={() => {
              resetModal();
              setAddOpen(true);
            }}
            className="btn btn--primary h-[34px] sm:h-[32px] px-3.5 text-xs whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span>接入 Colab GPU / 算力节点</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 overflow-hidden shadow-2xs">
        {/* 环境变量基础节点 */}
        <div className="px-4 sm:px-5 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Server className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <span>环境变量基础节点（只读）</span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono break-all">
            SYSTEM_TWO_ENDPOINTS / EMBED_ENDPOINTS
          </span>
        </div>

        {envNodes.length === 0 ? (
          <div className="px-4 sm:px-5 py-4 text-xs text-slate-400 border-b border-slate-100">
            未检测到环境变量静态配置节点
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border-b border-slate-100">
            {envNodes.map((env, idx) => {
              const p = providerBadge(env.provider || "LOCAL");
              return (
                <div
                  key={env.id || `${env.role}-${env.endpoint}-${idx}`}
                  className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 sm:gap-4 flex-wrap"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900">{env.name}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
                        {ROLE_LABELS[env.role] || env.role}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${p.cls}`}>
                        {p.label}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-500 border border-slate-200 whitespace-nowrap">
                        只读 ENV
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 min-w-0 break-all">
                      {env.endpoint}
                      {env.model ? ` · 模型: ${env.model}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[11px] w-full sm:w-auto sm:shrink-0">
                    {env.hasApiKey && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-600 font-mono">
                        <KeyRound className="h-3 w-3 text-slate-400 shrink-0" />
                        {env.apiKeyHint || "已配置"}
                      </span>
                    )}
                    {env.lastStatus === "ONLINE" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium tabular-nums">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        在线{env.lastLatencyMs != null ? ` ${env.lastLatencyMs}ms` : ""}
                      </span>
                    ) : env.lastStatus === "OFFLINE" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 font-medium">
                        <XCircle className="h-3 w-3 shrink-0" />
                        离线
                      </span>
                    ) : (
                      <span className="text-slate-400">由运行态探活检测</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 动态挂载算力节点 */}
        <div className="px-4 sm:px-5 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Cloud className="h-3.5 w-3.5 text-blue-600 shrink-0" />
            <span>动态热插拔算力池</span>
          </div>
          <span className="text-[11px] text-slate-400">
            新增、启停或删除后立即热更新算力调度池
          </span>
        </div>

        {loading && nodes.length === 0 ? (
          <div className="px-5 py-6 text-xs text-slate-400 text-center">
            正在加载动态算力节点…
          </div>
        ) : nodes.length === 0 ? (
          <div className="px-5 py-6 text-xs text-slate-500 text-center">
            尚未挂载动态算力节点，点击右上角「接入 Colab GPU / 算力节点」即可热插拔扩缩容。
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {nodes.map((node) => {
              const p = providerBadge(node.provider);
              const isOnline = node.lastStatus === "ONLINE";
              const isOffline = node.lastStatus === "OFFLINE";
              return (
                <div
                  key={node.id}
                  className={`px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 sm:gap-4 flex-wrap transition-colors ${
                    !node.enabled ? "bg-slate-50/70 opacity-75" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900">{node.name}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
                        {ROLE_LABELS[node.role] || node.role}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${p.cls}`}>
                        {p.label}
                      </span>
                      {!node.enabled && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-600 whitespace-nowrap">
                          已停用
                        </span>
                      )}
                      {isOnline ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                          <CheckCircle2 className="h-3 w-3 shrink-0" />
                          在线
                        </span>
                      ) : isOffline ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
                          <XCircle className="h-3 w-3 shrink-0" />
                          离线
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500 border border-slate-200 whitespace-nowrap">
                          待探活
                        </span>
                      )}
                      {node.lastLatencyMs != null && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
                          {node.lastLatencyMs} ms
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] font-mono text-slate-500 flex items-center gap-2 flex-wrap min-w-0">
                      <span className="min-w-0 break-all" title={node.endpoint}>
                        {node.endpoint}
                      </span>
                      {node.model && (
                        <span className="text-slate-600 break-all">· 模型: {node.model}</span>
                      )}
                      <span className="inline-flex items-center gap-1 text-slate-500 whitespace-nowrap">
                        <KeyRound className="h-3 w-3 text-slate-400 shrink-0" />
                        {node.hasApiKey ? node.apiKeyHint || "已配置密钥" : "无密钥"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:shrink-0">
                    <button
                      type="button"
                      disabled={togglingId === node.id}
                      onClick={() => void handleToggleEnabled(node)}
                      className={`btn h-[34px] sm:h-[30px] px-2.5 text-xs whitespace-nowrap ${
                        node.enabled
                          ? "btn--default text-emerald-700 border-emerald-200 hover:border-emerald-400"
                          : "btn--default text-slate-600"
                      }`}
                      title={node.enabled ? "点击停用此算力节点" : "点击启用此算力节点"}
                    >
                      <Power className="h-3.5 w-3.5 shrink-0" />
                      <span>{node.enabled ? "已启用" : "已停用"}</span>
                    </button>

                    <button
                      type="button"
                      disabled={probingId === node.id}
                      onClick={() => void handleProbeExisting(node)}
                      className="btn btn--default h-[34px] sm:h-[30px] px-2.5 text-xs text-blue-700 border-blue-200 hover:border-blue-400 whitespace-nowrap"
                    >
                      {probingId === node.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                      ) : (
                        <Activity className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>{probingId === node.id ? "测速中" : "探活测速"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDeletingNode(node)}
                      className="btn h-[34px] sm:h-[30px] px-2.5 text-xs text-rose-700 border border-rose-200 bg-rose-50 hover:bg-rose-100 whitespace-nowrap"
                    >
                      <Trash2 className="h-3.5 w-3.5 shrink-0" />
                      <span>删除</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 接入 Colab GPU / 算力节点弹窗 */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetModal();
        }}
      >
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[500px] max-h-[90dvh] overflow-y-auto gap-4 border-[var(--c-border)] bg-[var(--c-surface)] p-0 shadow-xl rounded-xl text-[var(--c-ink)]">
          <DialogHeader className="space-y-1.5 px-5 pt-5 text-left">
            <DialogTitle className="text-[15px] font-semibold text-[var(--c-ink)] flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-600 shrink-0" />
              <span>接入 Colab GPU / 远程算力节点</span>
            </DialogTitle>
            <DialogDescription className="text-[12px] text-[var(--c-ink-3)]">
              支持 OpenAI 兼容接口（/v1/models, /v1/chat/completions, /v1/embeddings），加入后即时热重载至 System-2 / Embedding 调度池。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateNode} className="space-y-3 px-5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                节点名称 <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="例如：Colab L4 GPU 节点"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  算力角色
                </label>
                <Select
                  value={formRole}
                  onValueChange={(v) => setFormRole(v as "SYSTEM_TWO" | "EMBEDDING")}
                >
                  <SelectTrigger className="w-full h-9 bg-white border-slate-200 text-xs text-slate-900 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SYSTEM_TWO">System-2 大模型</SelectItem>
                    <SelectItem value="EMBEDDING">Embedding 向量</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  算力来源
                </label>
                <Select
                  value={formProvider}
                  onValueChange={(v) =>
                    setFormProvider(v as "COLAB" | "LOCAL" | "CLOUD")
                  }
                >
                  <SelectTrigger className="w-full h-9 bg-white border-slate-200 text-xs text-slate-900 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="COLAB">COLAB GPU</SelectItem>
                    <SelectItem value="LOCAL">LOCAL 本地节点</SelectItem>
                    <SelectItem value="CLOUD">CLOUD 云端 API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Endpoint URL <span className="text-rose-500">*</span>
              </label>
              <input
                type="url"
                value={formEndpoint}
                onChange={(e) => setFormEndpoint(e.target.value)}
                placeholder="例如：https://xxx.trycloudflare.com/v1"
                className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Bearer Token（密码输入）
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  placeholder="输入脚本生成的 Bearer Token"
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  模型名称（可选）
                </label>
                <input
                  type="text"
                  value={formModel}
                  onChange={(e) => setFormModel(e.target.value)}
                  placeholder="留空则自动探测/默认"
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* 探活回显结果 */}
            {probeResult && (
              <div
                className={`rounded-lg border p-2.5 text-xs space-y-1.5 ${
                  probeResult.online
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-rose-50 border-rose-200 text-rose-800"
                }`}
              >
                <div className="flex items-center justify-between font-semibold gap-2 flex-wrap">
                  <span className="flex items-center gap-1.5">
                    {probeResult.online ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                    )}
                    {probeResult.online ? "连通性探测通过" : "节点连接失败"}
                  </span>
                  {probeResult.latencyMs != null && (
                    <span className="font-mono tabular-nums text-[11px]">
                      延迟 {probeResult.latencyMs} ms
                    </span>
                  )}
                </div>
                {probeResult.error && (
                  <div className="text-[11px] break-words">{probeResult.error}</div>
                )}
                {probeResult.models.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <span className="text-[11px] text-emerald-700">可用模型：</span>
                    {probeResult.models.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setFormModel(m)}
                        className="px-2 py-0.5 rounded bg-white border border-emerald-300 text-[10px] font-mono text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                        title="点击填入此模型名称"
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="flex-col-reverse sm:flex-row flex-wrap justify-between sm:justify-between gap-2 border-t border-[var(--c-border-soft)] -mx-5 px-5 py-3">
              <button
                type="button"
                disabled={probingModal || submitting || !formEndpoint.trim()}
                onClick={() => void handleProbeTemp()}
                className="btn btn--default text-xs text-blue-700 border-blue-200 hover:border-blue-400 justify-center"
              >
                {probingModal ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                ) : (
                  <Activity className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>{probingModal ? "探测中…" : "先探测连通性"}</span>
              </button>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="btn btn--default text-xs"
                  disabled={submitting}
                  onClick={() => {
                    setAddOpen(false);
                    resetModal();
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn btn--primary text-xs"
                  disabled={submitting || !formName.trim() || !formEndpoint.trim()}
                >
                  {submitting ? "加入中…" : "确认加入算力池"}
                </button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除算力节点确认弹窗 */}
      <ConfirmDialog
        open={Boolean(deletingNode)}
        title="确认移除该算力节点？"
        description={
          deletingNode
            ? `节点「${deletingNode.name}」(${deletingNode.endpoint}) 将从算力池移除并即时停止调度。`
            : undefined
        }
        confirmLabel="确认移除"
        destructive
        pending={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeletingNode(null);
        }}
      />
    </div>
  );
}
