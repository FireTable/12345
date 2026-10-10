import {
  CivicChatCompletion,
  CivicChatCompletionParams,
  SystemTwoConfig,
} from '../types';
import { ISystemTwoAdapter } from './types';
import { LocalMetalAdapter } from './local-metal-adapter';
import { NodeMetric, getNodeMetric, getAllNodeMetrics } from '../metrics';

interface ClusterNode {
  adapter: LocalMetalAdapter;
  endpoint: string;
  inFlight: number;
  isHealthy: boolean;
  lastChecked: number;
  consecutiveFailures: number;
}

/**
 * 多算力节点集群负载均衡连接池 (Pooled Metal Adapter)
 * 核心特性:
 * 1. Least-Connections (最小在途请求优先) 动态负载均衡调度
 * 2. 自动健康心跳探测与故障隔离 (Circuit Breaker)
 * 3. 故障自动转移 (Auto Failover)
 */
export class PooledMetalAdapter implements ISystemTwoAdapter {
  readonly name = 'PooledMetalAdapter (Multi-Node LLM Cluster)';
  private nodes: ClusterNode[] = [];
  private config: SystemTwoConfig;

  constructor(endpoints: string[], config: SystemTwoConfig = {}) {
    this.config = config;
    const cleanList = Array.from(
      new Set(endpoints.map((e) => (e || '').trim().replace(/\/+$/, '')).filter(Boolean))
    );

    this.nodes = cleanList.map((endpoint) => ({
      adapter: new LocalMetalAdapter({ ...config, endpoint }),
      endpoint,
      inFlight: 0,
      isHealthy: true,
      lastChecked: 0,
      consecutiveFailures: 0,
    }));
  }

  /**
   * 探测所有节点的可用性，至少有 1 个节点在线即算可用
   */
  async isAvailable(): Promise<boolean> {
    if (this.nodes.length === 0) return false;

    const probeResults = await Promise.all(
      this.nodes.map(async (node) => {
        const ok = await node.adapter.isAvailable();
        node.isHealthy = ok;
        node.lastChecked = Date.now();
        if (ok) node.consecutiveFailures = 0;
        return { endpoint: node.endpoint, ok };
      })
    );

    const onlineNodes = probeResults.filter((p) => p.ok).map((p) => p.endpoint);
    if (onlineNodes.length > 0) {
      console.log(
        `[SystemTwoCluster] ✅ 成功连接 ${onlineNodes.length}/${this.nodes.length} 个算力节点: [${onlineNodes.join(', ')}]`
      );
      return true;
    }

    return false;
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

  /**
   * 挑选最佳节点并执行推理，支持透明重试与故障转移
   */
  async chatCompletions(params: CivicChatCompletionParams): Promise<CivicChatCompletion> {
    // 0. 自动重试探活：对当前被标记为不健康的节点，若距离上次检查超过 3 秒，尝试探活复位
    for (const node of this.nodes) {
      if (!node.isHealthy && Date.now() - node.lastChecked > 3000) {
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

    const sortedCandidates = [...rotatedCandidates].sort((a, b) => {
      if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;
      return a.consecutiveFailures - b.consecutiveFailures;
    });

    let lastError: any = null;

    for (const node of sortedCandidates) {
      node.inFlight++;
      try {
        const result = await node.adapter.chatCompletions(params);
        node.inFlight = Math.max(0, node.inFlight - 1);
        node.isHealthy = true;
        node.consecutiveFailures = 0;
        this.lastUsedEndpoint = node.endpoint;
        return result;
      } catch (err: any) {
        node.inFlight = Math.max(0, node.inFlight - 1);
        node.consecutiveFailures++;
        lastError = err;

        // 如果是网络连接失败或超时，临时标记为不健康并切换至下一个节点
        if (
          err.name === 'AbortError' ||
          err.message?.includes('fetch failed') ||
          err.message?.includes('ECONNREFUSED') ||
          err.message?.includes('ETIMEDOUT')
        ) {
          node.isHealthy = false;
          console.warn(
            `[SystemTwoCluster] ⚠️ 节点 [${node.endpoint}] 连接异常 (${err.message})，已自动故障转移至备用节点...`
          );
        } else {
          // 如果是模型本身报错（如参数错误），直接抛出
          throw err;
        }
      }
    }

    throw lastError || new Error('[SystemTwoCluster] 所有算力集群节点均执行失败');
  }
}
