import { and, desc, eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { computeNodesTable, type ComputeNodeRecord } from "@/db/schema";
import { ensurePublicComputeNodesTable } from "@/lib/tenant/schema-manager";

export type ComputeNodeRole = "SYSTEM_TWO" | "EMBEDDING";
export type ComputeNodeProvider = "LOCAL" | "COLAB" | "CLOUD";

export interface ComputeNodePublicDto {
  id: string;
  name: string;
  role: ComputeNodeRole;
  provider: ComputeNodeProvider;
  endpoint: string;
  model: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  lastStatus: string | null;
  lastLatencyMs: number | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnvComputeNodeDto {
  id: string;
  name: string;
  role: ComputeNodeRole;
  provider: ComputeNodeProvider;
  endpoint: string;
  model: string | null;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  readOnly: true;
}

export interface ProbeResult {
  status: "ONLINE" | "OFFLINE";
  latencyMs: number;
  models: string[];
  httpStatus: number | null;
  error?: string;
}

let tableReadyPromise: Promise<void> | null = null;

export async function ensureComputeNodesTable(): Promise<void> {
  if (!tableReadyPromise) {
    tableReadyPromise = ensurePublicComputeNodesTable(sql).catch((err) => {
      tableReadyPromise = null;
      throw err;
    });
  }
  return tableReadyPromise;
}

export function maskApiKey(apiKey?: string | null): {
  hasApiKey: boolean;
  apiKeyHint: string | null;
} {
  const trimmed = (apiKey || "").trim();
  if (!trimmed) return { hasApiKey: false, apiKeyHint: null };
  if (trimmed.length <= 4) return { hasApiKey: true, apiKeyHint: "已配置" };
  return { hasApiKey: true, apiKeyHint: `****${trimmed.slice(-4)}` };
}

export function normalizeEndpointUrl(raw: string): string {
  const trimmed = (raw || "").trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("无效的 Endpoint URL 格式");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Endpoint 仅支持 http:// 或 https:// 协议");
  }
  return trimmed;
}

export function isLocalEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      /^192\.168\./.test(host) ||
      /^10\.\d+\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\.\d+\./.test(host) ||
      /^100\.\d+\./.test(host)
    );
  } catch {
    return false;
  }
}

export function normalizeRole(raw?: string | null): ComputeNodeRole {
  const r = (raw || "").trim().toUpperCase();
  if (r === "EMBEDDING") return "EMBEDDING";
  return "SYSTEM_TWO";
}

export function normalizeProvider(
  raw?: string | null,
  endpoint?: string
): ComputeNodeProvider {
  const p = (raw || "").trim().toUpperCase();
  if (p === "LOCAL" || p === "COLAB" || p === "CLOUD") return p;
  if (endpoint) {
    if (/trycloudflare\.com|ngrok|colab/i.test(endpoint)) return "COLAB";
    if (isLocalEndpoint(endpoint)) return "LOCAL";
    return "CLOUD";
  }
  return "COLAB";
}

export function toComputeNodePublicDto(row: ComputeNodeRecord): ComputeNodePublicDto {
  const { hasApiKey, apiKeyHint } = maskApiKey(row.apiKey);
  return {
    id: row.id,
    name: row.name,
    role: normalizeRole(row.role),
    provider: normalizeProvider(row.provider, row.endpoint),
    endpoint: row.endpoint,
    model: row.model ?? null,
    enabled: Boolean(row.enabled),
    hasApiKey,
    apiKeyHint,
    lastStatus: row.lastStatus ?? null,
    lastLatencyMs: row.lastLatencyMs ?? null,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function buildModelsUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, "");
  if (base.endsWith("/models")) return base;
  if (base.endsWith("/v1")) return `${base}/models`;
  return `${base}/v1/models`;
}

/**
 * 探测 OpenAI 兼容算力端点连通性与模型列表（区分本地与远程/Colab 隧道超时）。
 */
export async function probeComputeEndpoint(params: {
  endpoint: string;
  apiKey?: string | null;
  role?: string | null;
  provider?: string | null;
}): Promise<ProbeResult> {
  const endpoint = normalizeEndpointUrl(params.endpoint);
  const provider = normalizeProvider(params.provider, endpoint);
  const isLocal = isLocalEndpoint(endpoint) && provider !== "COLAB";
  const timeoutMs = isLocal ? 750 : 2500;

  const modelsUrl = buildModelsUrl(endpoint);
  const headers: Record<string, string> = {};
  const token = (params.apiKey || "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const start = performance.now();
  try {
    const res = await fetch(modelsUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.max(1, Math.round(performance.now() - start));

    if (!res.ok) {
      return {
        status: "OFFLINE",
        latencyMs,
        models: [],
        httpStatus: res.status,
        error: res.status === 401 || res.status === 403 ? `鉴权失败 (${res.status})` : `HTTP ${res.status}`,
      };
    }

    const json = (await res.json().catch(() => null)) as {
      data?: Array<{ id?: string }>;
    } | null;
    const models = Array.isArray(json?.data)
      ? json.data.map((m) => String(m?.id || "").trim()).filter(Boolean)
      : [];

    return {
      status: "ONLINE",
      latencyMs,
      models,
      httpStatus: res.status,
    };
  } catch (err: unknown) {
    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "OFFLINE",
      latencyMs,
      models: [],
      httpStatus: null,
      error: msg,
    };
  }
}

export async function listEnabledComputeNodes(
  role?: ComputeNodeRole
): Promise<ComputeNodeRecord[]> {
  await ensureComputeNodesTable();
  const cond = role
    ? and(eq(computeNodesTable.enabled, true), eq(computeNodesTable.role, role))
    : eq(computeNodesTable.enabled, true);
  return db
    .select()
    .from(computeNodesTable)
    .where(cond)
    .orderBy(desc(computeNodesTable.createdAt));
}

export async function getComputeNodeById(id: string): Promise<ComputeNodeRecord | null> {
  await ensureComputeNodesTable();
  const rows = await db
    .select()
    .from(computeNodesTable)
    .where(eq(computeNodesTable.id, id))
    .limit(1);
  return rows[0] || null;
}

function getEnvNodes(): EnvComputeNodeDto[] {
  const out: EnvComputeNodeDto[] = [];
  const s2Raw =
    process.env.SYSTEM_TWO_ENDPOINTS ||
    process.env.SYSTEM_TWO_ENDPOINT ||
    "http://127.0.0.1:8132/v1";
  const s2List = s2Raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const s2Mask = maskApiKey(process.env.OPENAI_API_KEY);
  s2List.forEach((ep, idx) => {
    const isLocal = isLocalEndpoint(ep);
    out.push({
      id: `env-s2-${idx + 1}`,
      name: `环境变量 System-2 #${idx + 1}`,
      role: "SYSTEM_TWO",
      provider: isLocal ? "LOCAL" : "CLOUD",
      endpoint: ep.replace(/\/+$/, ""),
      model: process.env.OPENAI_MODEL || null,
      hasApiKey: isLocal ? false : s2Mask.hasApiKey,
      apiKeyHint: isLocal ? null : s2Mask.apiKeyHint,
      readOnly: true,
    });
  });

  const embRaw =
    process.env.EMBEDDING_ENDPOINTS ||
    process.env.EMBEDDING_BASE_URL ||
    "https://api.edgefn.net/v1";
  const embList = embRaw
    .split(",")
    .map((s) => s.trim().replace(/^(?:cloud|local):/i, "").trim())
    .filter(Boolean);
  const embMask = maskApiKey(process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY);
  embList.forEach((ep, idx) => {
    const isLocal = isLocalEndpoint(ep);
    out.push({
      id: `env-emb-${idx + 1}`,
      name: `环境变量 Embedding #${idx + 1}`,
      role: "EMBEDDING",
      provider: isLocal ? "LOCAL" : "CLOUD",
      endpoint: ep.replace(/\/+$/, ""),
      model: process.env.EMBEDDING_MODEL || "BAAI/bge-m3",
      hasApiKey: isLocal ? false : embMask.hasApiKey,
      apiKeyHint: isLocal ? null : embMask.apiKeyHint,
      readOnly: true,
    });
  });

  return out;
}

export async function listComputeNodesForAdmin(): Promise<{
  envNodes: EnvComputeNodeDto[];
  nodes: ComputeNodePublicDto[];
}> {
  await ensureComputeNodesTable();
  const rows = await db
    .select()
    .from(computeNodesTable)
    .orderBy(desc(computeNodesTable.createdAt));

  return {
    envNodes: getEnvNodes(),
    nodes: rows.map(toComputeNodePublicDto),
  };
}

async function triggerPoolReloadIfNeeded(role: ComputeNodeRole) {
  if (role === "SYSTEM_TWO") {
    const { reloadSystemTwoPool } = await import("@/backend/model");
    await reloadSystemTwoPool().catch((err) => {
      console.warn("[compute-nodes] reloadSystemTwoPool warning:", err?.message || err);
    });
  }
}

export async function createComputeNode(input: {
  name: string;
  role?: string;
  provider?: string;
  endpoint: string;
  apiKey?: string | null;
  model?: string | null;
  enabled?: boolean;
  probeNow?: boolean;
}): Promise<{ node: ComputeNodePublicDto; probe?: ProbeResult }> {
  await ensureComputeNodesTable();
  const endpoint = normalizeEndpointUrl(input.endpoint);
  const name = (input.name || "").trim().slice(0, 128);
  if (!name) {
    throw new Error("节点名称不能为空");
  }
  const role = normalizeRole(input.role);
  const provider = normalizeProvider(input.provider, endpoint);
  const apiKey = input.apiKey?.trim().slice(0, 255) || null;
  const model = input.model?.trim().slice(0, 128) || null;
  const enabled = input.enabled !== false;
  const now = new Date();
  const id = `cn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let probe: ProbeResult | undefined;
  if (input.probeNow) {
    probe = await probeComputeEndpoint({ endpoint, apiKey, role, provider });
  }

  const [created] = await db
    .insert(computeNodesTable)
    .values({
      id,
      name,
      role,
      provider,
      endpoint,
      apiKey,
      model,
      enabled,
      lastStatus: probe ? probe.status : null,
      lastLatencyMs: probe ? probe.latencyMs : null,
      lastCheckedAt: probe ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await triggerPoolReloadIfNeeded(role);

  return { node: toComputeNodePublicDto(created), probe };
}

export async function updateComputeNode(
  id: string,
  patch: {
    name?: string;
    role?: string;
    provider?: string;
    endpoint?: string;
    apiKey?: string | null;
    clearApiKey?: boolean;
    model?: string | null;
    enabled?: boolean;
  }
): Promise<ComputeNodePublicDto | null> {
  const existing = await getComputeNodeById(id);
  if (!existing) return null;

  const nextEndpoint =
    typeof patch.endpoint === "string" && patch.endpoint.trim()
      ? normalizeEndpointUrl(patch.endpoint)
      : existing.endpoint;
  const nextRole = patch.role ? normalizeRole(patch.role) : normalizeRole(existing.role);
  const nextProvider = patch.provider
    ? normalizeProvider(patch.provider, nextEndpoint)
    : normalizeProvider(existing.provider, nextEndpoint);
  const nextName =
    typeof patch.name === "string" && patch.name.trim()
      ? patch.name.trim().slice(0, 128)
      : existing.name;

  const updateFields: Record<string, unknown> = {
    name: nextName,
    role: nextRole,
    provider: nextProvider,
    endpoint: nextEndpoint,
    updatedAt: new Date(),
  };

  if (typeof patch.enabled === "boolean") {
    updateFields.enabled = patch.enabled;
  }
  if (patch.model !== undefined) {
    updateFields.model = patch.model?.trim().slice(0, 128) || null;
  }
  if (patch.clearApiKey || patch.apiKey === null) {
    updateFields.apiKey = null;
  } else if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
    updateFields.apiKey = patch.apiKey.trim().slice(0, 255);
  }

  const [updated] = await db
    .update(computeNodesTable)
    .set(updateFields)
    .where(eq(computeNodesTable.id, id))
    .returning();

  if (normalizeRole(existing.role) === "SYSTEM_TWO" || nextRole === "SYSTEM_TWO") {
    await triggerPoolReloadIfNeeded("SYSTEM_TWO");
  }

  return toComputeNodePublicDto(updated);
}

export async function deleteComputeNode(id: string): Promise<boolean> {
  const existing = await getComputeNodeById(id);
  if (!existing) return false;

  await db.delete(computeNodesTable).where(eq(computeNodesTable.id, id));
  await triggerPoolReloadIfNeeded(normalizeRole(existing.role));
  return true;
}

export async function probeAndSaveComputeNode(id: string): Promise<{
  probe: ProbeResult;
  node: ComputeNodePublicDto;
} | null> {
  const existing = await getComputeNodeById(id);
  if (!existing) return null;

  const probe = await probeComputeEndpoint({
    endpoint: existing.endpoint,
    apiKey: existing.apiKey,
    role: existing.role,
    provider: existing.provider,
  });

  const [updated] = await db
    .update(computeNodesTable)
    .set({
      lastStatus: probe.status,
      lastLatencyMs: probe.latencyMs,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(computeNodesTable.id, id))
    .returning();

  return {
    probe,
    node: toComputeNodePublicDto(updated),
  };
}
