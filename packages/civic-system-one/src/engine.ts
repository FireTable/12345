import type { CivicTicketInput, CivicSystemOneDecision, SystemOneConfig, CivicEvaluateOptions } from "./types";
import type { DecisionAdapter } from "./adapters/types";
import { FallbackAdapter } from "./adapters/fallback-adapter";
import { MPSAdapter } from "./adapters/mps-adapter";
import { ONNXAdapter } from "./adapters/onnx-adapter";

export class SystemOneEngine {
  private activeAdapter: DecisionAdapter;
  private config: SystemOneConfig;

  private constructor(adapter: DecisionAdapter, config: SystemOneConfig) {
    this.activeAdapter = adapter;
    this.config = config;
  }

  static async create(config: SystemOneConfig = {}): Promise<SystemOneEngine> {
    const mode = config.preferredMode || "auto";

    if (mode === "fallback") {
      return new SystemOneEngine(new FallbackAdapter(), config);
    }

    if (mode === "mps") {
      const mps = new MPSAdapter({ endpoint: config.mpsEndpoint });
      if (await mps.isAvailable()) {
        return new SystemOneEngine(mps, config);
      }
    }

    if (mode === "onnx") {
      const onnx = new ONNXAdapter({ modelDir: config.onnxModelDir });
      if (await onnx.isAvailable()) {
        return new SystemOneEngine(onnx, config);
      }
    }

    // "auto" 模式：自适应优先级 MPS -> ONNX -> Fallback
    const mpsCandidate = new MPSAdapter({ endpoint: config.mpsEndpoint });
    if (await mpsCandidate.isAvailable()) {
      return new SystemOneEngine(mpsCandidate, config);
    }

    const onnxCandidate = new ONNXAdapter({ modelDir: config.onnxModelDir });
    if (await onnxCandidate.isAvailable()) {
      return new SystemOneEngine(onnxCandidate, config);
    }

    // 终极兜底
    return new SystemOneEngine(new FallbackAdapter(), config);
  }

  get currentAdapter(): "mps" | "onnx" | "fallback" {
    return this.activeAdapter.name;
  }

  async evaluate(ticket: CivicTicketInput, options?: CivicEvaluateOptions): Promise<CivicSystemOneDecision> {
    try {
      return await this.activeAdapter.evaluate(ticket, options);
    } catch (err) {
      // 若硬件服务中途崩溃，热切换至 Fallback 保证生产系统永不宕机
      console.warn(`[SystemOneEngine] Active adapter '${this.activeAdapter.name}' failed, falling back to rule engine:`, err);
      const fallback = new FallbackAdapter();
      return await fallback.evaluate(ticket, options);
    }
  }

  async close(): Promise<void> {
    if (this.activeAdapter.close) {
      await this.activeAdapter.close();
    }
  }
}
