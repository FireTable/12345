import type { DecisionAdapter } from "./types";
import type {
  CivicTicketInput,
  CivicSystemOneDecision,
  CivicCategory,
  CivicIntent,
  CivicEvaluateOptions,
} from "../types";
import { CATEGORY_NAME_MAP } from "../presets/categories";
import { buildCivicQuestions, buildCivicCriteria } from "../presets/criteria";

export interface MPSAdapterOptions {
  endpoint?: string;
  timeoutMs?: number;
}

export class MPSAdapter implements DecisionAdapter {
  readonly name = "mps" as const;
  private endpoint: string;
  private timeoutMs: number;

  constructor(options?: MPSAdapterOptions) {
    this.endpoint = options?.endpoint || process.env.LAYA_MPS_ENDPOINT || "http://127.0.0.1:8000";
    this.timeoutMs = options?.timeoutMs || 2000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 600);
      const res = await fetch(`${this.endpoint}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  async evaluate(ticket: CivicTicketInput, options?: CivicEvaluateOptions): Promise<CivicSystemOneDecision> {
    const t0 = performance.now();
    const content = (ticket.title ? `${ticket.title}。\n` : "") + ticket.content;

    const payload = {
      state: content,
      questions: buildCivicQuestions(options),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.endpoint}/v1/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`MPS service returned status ${res.status}`);
      }

      const data = (await res.json()) as any;
      const latencyMs = data.metrics?.request_ms ?? Number((performance.now() - t0).toFixed(2));
      const answers = data.answers || {};

      // 解析 Laya MPS 核心三大约束原语返回
      const intentAns = answers.intent;
      const categoryAns = answers.category;
      const urgencyAns = answers.urgency;
      const stabilityAns = answers.stability_risk;
      const reasonableAns = answers.is_reasonable;

      const intent = (intentAns?.choice || "COMPLAINT") as CivicIntent;
      const intentProbability = intentAns?.probabilities?.[intent] ?? intentAns?.confidence ?? 0.95;

      const category = (categoryAns?.choice || "social_governance") as CivicCategory;
      const categoryProbability = categoryAns?.probabilities?.[category] ?? categoryAns?.confidence ?? 0.92;
      const categoryDistribution = categoryAns?.probabilities ?? { [category]: categoryProbability };

      // 紧迫度连续分值映射 (0.0 ~ 3.0)
      const urgencyScore = typeof urgencyAns?.score === "number" ? urgencyAns.score : 1.0;
      const urgencyLevel = (Math.min(3, Math.max(0, Math.round(urgencyScore)))) as 0 | 1 | 2 | 3;
      const slaHours = urgencyLevel === 0 ? 0 : urgencyLevel === 3 ? 2 : urgencyLevel === 2 ? 24 : 120;

      // Noul 原语输出的是 calibrated P(true)
      const stabilityRiskProb = stabilityAns?.noul ?? 0.01;
      const stabilityRisk = stabilityRiskProb > 0.5;

      const isReasonableProb = reasonableAns?.noul ?? 0.95;
      const isReasonable = isReasonableProb >= 0.5;

      // 权责交叉预警：多分类熵值发散或特定跨界分类
      const topCatProbs = Object.values(categoryDistribution as Record<string, number>).sort((a, b) => b - a);
      const isMarginal = topCatProbs.length >= 2 && (topCatProbs[0] - topCatProbs[1]) < 0.25;
      const crossDepartmentRisk = isMarginal || (
        (category === "urban_management" && content.includes("交警")) ||
        (category === "traffic" && content.includes("绿化"))
      );

      return {
        intent,
        intentProbability,
        category,
        categoryName: options?.categoryNameMap?.[category] || CATEGORY_NAME_MAP[category] || category,
        categoryProbability,
        categoryDistribution,
        urgencyLevel,
        urgencyScore,
        slaHours,
        stabilityRisk,
        stabilityRiskProbability: stabilityRiskProb,
        isReasonable,
        crossDepartmentRisk,
        adapterUsed: "mps",
        latencyMs,
      };
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
}
