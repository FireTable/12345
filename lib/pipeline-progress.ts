/**
 * Pipeline 进度切分与实测耗时校准模型 —— 把 0-100% 按各工序真实耗时占比分配，
 * 每段独立用 (completed / total) 在自己的区间 [start, end] 内线性推进。
 *
 * 实测单单摊薄耗时基线（ms/ticket）：
 *   S1      : System-1 4 头 ONNX 快思考，实测 ~0.079 ms/单（>12,600 TPS），保底占 1% 保证进度条可见进入
 *   S2      : System-2 LLM 结构化要素抽取与摘要，实测 ~1150 ms/单，仍是流水线绝对耗时大头（约 83%）
 *   EMBED   : BAAI/bge-m3 1024 维半精度向量化与 pgvector 写入，实测 ~70 ms/单（约 5%）
 *   CLUSTER : pgvector HNSW 近邻召回 + 同案同地空间/主体归并，实测 ~42 ms/单（约 3%）
 *   SUMMARY : 多频主题级 LLM 跨部门处置建议（按 10 主题分批摊薄），实测 ~110 ms/单（约 8%）
 *
 * 扩展能力：
 *   1. 支持通过环境变量 `PIPELINE_STAGE_WEIGHTS` 覆写权重（JSON 或 `S1=1,S2=80,...` 键值对格式），自动归一化至 100；
 *   2. 支持运行时指数移动平均（EMA）按真实批耗时动态校准工序权重；
 *   3. 100% 向后兼容既有导出签名：`PIPELINE_STAGE_WEIGHTS`、`PipelineStage`、`PIPELINE_STAGE_RANGES`、`stagePercent`。
 */

export const PIPELINE_STAGES = ["S1", "S2", "EMBED", "CLUSTER", "SUMMARY"] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type PipelineStageWeights = Record<PipelineStage, number>;

export interface PipelineStageRange {
  start: number;
  end: number;
  weight: number;
}

export type PipelineStageRanges = Record<PipelineStage, PipelineStageRange>;

/** 各工序实测单单/摊薄耗时基线（毫秒） */
export const PIPELINE_STAGE_BASELINE_MS: Readonly<PipelineStageWeights> = Object.freeze({
  S1: 0.079,
  S2: 1150,
  EMBED: 70,
  CLUSTER: 42,
  SUMMARY: 110,
});

export const MIN_STAGE_WEIGHT = 1;
export const DEFAULT_EMA_ALPHA = 0.25;

export interface NormalizeStageWeightsOptions {
  /** 每段最小保底百分比，默认 1（防止毫秒级工序区间宽度坍缩为 0） */
  minWeight?: number;
  /** 某段缺失或非法时的回退权重/耗时映射 */
  fallback?: Partial<Record<PipelineStage, number>>;
}

/**
 * 将任意正数耗时/权重映射归一化为精确求和等于 100 的整数百分比（注水保底 + Hamilton 最大余数法）。
 * - 若入参已是精确求和 100 且满足保底的整数，原样保留不畸变；
 * - 缺失、非有限或 <= 0 的阶段自动回退至 fallback / 实测耗时基线。
 */
export function normalizeStageWeights(
  raw: Partial<Record<PipelineStage, number>> | null | undefined,
  options?: NormalizeStageWeightsOptions
): PipelineStageWeights {
  const maxFloor = Math.floor(100 / PIPELINE_STAGES.length);
  const rawMin = options?.minWeight;
  const minWeight =
    typeof rawMin === "number" && Number.isFinite(rawMin)
      ? Math.min(maxFloor, Math.max(0, Math.floor(rawMin)))
      : MIN_STAGE_WEIGHT;

  const fallback = options?.fallback ?? PIPELINE_STAGE_BASELINE_MS;
  const positiveValues = {} as Record<PipelineStage, number>;

  for (const stage of PIPELINE_STAGES) {
    const candidate = raw?.[stage];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      positiveValues[stage] = candidate;
      continue;
    }
    const fb = fallback[stage];
    if (typeof fb === "number" && Number.isFinite(fb) && fb > 0) {
      positiveValues[stage] = fb;
      continue;
    }
    positiveValues[stage] = PIPELINE_STAGE_BASELINE_MS[stage];
  }

  // 注水保底：将理想占比低于 minWeight 的阶段锁定为 minWeight，剩余预算在未锁定阶段按原比例分配
  const locked = new Map<PipelineStage, number>();
  let remainingBudget = 100;

  while (true) {
    const active = PIPELINE_STAGES.filter((s) => !locked.has(s));
    if (active.length === 0) break;
    const activeSum = active.reduce((sum, s) => sum + positiveValues[s], 0);
    if (activeSum <= 0) break;

    let newlyLocked = false;
    for (const stage of active) {
      const ideal = (positiveValues[stage] / activeSum) * remainingBudget;
      if (ideal < minWeight) {
        locked.set(stage, minWeight);
        remainingBudget -= minWeight;
        newlyLocked = true;
      }
    }
    if (!newlyLocked) break;
  }

  const out = {} as PipelineStageWeights;
  for (const [stage, w] of locked.entries()) {
    out[stage] = w;
  }

  const freeStages = PIPELINE_STAGES.filter((s) => !locked.has(s));
  if (freeStages.length > 0) {
    const freeSum = freeStages.reduce((sum, s) => sum + positiveValues[s], 0);
    const quotas = freeStages.map((stage, idx) => {
      const exact = freeSum > 0 ? (positiveValues[stage] / freeSum) * remainingBudget : remainingBudget / freeStages.length;
      const floored = Math.floor(exact);
      return {
        stage,
        idx,
        floored,
        remainder: exact - floored,
      };
    });

    let allocated = quotas.reduce((sum, q) => sum + q.floored, 0);
    let deficit = remainingBudget - allocated;

    const byRemainder = [...quotas].sort((a, b) => {
      if (Math.abs(b.remainder - a.remainder) > 1e-12) {
        return b.remainder - a.remainder;
      }
      return a.idx - b.idx;
    });

    for (const item of byRemainder) {
      if (deficit <= 0) break;
      item.floored += 1;
      allocated += 1;
      deficit -= 1;
    }

    for (const item of quotas) {
      out[item.stage] = item.floored;
    }
  }

  return out;
}

/** 根据实测耗时基线自动计算出的默认校准权重：{ S1: 1, S2: 83, EMBED: 5, CLUSTER: 3, SUMMARY: 8 } */
export const DEFAULT_PIPELINE_STAGE_WEIGHTS: Readonly<PipelineStageWeights> = Object.freeze(
  normalizeStageWeights(PIPELINE_STAGE_BASELINE_MS, { minWeight: MIN_STAGE_WEIGHT })
);

const STAGE_KEY_LOOKUP = new Map<string, PipelineStage>(
  PIPELINE_STAGES.map((stage) => [stage.toUpperCase(), stage])
);

/**
 * 解析 `PIPELINE_STAGE_WEIGHTS` 环境变量。
 * 支持两种格式：
 * - JSON：`{"S1":1,"S2":80,"EMBED":6,"CLUSTER":4,"SUMMARY":9}`
 * - 键值对：`S1=1,S2=80,EMBED=6,CLUSTER=4,SUMMARY=9`（也接受 `:` 与 `;` 分隔）
 * 解析失败或无有效正数阶段时返回 null，绝不抛错。
 */
export function parseStageWeightsEnv(
  raw: string | null | undefined
): Partial<Record<PipelineStage, number>> | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed: Partial<Record<PipelineStage, number>> = {};

  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
      for (const [k, v] of Object.entries(obj)) {
        const stage = STAGE_KEY_LOOKUP.get(k.trim().toUpperCase());
        const num = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : Number.NaN;
        if (stage && Number.isFinite(num) && num > 0) {
          parsed[stage] = num;
        }
      }
    } catch {
      return null;
    }
  } else {
    const tokens = trimmed.split(/[;,]+/);
    for (const token of tokens) {
      const item = token.trim();
      if (!item) continue;
      const sepIdx = item.search(/[=:]/);
      if (sepIdx <= 0) continue;
      const key = item.slice(0, sepIdx).trim().toUpperCase();
      const val = Number(item.slice(sepIdx + 1).trim());
      const stage = STAGE_KEY_LOOKUP.get(key);
      if (stage && Number.isFinite(val) && val > 0) {
        parsed[stage] = val;
      }
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : null;
}

/**
 * 结合可选环境变量覆写与基准权重，产出求和恒为 100 的最终阶段权重。
 */
export function resolveStageWeights(
  envRaw?: string | null,
  baseWeights: PipelineStageWeights = DEFAULT_PIPELINE_STAGE_WEIGHTS
): PipelineStageWeights {
  const override = parseStageWeightsEnv(envRaw);
  if (!override) {
    return { ...baseWeights };
  }
  return normalizeStageWeights(override, {
    minWeight: MIN_STAGE_WEIGHT,
    fallback: baseWeights,
  });
}

/**
 * 根据阶段权重构建连续的 [start, end] 区间映射（总区间 0..100）。
 */
export function buildStageRanges(weights: PipelineStageWeights): PipelineStageRanges {
  const out = {} as PipelineStageRanges;
  let cursor = 0;
  for (const stage of PIPELINE_STAGES) {
    const w = weights[stage];
    out[stage] = { start: cursor, end: cursor + w, weight: w };
    cursor += w;
  }
  return out;
}

/**
 * 进程启动时解析的校准权重常量（兼容既有引用，支持 PIPELINE_STAGE_WEIGHTS 环境变量覆写）。
 */
export const PIPELINE_STAGE_WEIGHTS: Readonly<PipelineStageWeights> = Object.freeze(
  resolveStageWeights(process.env.PIPELINE_STAGE_WEIGHTS)
);

/** 阶段累计区间：[start, end]（含端点），与 PIPELINE_STAGE_WEIGHTS 保持一致 */
export const PIPELINE_STAGE_RANGES: Readonly<PipelineStageRanges> = Object.freeze(
  buildStageRanges(PIPELINE_STAGE_WEIGHTS)
);

/** 运行时 EMA 动态耗时校准状态 */
export interface PipelineLatencyEmaState {
  latencyMs: Record<PipelineStage, number>;
  samples: Record<PipelineStage, number>;
  alpha: number;
}

export interface LatencyObservationOptions {
  /** 本次批处理的条目数；传入正数时自动换算为单条耗时 observedMs / items */
  items?: number;
  /** 覆盖默认 EMA 平滑系数 (0, 1] */
  alpha?: number;
}

function clampAlpha(alpha: number | undefined, fallback: number): number {
  if (typeof alpha === "number" && Number.isFinite(alpha) && alpha > 0 && alpha <= 1) {
    return alpha;
  }
  return fallback;
}

/**
 * 创建初始 EMA 耗时状态（默认以实测单单耗时基线冷启动）。
 */
export function createLatencyEmaState(
  initialMs?: Partial<Record<PipelineStage, number>>,
  alpha = DEFAULT_EMA_ALPHA
): PipelineLatencyEmaState {
  const safeAlpha = clampAlpha(alpha, DEFAULT_EMA_ALPHA);
  const latencyMs = {} as Record<PipelineStage, number>;
  const samples = {} as Record<PipelineStage, number>;
  for (const stage of PIPELINE_STAGES) {
    const initVal = initialMs?.[stage];
    latencyMs[stage] =
      typeof initVal === "number" && Number.isFinite(initVal) && initVal > 0
        ? initVal
        : PIPELINE_STAGE_BASELINE_MS[stage];
    samples[stage] = 0;
  }
  return { latencyMs, samples, alpha: safeAlpha };
}

/**
 * 纯函数 EMA 耗时更新：`next = alpha * sampleMs + (1 - alpha) * prev`。
 * 非法观测值（NaN / Infinity / <= 0）或非法 items（<= 0）将被安全忽略并返回原状态。
 */
export function updateLatencyEma(
  state: PipelineLatencyEmaState,
  stage: PipelineStage,
  observedMs: number,
  options?: LatencyObservationOptions
): PipelineLatencyEmaState {
  if (!Number.isFinite(observedMs) || observedMs <= 0) {
    return state;
  }
  let perItemMs = observedMs;
  if (options?.items !== undefined) {
    if (!Number.isFinite(options.items) || options.items <= 0) {
      return state;
    }
    perItemMs = observedMs / options.items;
  }
  if (!Number.isFinite(perItemMs) || perItemMs <= 0) {
    return state;
  }

  const alpha = clampAlpha(options?.alpha, state.alpha);
  const prev = state.latencyMs[stage];
  const nextLatency = alpha * perItemMs + (1 - alpha) * prev;

  return {
    alpha: state.alpha,
    latencyMs: {
      ...state.latencyMs,
      [stage]: nextLatency,
    },
    samples: {
      ...state.samples,
      [stage]: state.samples[stage] + 1,
    },
  };
}

/**
 * 将各阶段耗时（ms）转换为求和为 100 的整数权重。
 */
export function computeWeightsFromLatency(
  latencyMs: Partial<Record<PipelineStage, number>>,
  minWeight = MIN_STAGE_WEIGHT
): PipelineStageWeights {
  return normalizeStageWeights(latencyMs, {
    minWeight,
    fallback: PIPELINE_STAGE_BASELINE_MS,
  });
}

// 进程内默认运行时 EMA 校准器（未显式配置 PIPELINE_STAGE_WEIGHTS 环境变量时生效）
let runtimeEmaState: PipelineLatencyEmaState = createLatencyEmaState();

function hasRuntimeSamples(state: PipelineLatencyEmaState): boolean {
  return PIPELINE_STAGES.some((stage) => state.samples[stage] > 0);
}

/**
 * 记录一次真实工序耗时并更新运行时 EMA 权重校准模型，返回最新生效的权重。
 */
export function recordStageLatency(
  stage: PipelineStage,
  observedMs: number,
  options?: LatencyObservationOptions
): PipelineStageWeights {
  runtimeEmaState = updateLatencyEma(runtimeEmaState, stage, observedMs, options);
  return getActiveStageWeights();
}

/**
 * 读取当前运行时 EMA 状态快照（只读副本）。
 */
export function getLatencyEmaSnapshot(): PipelineLatencyEmaState {
  return {
    alpha: runtimeEmaState.alpha,
    latencyMs: { ...runtimeEmaState.latencyMs },
    samples: { ...runtimeEmaState.samples },
  };
}

/**
 * 重置进程内运行时 EMA 校准器回到实测基线（主要用于单测或算力拓扑变更后重置）。
 */
export function resetStageCalibration(alpha = DEFAULT_EMA_ALPHA): void {
  runtimeEmaState = createLatencyEmaState(undefined, alpha);
}

/**
 * 获取当前生效的阶段权重：
 * 优先级：显式 `PIPELINE_STAGE_WEIGHTS` 环境变量 > 运行时 EMA 动态校准 > 实测默认基线权重。
 */
export function getActiveStageWeights(): PipelineStageWeights {
  const envOverride = parseStageWeightsEnv(process.env.PIPELINE_STAGE_WEIGHTS);
  if (envOverride) {
    return normalizeStageWeights(envOverride, {
      minWeight: MIN_STAGE_WEIGHT,
      fallback: DEFAULT_PIPELINE_STAGE_WEIGHTS,
    });
  }
  if (hasRuntimeSamples(runtimeEmaState)) {
    return computeWeightsFromLatency(runtimeEmaState.latencyMs, MIN_STAGE_WEIGHT);
  }
  return { ...DEFAULT_PIPELINE_STAGE_WEIGHTS };
}

/**
 * 获取当前生效的阶段区间 [start, end]。
 */
export function getActiveStageRanges(): PipelineStageRanges {
  return buildStageRanges(getActiveStageWeights());
}

/**
 * 计算指定工序在总进度里的百分比。
 * - completed / total = 工序内完成度 (0~1)
 * - 映射到工序专属区间 [start, end] 内
 *
 * @param stage         工序名
 * @param completed     已完成数
 * @param total         工序总任务数（<= 0 或非有限数时直接返回 start）
 * @param phase         "min"（已完成起点）| "live"（当前完成度）| "max"（已到达 end）
 * @param customWeights 可选自定义权重（用于指定快照或隔离测试）
 */
export function stagePercent(
  stage: PipelineStage,
  completed: number,
  total: number,
  phase: "min" | "live" | "max" = "live",
  customWeights?: Partial<Record<PipelineStage, number>>
): number {
  const ranges = customWeights
    ? buildStageRanges(normalizeStageWeights(customWeights))
    : getActiveStageRanges();
  const { start, end } = ranges[stage];
  if (phase === "min") return start;
  if (phase === "max") return end;
  if (!Number.isFinite(total) || total <= 0) return start;
  const safeCompleted = Number.isFinite(completed) ? completed : 0;
  const ratio = Math.min(1, Math.max(0, safeCompleted / total));
  return Math.round(start + ratio * (end - start));
}
