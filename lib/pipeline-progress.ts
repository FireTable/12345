/**
 * Pipeline 进度切分模型 —— 把 0-100% 按工序耗时分布，
 * 每段独立用 (completed / total) 在自己的区间里走一遍。
 *
 * 4 段工序的实际耗时占比（实测 + 体感）：
 *   S1       : SystemOne ONNX 快思考，毫秒级，几乎瞬时
 *   S2       : 逐张工单跑 System-2 LLM 抽取，pipeline 耗时大头
 *   EMBED    : 把对齐后的抽取产物写入 pgvector，按批推进
 *   CLUSTER  : 用库存向量做近邻，再按同一事件规则归并
 *   SUMMARY  : 主题级 LLM 处置建议，按 10 个一批分批
 *
 * 调整任何一段的 weight，下游 start/end 会自动重算。
 * S2 仍是最大的一段。EMBED 从原来的 CLUSTER 里分出 2 个点，总和仍是 100。
 */

export const PIPELINE_STAGE_WEIGHTS = {
  S1: 2,
  S2: 88,
  EMBED: 2,
  CLUSTER: 3,
  SUMMARY: 5,
} as const;

export type PipelineStage = keyof typeof PIPELINE_STAGE_WEIGHTS;

/** 阶段累计区间：[start, end]（含端点） */
export const PIPELINE_STAGE_RANGES: Record<
  PipelineStage,
  { start: number; end: number; weight: number }
> = (() => {
  const out = {} as Record<PipelineStage, { start: number; end: number; weight: number }>;
  let cursor = 0;
  (Object.keys(PIPELINE_STAGE_WEIGHTS) as PipelineStage[]).forEach((stage) => {
    const w = PIPELINE_STAGE_WEIGHTS[stage];
    out[stage] = { start: cursor, end: cursor + w, weight: w };
    cursor += w;
  });
  return out;
})();

/**
 * 计算指定工序在总进度里的百分比。
 * - completed / total = 工序内完成度 (0~1)
 * - 映射到工序专属区间 [start, end] 内
 *
 * @param stage    工序名
 * @param completed 已完成数
 * @param total     工序总任务数（0 时直接返回 start）
 * @param phase    "min"（已完成起点）| "live"（当前完成度）| "max"（已到达 end）
 */
export function stagePercent(
  stage: PipelineStage,
  completed: number,
  total: number,
  phase: "min" | "live" | "max" = "live"
): number {
  const { start, end } = PIPELINE_STAGE_RANGES[stage];
  if (phase === "min") return start;
  if (phase === "max") return end;
  if (total <= 0) return start;
  const ratio = Math.min(1, Math.max(0, completed / total));
  return Math.round(start + ratio * (end - start));
}
