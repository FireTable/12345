import type { PiiSpan } from "./types";

/**
 * 实体区间冲突仲裁器 (Span Conflict Resolver)
 *
 * 当多个规则在同一段文字产生重叠区间时（例如手机正则与部分工单号/身份证截断重叠）：
 * 1. 严格依据置信度打分裁决（身份证 0.99 > 车牌 0.95 > 电话 0.90 > 门牌 0.88 > 人名 0.85）；
 * 2. 分值相同时，长区间覆盖优先；
 * 3. 最终输出完全无交叉（Non-overlapping）的确定性区间集合。
 */
export function resolveConflicts(spans: PiiSpan[]): PiiSpan[] {
  if (spans.length <= 1) return spans;

  // 排序准则：先按起点正序；重叠时高分优先；分数相同时区间长度更大优先
  const sorted = [...spans].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (b.score !== a.score) return b.score - a.score;
    return b.end - b.start - (a.end - a.start);
  });

  const nonOverlapping: PiiSpan[] = [];
  let lastEnd = -1;

  for (const span of sorted) {
    if (span.start >= lastEnd) {
      nonOverlapping.push(span);
      lastEnd = span.end;
    } else {
      // 发生重叠碰撞，若当前候选者的置信度显著高于上一个已被采纳者，则进行争夺置换
      const prev = nonOverlapping[nonOverlapping.length - 1];
      if (span.score > prev.score && span.end > prev.end) {
        nonOverlapping.pop();
        nonOverlapping.push(span);
        lastEnd = span.end;
      }
    }
  }

  return nonOverlapping;
}
