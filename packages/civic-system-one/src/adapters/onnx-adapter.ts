import type { DecisionAdapter } from "./types";
import type {
  CivicTicketInput,
  CivicSystemOneDecision,
  CivicCategory,
  CivicIntent,
  CivicEvaluateOptions,
} from "../types";
import { CATEGORY_NAME_MAP } from "../presets/categories";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface ONNXAdapterOptions {
  modelDir?: string;
  vocabPath?: string;
  intraOpNumThreads?: number;
}

const CATEGORY_KEYS: CivicCategory[] = [
  "urban_management",
  "traffic",
  "market_reg",
  "environment",
  "labor_social",
  "public_safety",
  "social_governance",
];

const INTENT_KEYS: CivicIntent[] = [
  "INQUIRY",
  "COMPLAINT",
  "SUGGESTION",
  "REMINDER",
  "COMMENDATION",
];

const URGENCY_KEYS: (0 | 1 | 2 | 3)[] = [0, 1, 2, 3];
const SLA_MAP: Record<0 | 1 | 2 | 3, 0 | 2 | 24 | 120> = {
  0: 0,
  1: 120,
  2: 24,
  3: 2,
};

export class ONNXAdapter implements DecisionAdapter {
  readonly name = "onnx" as const;
  private onnxModelPath: string;
  private vocabPath: string;
  private session: any = null;
  private tokenToId: Map<string, number> = new Map();
  private ort: any = null;

  constructor(options?: ONNXAdapterOptions) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const packageModelDir = path.resolve(__dirname, "../../models/civic-laya-onnx");
    const packageVocabPath = path.resolve(__dirname, "../../models/vocab_civic.json");

    const modelDir = options?.modelDir || packageModelDir;
    this.onnxModelPath = path.join(modelDir, "model.onnx");
    this.vocabPath = options?.vocabPath || packageVocabPath;
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.onnxModelPath) || !fs.existsSync(this.vocabPath)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async initSession(): Promise<any> {
    if (this.session) return this.session;

    // Load vocab
    if (this.tokenToId.size === 0 && fs.existsSync(this.vocabPath)) {
      const vocabRaw = fs.readFileSync(this.vocabPath, "utf-8");
      const vocabData = JSON.parse(vocabRaw);
      const tokens: string[] = vocabData.tokens || [];
      tokens.forEach((tok, idx) => this.tokenToId.set(tok, idx));
    }

    // Dynamic import onnxruntime-node via runtime evaluation to bypass Webpack static bundling
    try {
      const importDynamic = new Function("modulePath", "return import(modulePath)");
      this.ort = await importDynamic("onnxruntime-node");
      const sessionOptions = {
        intraOpNumThreads: 4,
        graphOptimizationLevel: "all",
      };
      this.session = await this.ort.InferenceSession.create(
        this.onnxModelPath,
        sessionOptions
      );
      return this.session;
    } catch (err) {
      console.warn("[ONNXAdapter] Failed to initialize onnxruntime-node session:", err);
      return null;
    }
  }

  private encodeStr(text: string, maxLen: number): number[] {
    const ids: number[] = [];
    const t = text.trim();
    let i = 0;
    const n = t.length;

    while (i < n && ids.length < maxLen) {
      if (i + 4 <= n && this.tokenToId.has(t.slice(i, i + 4))) {
        ids.push(this.tokenToId.get(t.slice(i, i + 4))!);
        i += 4;
      } else if (i + 3 <= n && this.tokenToId.has(t.slice(i, i + 3))) {
        ids.push(this.tokenToId.get(t.slice(i, i + 3))!);
        i += 3;
      } else if (i + 2 <= n && this.tokenToId.has(t.slice(i, i + 2))) {
        ids.push(this.tokenToId.get(t.slice(i, i + 2))!);
        i += 2;
      } else if (this.tokenToId.has(t[i])) {
        ids.push(this.tokenToId.get(t[i])!);
        i += 1;
      } else {
        i += 1;
      }
    }

    return ids.length > 0 ? ids : [1];
  }

  private softmax(logits: number[]): number[] {
    const maxVal = Math.max(...logits);
    const exps = logits.map((val) => Math.exp(val - maxVal));
    const sumExps = exps.reduce((acc, val) => acc + val, 0);
    return exps.map((val) => val / sumExps);
  }

  async evaluate(
    ticket: CivicTicketInput,
    options?: CivicEvaluateOptions
  ): Promise<CivicSystemOneDecision> {
    const t0 = performance.now();
    const session = await this.initSession();

    if (!session || !this.ort) {
      throw new Error(
        `[ONNXAdapter] Model session unavailable at ${this.onnxModelPath}`
      );
    }

    const title = ticket.title || "";
    const body = ticket.content || "";

    // Pure Dual-Stream Tokenization
    const titleTokens = this.encodeStr(title, 32);
    const bodyTokens = this.encodeStr(body, 128);

    const titleIds = new BigInt64Array(32).fill(0n);
    const titleMask = new Float32Array(32).fill(0);
    titleTokens.forEach((tok, idx) => {
      titleIds[idx] = BigInt(tok);
      titleMask[idx] = 1.0;
    });

    const bodyIds = new BigInt64Array(128).fill(0n);
    const bodyMask = new Float32Array(128).fill(0);
    bodyTokens.forEach((tok, idx) => {
      bodyIds[idx] = BigInt(tok);
      bodyMask[idx] = 1.0;
    });

    const feeds = {
      title_ids: new this.ort.Tensor("int64", titleIds, [1, 32]),
      title_mask: new this.ort.Tensor("float32", titleMask, [1, 32]),
      body_ids: new this.ort.Tensor("int64", bodyIds, [1, 128]),
      body_mask: new this.ort.Tensor("float32", bodyMask, [1, 128]),
    };

    // 100% Pure Neural Network Inference
    const outputs = await session.run(feeds);
    const latencyMs = Number((performance.now() - t0).toFixed(2));

    const catLogits = Array.from(outputs.category_logits.data as Float32Array);
    const intLogits = Array.from(outputs.intent_logits.data as Float32Array);
    const urgLogits = Array.from(outputs.urgency_logits.data as Float32Array);
    const stabLogits = Array.from(outputs.stability_logits.data as Float32Array);

    const catProbs = this.softmax(catLogits);
    const intProbs = this.softmax(intLogits);
    const urgProbs = this.softmax(urgLogits);
    const stabProbs = this.softmax(stabLogits);

    // 1. Category
    let bestCatIdx = 0;
    let secCatIdx = 1;
    const sortedCatIndices = catProbs
      .map((p, idx) => ({ p, idx }))
      .sort((a, b) => b.p - a.p);
    bestCatIdx = sortedCatIndices[0].idx;
    secCatIdx = sortedCatIndices[1]?.idx ?? 0;

    const category = CATEGORY_KEYS[bestCatIdx];
    const categoryProbability = catProbs[bestCatIdx];
    const categoryDistribution: Record<string, number> = {};
    CATEGORY_KEYS.forEach((key, idx) => {
      categoryDistribution[key] = Number(catProbs[idx].toFixed(4));
    });

    // Cross-Department Risk derived purely from probability margin
    const margin = sortedCatIndices[0].p - (sortedCatIndices[1]?.p ?? 0);
    const crossDepartmentRisk = margin < 0.35;

    // 2. Intent
    const bestIntIdx = intProbs.indexOf(Math.max(...intProbs));
    const intent = INTENT_KEYS[bestIntIdx] || "COMPLAINT";
    const intentProbability = intProbs[bestIntIdx];

    // 3. Urgency
    const bestUrgIdx = urgProbs.indexOf(Math.max(...urgProbs));
    let urgencyLevel = URGENCY_KEYS[bestUrgIdx] ?? 1;
    const urgencyScore = bestUrgIdx;

    // 4. Stability Risk
    const stabilityRisk = stabProbs[0] > stabProbs[1]; // Index 0 is YES, Index 1 is NO
    const stabilityRiskProbability = stabProbs[0];

    // Interlock: escalate to Level 3 if stability risk is triggered
    if (stabilityRisk) {
      urgencyLevel = 3;
    }
    const slaHours = SLA_MAP[urgencyLevel];

    return {
      intent,
      intentProbability: Number(intentProbability.toFixed(4)),
      category,
      categoryName:
        options?.categoryNameMap?.[category] ||
        CATEGORY_NAME_MAP[category] ||
        category,
      categoryProbability: Number(categoryProbability.toFixed(4)),
      categoryDistribution,
      urgencyLevel,
      urgencyScore: Number(urgencyScore.toFixed(2)),
      slaHours,
      stabilityRisk,
      stabilityRiskProbability: Number(stabilityRiskProbability.toFixed(4)),
      isReasonable: true,
      crossDepartmentRisk,
      adapterUsed: "onnx",
      latencyMs,
    };
  }

  async close(): Promise<void> {
    if (this.session && typeof this.session.release === "function") {
      await this.session.release();
      this.session = null;
    }
  }
}
