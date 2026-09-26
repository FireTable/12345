import type { CivicTicketInput, CivicSystemOneDecision, SystemOneConfig, CivicEvaluateOptions } from "./types";
import type { DecisionAdapter } from "./adapters/types";
import { FallbackAdapter } from "./adapters/fallback-adapter";
import { ONNXAdapter } from "./adapters/onnx-adapter";

/**
 * 12345 政务快思考极速预审决策引擎
 * 核心驱动：本地轻量级 ONNX 神经编码器 (<1ms 极速推理) + 规则兜底
 */
export class SystemOneEngine {
  private activeAdapter: DecisionAdapter;
  private config: SystemOneConfig;

  private constructor(adapter: DecisionAdapter, config: SystemOneConfig) {
    this.activeAdapter = adapter;
    this.config = config;
  }

  static async create(config: SystemOneConfig = {}): Promise<SystemOneEngine> {
    if (config.preferredMode === "fallback") {
      return new SystemOneEngine(new FallbackAdapter(), config);
    }

    // 默认主力：纯本地 ONNX 引擎
    const onnx = new ONNXAdapter({
      modelDir: config.onnxModelDir,
      intraOpNumThreads: config.intraOpNumThreads,
    });

    if (await onnx.isAvailable()) {
      return new SystemOneEngine(onnx, config);
    }

    console.warn("[SystemOneEngine] ONNX model files not found, falling back to rule engine.");
    return new SystemOneEngine(new FallbackAdapter(), config);
  }

  get currentAdapter(): "onnx" | "fallback" {
    return this.activeAdapter.name as "onnx" | "fallback";
  }

  async evaluate(ticket: CivicTicketInput, options?: CivicEvaluateOptions): Promise<CivicSystemOneDecision> {
    try {
      return await this.activeAdapter.evaluate(ticket, options);
    } catch (err) {
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
