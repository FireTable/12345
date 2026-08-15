import type { RiskLevel } from "../state";
import { RULES, negativeTermsPattern } from "../rules";

export type PatternType = "GROUP_GATHERING" | "INDIVIDUAL_REPEAT" | "DIVERGE";

const NEGATIVE_RE = negativeTermsPattern();

export function scanNegativeSentiment(
  tickets: Array<{ content?: string; title?: string }>
): boolean {
  return tickets.some((t) => NEGATIVE_RE.test(`${t.title || ""}${t.content || ""}`));
}

export function deriveRiskLevel(args: {
  ticketCount: number;
  patternType: PatternType;
  hitNegative: boolean;
  reopenCount?: number;
}): RiskLevel {
  const { highCount, mediumCount } = RULES.risk;
  let level: RiskLevel = args.ticketCount >= highCount ? "MEDIUM" : "LOW";
  if (
    (args.patternType === "GROUP_GATHERING" || args.patternType === "DIVERGE") &&
    args.hitNegative
  ) {
    level = "HIGH";
  } else if (args.ticketCount >= highCount) {
    level = "HIGH";
  } else if (args.ticketCount >= mediumCount) {
    level = "MEDIUM";
  }
  if ((args.reopenCount || 0) > 0) level = "HIGH";
  return level;
}
