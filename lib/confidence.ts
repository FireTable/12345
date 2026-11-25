export const LOW_CONFIDENCE_THRESHOLD = 70;
export const HIGH_CONFIDENCE_THRESHOLD = 85;

export type ConfidenceLevel = "low" | "medium" | "high" | "calibrated";

export interface ConfidenceClassification {
  level: ConfidenceLevel;
  label: string;
  needsHumanReview: boolean;
}

export function classifyConfidence(score: number | null | undefined): ConfidenceClassification {
  if (score == null || !Number.isFinite(score)) {
    return { level: "calibrated", label: "已校准", needsHumanReview: false };
  }
  if (score < LOW_CONFIDENCE_THRESHOLD) {
    return { level: "low", label: "低置信度", needsHumanReview: true };
  }
  if (score >= HIGH_CONFIDENCE_THRESHOLD) {
    return { level: "high", label: "高置信度", needsHumanReview: false };
  }
  return { level: "medium", label: "中置信度", needsHumanReview: false };
}
