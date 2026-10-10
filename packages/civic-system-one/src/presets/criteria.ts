import {
  CIVIC_CATEGORY_CRITERIA,
  CIVIC_INTENT_CRITERIA,
} from "./categories";
import type { CivicEvaluateOptions } from "../types";

export const URGENCY_LEVEL_CRITERIA = [
  "常规咨询或普通政策查询，无即时负面影响，随到随办",
  "轻微生活不便，未造成重大财产损失，可在常规5个工作日内流转办结",
  "主干道严重拥堵、大面积停水停电、商户经营严重受阻，需24小时内介入处置",
  "严重危及人身财产安全、燃气泄漏、爆管冲塌路基、重大群访集聚或严重欠薪，需2小时内应急响应",
];

/**
 * 组装 Laya / Jev 决策问题集 (动态支持属地分类与标尺注入)
 */
export function buildCivicQuestions(options?: CivicEvaluateOptions) {
  const categoryCriteria = options?.categories && Object.keys(options.categories).length > 0
    ? options.categories
    : CIVIC_CATEGORY_CRITERIA;

  const intentCriteria = options?.intentCriteria && Object.keys(options.intentCriteria).length > 0
    ? options.intentCriteria
    : CIVIC_INTENT_CRITERIA;

  const urgencyLevels = options?.urgencyLevels && options.urgencyLevels.length > 0
    ? options.urgencyLevels
    : URGENCY_LEVEL_CRITERIA;

  return {
    intent: {
      type: "choice" as const,
      instructions: "判定市民致电诉求的核心行为性质",
      criteria: intentCriteria,
    },
    category: {
      type: "choice" as const,
      instructions: "严格依据诉求事实判定归属的法定民生业务分类",
      criteria: categoryCriteria,
    },
    urgency: {
      type: "score" as const,
      instructions: "评估事件的紧迫度等级与现场响应级别",
      levels: urgencyLevels,
    },
    stability_risk: {
      type: "noul" as const,
      instructions: "诉求中是否包含扬言极端自残、报复或串联群体集聚上访的倾向？",
    },
    is_reasonable: {
      type: "noul" as const,
      instructions: "该诉求是否属于客观真实的实质民生诉求，而非纯情绪发泄谩骂或不可实现的非正常索赔？",
    },
  };
}

export function buildCivicCriteria(options?: CivicEvaluateOptions) {
  const categoryKeys = options?.categories && Object.keys(options.categories).length > 0
    ? Object.keys(options.categories)
    : ["urban_management", "traffic", "market_reg", "environment", "labor_social", "public_safety", "social_governance"];

  return [
    ["INQUIRY", "COMPLAINT", "SUGGESTION", "REMINDER", "COMMENDATION"],
    categoryKeys,
    ["Level 0", "Level 1", "Level 2", "Level 3"],
    ["YES", "NO"],
    ["YES", "NO"]
  ];
}
