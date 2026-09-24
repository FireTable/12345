import type { DecisionAdapter } from "./types";
import type {
  CivicTicketInput,
  CivicSystemOneDecision,
  CivicCategory,
  CivicIntent,
  CivicEvaluateOptions,
} from "../types";
import { CATEGORY_NAME_MAP } from "../presets/categories";

export class FallbackAdapter implements DecisionAdapter {
  readonly name = "fallback" as const;

  async isAvailable(): Promise<boolean> {
    return true; // 始终可用作为兜底
  }

  async evaluate(ticket: CivicTicketInput, options?: CivicEvaluateOptions): Promise<CivicSystemOneDecision> {
    const t0 = performance.now();
    const text = ((ticket.title || "") + " " + ticket.content).toLowerCase();

    // 1. 意图判定
    let intent: CivicIntent = "COMPLAINT";
    if (text.includes("请问") || text.includes("咨询") || text.includes("需要什么资料") || text.includes("办理流程")) {
      intent = "INQUIRY";
    } else if (text.includes("建议") || text.includes("建言") || text.includes("希望能够增设")) {
      intent = "SUGGESTION";
    } else if (text.includes("催办") || text.includes("还没处理") || text.includes("多次反映未果")) {
      intent = "REMINDER";
    } else if (text.includes("感谢") || text.includes("表扬") || text.includes("态度很好")) {
      intent = "COMMENDATION";
    }

    // 2. 类别判定 (优先从属地自定义分类字典匹配)
    let category: CivicCategory = "social_governance";
    if (options?.categories && Object.keys(options.categories).length > 0) {
      let bestScore = -1;
      for (const [catKey, criteriaDesc] of Object.entries(options.categories as Record<string, string>)) {
        let score = 0;
        const phrases = String(criteriaDesc).split(/[、，, ·/；;]+/);
        for (const phrase of phrases) {
          const p = phrase.trim().toLowerCase();
          if (p.length >= 2 && text.includes(p)) {
            score += 5;
          }
          // 2字子词滑窗加权
          for (let i = 0; i <= p.length - 2; i++) {
            const sub = p.slice(i, i + 2);
            if (text.includes(sub)) {
              score += 1;
            }
          }
        }
        if (score > bestScore) {
          bestScore = score;
          category = catKey;
        }
      }
    } else {
      if (text.includes("车牌") || text.includes("违停") || text.includes("拥堵") || text.includes("交警") || text.includes("公交")) {
        category = "traffic";
      } else if (text.includes("噪音") || text.includes("油烟") || text.includes("排污") || text.includes("废气") || text.includes("臭气")) {
        category = "environment";
      } else if (text.includes("水管") || text.includes("漏水") || text.includes("爆管") || text.includes("停水")) {
        category = "urban_management";
      } else if (text.includes("物业") || text.includes("电梯") || text.includes("道闸") || text.includes("占道") || text.includes("违建")) {
        category = "urban_management";
      } else if (text.includes("退款") || text.includes("退费") || text.includes("假冒") || text.includes("超市") || text.includes("价格") || text.includes("欺诈")) {
        category = "market_reg";
      } else if (text.includes("工资") || text.includes("欠薪") || text.includes("劳动") || text.includes("社保") || text.includes("工伤")) {
        category = "labor_social";
      } else if (text.includes("飞线") || text.includes("火灾") || text.includes("易燃") || text.includes("灭火器")) {
        category = "public_safety";
      }
    }

    // 3. 紧迫度判定
    let urgencyLevel: 0 | 1 | 2 | 3 = 1;
    let slaHours: 0 | 2 | 24 | 120 | 360 = 120;
    if (intent === "INQUIRY") {
      urgencyLevel = 0;
      slaHours = 0;
    } else if (text.includes("爆裂") || text.includes("喷涌") || text.includes("困人") || text.includes("泄漏") || text.includes("重大事故")) {
      urgencyLevel = 3;
      slaHours = 2;
    } else if (text.includes("严重阻碍") || text.includes("瘫痪") || text.includes("大面积")) {
      urgencyLevel = 2;
      slaHours = 24;
    }

    // 4. 涉稳风险
    const stabilityRisk =
      text.includes("跳楼") ||
      text.includes("拼命") ||
      text.includes("报复") ||
      text.includes("上访") ||
      text.includes("聚集") ||
      text.includes("堵路") ||
      text.includes("罢工");

    // 5. 合理性判定
    const isReasonable = !(text.includes("赔偿1个亿") || text.includes("全是饭桶"));

    // 6. 交叉权责风险
    const crossDepartmentRisk =
      (category === "urban_management" && text.includes("交通")) ||
      (category === "environment" && text.includes("物业")) ||
      (category === "traffic" && text.includes("绿化"));

    const latencyMs = Number((performance.now() - t0).toFixed(2));

    return {
      intent,
      intentProbability: 0.85,
      category,
      categoryName: options?.categoryNameMap?.[category] || CATEGORY_NAME_MAP[category] || category,
      categoryProbability: 0.8,
      categoryDistribution: { [category]: 0.8 },
      urgencyLevel,
      urgencyScore: urgencyLevel * 0.9,
      slaHours,
      stabilityRisk,
      stabilityRiskProbability: stabilityRisk ? 0.95 : 0.05,
      isReasonable,
      crossDepartmentRisk,
      adapterUsed: "fallback",
      latencyMs,
    };
  }
}
