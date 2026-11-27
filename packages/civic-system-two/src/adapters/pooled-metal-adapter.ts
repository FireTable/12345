import {
  CivicChatCompletion,
  CivicChatCompletionParams,
  CivicChatStreamChunk,
  ClusterNodeObjectSpec,
  ClusterNodeSpec,
  SystemTwoConfig,
} from '../types';
import { ISystemTwoAdapter } from './types';
import { LocalMetalAdapter } from './local-metal-adapter';
import { NodeMetric, getNodeMetric, getAllNodeMetrics } from '../metrics';
import { createAbortError } from './abort-utils';

interface ClusterNode {
  adapter: LocalMetalAdapter;
  endpoint: string;
  apiKey?: string;
  model?: string;
  provider?: string;
  name?: string;
  maxConcurrency?: number;
  inFlight: number;
  isHealthy: boolean;
  lastChecked: number;
  consecutiveFailures: number;
}

function normalizeNodeSpec(spec: ClusterNodeSpec): ClusterNodeObjectSpec | null {
  if (typeof spec === 'string') {
    const endpoint = spec.trim().replace(/\/+$/, '');
    return endpoint ? { endpoint } : null;
  }
  const endpoint = (spec?.endpoint || '').trim().replace(/\/+$/, '');
  if (!endpoint) return null;
  const maxConcurrency =
    typeof spec.maxConcurrency === 'number' &&
    Number.isFinite(spec.maxConcurrency) &&
    spec.maxConcurrency >= 1
      ? Math.trunc(spec.maxConcurrency)
      : undefined;
  return {
    endpoint,
    apiKey: spec.apiKey?.trim() || undefined,
    model: spec.model?.trim() || undefined,
    provider: spec.provider?.trim() || undefined,
    name: spec.name?.trim() || undefined,
    maxConcurrency,
  };
}

/**
 * 多算力节点集群负载均衡连接池 (Pooled Metal Adapter)
 * 核心特性:
 * 1. Least-Connections (最小在途请求优先) 动态负载均衡调度
 * 2. 自动健康心跳探测与故障隔离 (Circuit Breaker)
 * 3. 故障自动转移 (Auto Failover)
 * 4. 支持热插拔 syncNodes (保留已有节点在途计数)
 */
export class PooledMetalAdapter implements ISystemTwoAdapter {
  readonly name = 'PooledMetalAdapter (Multi-Node LLM Cluster)';
  private nodes: ClusterNode[] = [];
  private config: SystemTwoConfig;
  private syncGeneration = 0;
  private availabilityProbePromise: Promise<boolean> | null = null;

  constructor(specs: ClusterNodeSpec[], config: SystemTwoConfig = {}) {
    this.config = config;
    this.syncNodes(specs);
  }

  /**
   * 平滑同步算力节点列表，保留未删除节点的 inFlight 与健康状态
   */
  syncNodes(specs: ClusterNodeSpec[]): void {
    const deduped = new Map<string, ClusterNodeObjectSpec>();
    for (const raw of specs) {
      const normalized = normalizeNodeSpec(raw);
      if (!normalized) continue;
      deduped.set(normalized.endpoint, normalized);
    }

    const existingByEndpoint = new Map(this.nodes.map((n) => [n.endpoint, n]));
    const nextNodes: ClusterNode[] = [];

    for (const [endpoint, spec] of deduped.entries()) {
      const existing = existingByEndpoint.get(endpoint);
      if (existing) {
        const configChanged =
          existing.apiKey !== spec.apiKey ||
          existing.model !== spec.model;
        if (configChanged) {
          existing.adapter = new LocalMetalAdapter({
            ...this.config,
            endpoint,
            apiKey: spec.apiKey ?? this.config.apiKey,
            model: spec.model ?? this.config.model,
            provider: spec.provider ?? this.config.provider,
          });
          existing.apiKey = spec.apiKey;
          existing.model = spec.model;
          existing.isHealthy = true;
          existing.consecutiveFailures = 0;
        }
        existing.provider = spec.provider;
        existing.name = spec.name;
        existing.maxConcurrency = spec.maxConcurrency;
        nextNodes.push(existing);
      } else {
        nextNodes.push({
          adapter: new LocalMetalAdapter({
            ...this.config,
            endpoint,
            apiKey: spec.apiKey ?? this.config.apiKey,
            model: spec.model ?? this.config.model,
            provider: spec.provider ?? this.config.provider,
          }),
          endpoint,
          apiKey: spec.apiKey,
          model: spec.model,
          provider: spec.provider,
          name: spec.name,
          maxConcurrency: spec.maxConcurrency,
          inFlight: 0,
          isHealthy: true,
          lastChecked: 0,
          consecutiveFailures: 0,
        });
      }
    }

    this.nodes = nextNodes;
    this.syncGeneration += 1;
    this.availabilityProbePromise = null;
  }

  getNodeMetas(): Array<{
    endpoint: string;
    provider?: string;
    model?: string;
    name?: string;
    maxConcurrency?: number;
    isHealthy: boolean;
    inFlight: number;
  }> {
    return this.nodes.map((n) => ({
      endpoint: n.endpoint,
      provider: n.provider,
      model: n.model,
      name: n.name,
      maxConcurrency: n.maxConcurrency,
      isHealthy: n.isHealthy,
      inFlight: n.inFlight,
    }));
  }

  /**
   * 探测所有节点的可用性，至少有 1 个节点在线即算可用（单飞去重防止并发探活风暴）
   */
  async isAvailable(): Promise<boolean> {
    if (this.nodes.length === 0) return false;
    if (this.availabilityProbePromise) {
      return this.availabilityProbePromise;
    }

    const gen = this.syncGeneration;
    const probeNodes = [...this.nodes];
    const probe = (async () => {
      try {
        const probeResults = await Promise.all(
          probeNodes.map(async (node) => {
            const ok = await node.adapter.isAvailable();
            if (this.syncGeneration === gen) {
              node.isHealthy = ok;
              node.lastChecked = Date.now();
              if (ok) node.consecutiveFailures = 0;
            }
            return { endpoint: node.endpoint, ok };
          })
        );

        const onlineNodes = probeResults.filter((p) => p.ok).map((p) => p.endpoint);
        if (onlineNodes.length > 0) {
          console.log(
            `[SystemTwoCluster] ✅ 成功连接 ${onlineNodes.length}/${probeNodes.length} 个算力节点: [${onlineNodes.join(', ')}]`
          );
          return true;
        }

        return false;
      } finally {
        if (this.syncGeneration === gen) {
          this.availabilityProbePromise = null;
        }
      }
    })();

    this.availabilityProbePromise = probe;
    return probe;
  }

  getHealthyEndpoints(): string[] {
    return this.nodes.filter((n) => n.isHealthy).map((n) => n.endpoint);
  }

  getActiveNodeCount(): number {
    return this.nodes.filter((n) => n.isHealthy).length;
  }

  getAllEndpoints(): string[] {
    return this.nodes.map((n) => n.endpoint);
  }

  getNodeMetric(endpoint: string): NodeMetric | null {
    return getNodeMetric(endpoint);
  }

  getAllNodeMetrics(): Record<string, NodeMetric> {
    return getAllNodeMetrics();
  }

  private rrCursor = 0;
  private lastUsedEndpoint: string | null = null;

  /** 最近一次成功完成 chatCompletions 的 endpoint。extract-node 用它来按节点统计最近工单。 */
  getLastUsedEndpoint(): string | null {
    return this.lastUsedEndpoint;
  }

  private isRetryableInfraError(err: any): boolean {
    const message = String(err?.message || '');
    return (
      err?.name === 'AbortError' ||
      err?.name === 'TimeoutError' ||
      message.includes('fetch failed') ||
      message.includes('ECONNREFUSED') ||
      message.includes('ETIMEDOUT') ||
      message.includes('HTTP 401') ||
      message.includes('HTTP 5')
    );
  }

  private async selectCandidates(signal?: AbortSignal): Promise<ClusterNode[]> {
    if (this.nodes.length === 0) {
      throw new Error('[SystemTwoCluster] 算力集群中没有配置任何可用节点');
    }

    if (signal?.aborted) {
      throw createAbortError(signal);
    }

    // 0. 自动重试探活：对当前被标记为不健康的节点，若距离上次检查超过 60 秒，尝试探活复位
    for (const node of this.nodes) {
      if (!node.isHealthy && Date.now() - node.lastChecked > 60_000) {
        node.lastChecked = Date.now();
        node.adapter.isAvailable().then((ok) => {
          if (ok) {
            node.isHealthy = true;
            node.consecutiveFailures = 0;
            console.log(`[SystemTwoCluster] 节点 [${node.endpoint}] 已恢复健康，重新加入调度池。`);
          }
        }).catch(() => {});
      }
    }

    // 1. 获取候选节点（优先健康节点，若全不健康则尝试重置探测）
    let candidates = this.nodes.filter((n) => n.isHealthy);
    if (candidates.length === 0) {
      console.warn('[SystemTwoCluster] 暂无健康节点，正在尝试恢复所有节点并探测...');
      await this.isAvailable();
      if (signal?.aborted) {
        throw createAbortError(signal);
      }
      candidates = this.nodes.filter((n) => n.isHealthy);
      if (candidates.length === 0) {
        // 如果依然全部不可达，选一个失败次数最少的节点做最后尝试
        candidates = [...this.nodes].sort((a, b) => a.consecutiveFailures - b.consecutiveFailures);
      }
    }

    // 2. 轮询游标配合 Least-Connections，确保各节点均能获得请求调度并实时刷新耗时
    const offset = this.rrCursor++ % Math.max(1, candidates.length);
    const rotatedCandidates = [
      ...candidates.slice(offset),
      ...candidates.slice(0, offset),
    ];

    return [...rotatedCandidates].sort((a, b) => {
      if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;
      return a.consecutiveFailures - b.consecutiveFailures;
    });
  }

  /**
   * 挑选最佳节点并执行推理，支持透明重试与故障转移
   */
  async chatCompletions(params: CivicChatCompletionParams): Promise<CivicChatCompletion> {
    const sortedCandidates = await this.selectCandidates(params.signal);
    let lastError: any = null;

    for (const node of sortedCandidates) {
      if (params.signal?.aborted) {
        throw createAbortError(params.signal);
      }
      node.inFlight++;
      let decremented = false;
      try {
        const result = await node.adapter.chatCompletions(params);
        node.inFlight = Math.max(0, node.inFlight - 1);
        decremented = true;
        node.isHealthy = true;
        node.consecutiveFailures = 0;
        this.lastUsedEndpoint = node.endpoint;
        return result;
      } catch (err: any) {
        node.inFlight = Math.max(0, node.inFlight - 1);
        decremented = true;
        if (params.signal?.aborted) {
          throw err;
        }
        node.consecutiveFailures++;
        lastError = err;

        // 如果是网络连接失败、超时或上游鉴权/服务异常，临时标记为不健康并切换至下一个节点
        if (this.isRetryableInfraError(err)) {
          node.isHealthy = false;
          node.lastChecked = Date.now();
          console.warn(
            `[SystemTwoCluster] ⚠️ 节点 [${node.endpoint}] 连接异常 (${err.message})，已自动故障转移至备用节点...`
          );
        } else {
          // 如果是模型本身报错（如参数错误），直接抛出
          throw err;
        }
      } finally {
        if (!decremented) {
          node.inFlight = Math.max(0, node.inFlight - 1);
        }
      }
    }

    throw lastError || new Error('[SystemTwoCluster] 所有算力集群节点均执行失败');
  }

  async *chatCompletionsStream(
    params: CivicChatCompletionParams
  ): AsyncGenerator<CivicChatStreamChunk> {
    const sortedCandidates = await this.selectCandidates(params.signal);
    let lastError: any = null;

    for (const node of sortedCandidates) {
      if (params.signal?.aborted) {
        throw createAbortError(params.signal);
      }
      let hasYielded = false;
      let decremented = false;
      node.inFlight++;

      try {
        for await (const chunk of node.adapter.chatCompletionsStream(params)) {
          if (
            chunk.deltaContent ||
            chunk.deltaReasoning ||
            (chunk.finishReason !== undefined && chunk.finishReason !== null)
          ) {
            hasYielded = true;
            this.lastUsedEndpoint = node.endpoint;
          }
          yield chunk;
        }
        node.inFlight = Math.max(0, node.inFlight - 1);
        decremented = true;
        node.isHealthy = true;
        node.consecutiveFailures = 0;
        this.lastUsedEndpoint = node.endpoint;
        return;
      } catch (err: any) {
        node.inFlight = Math.max(0, node.inFlight - 1);
        decremented = true;
        if (params.signal?.aborted) {
          throw err;
        }
        lastError = err;

        if (this.isRetryableInfraError(err)) {
          node.consecutiveFailures++;
          node.isHealthy = false;
          node.lastChecked = Date.now();
          if (hasYielded) {
            throw err;
          }
          console.warn(
            `[SystemTwoCluster] ⚠️ 节点 [${node.endpoint}] 流式连接异常 (${err.message})，已自动故障转移至备用节点...`
          );
        } else {
          throw err;
        }
      } finally {
        if (!decremented) {
          node.inFlight = Math.max(0, node.inFlight - 1);
        }
      }
    }

    throw lastError || new Error('[SystemTwoCluster] 所有算力集群节点均执行失败');
  }
}
