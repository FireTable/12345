/**
 * 聚类真实性与质量交叉质检器 (Cluster Quality & Fidelity Validator)
 * 在多频主题输出与持久化之前，进行严格的多维度物理真实性、时空拓扑与合理性核验。
 */

import type { MultiFrequencyTheme, EnrichedTicket } from "../state";
import { RULES } from "../rules";
import { isValidShundeTownship } from "@/lib/vocabulary";

export interface ValidationReport {
  passed: boolean;
  rejectedReason?: string;
}

/**
 * 单个多频主题深度合规性校验
 */
export function validateSingleTheme(
  theme: MultiFrequencyTheme,
  clusterTickets: EnrichedTicket[]
): ValidationReport {
  const subject = (theme.canonicalSubject || "").trim();
  const location = (theme.canonicalLocation || "").trim();

  // 1. 涉事主体物理真实性校验：严禁空泛虚词作为独立聚类主体
  if (!subject || subject.length < 2) {
    return { passed: false, rejectedReason: "主体名称过短或为空" };
  }
  if ((RULES.genericSubjects as readonly string[]).includes(subject)) {
    return { passed: false, rejectedReason: `涉事主体为通用虚词 [${subject}]，严禁单独成群` };
  }
  if (RULES.genericSubjectSuffix.test(subject)) {
    return { passed: false, rejectedReason: `涉事主体包含非法泛化后缀 [${subject}]` };
  }

  // 2. 车牌号实体严格隔离：如果主体包含车牌号，群内所有工单必须为该唯一车牌
  const plateMatch = subject.match(/([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][\s]?[A-Z0-9]{4,6})/i);
  if (plateMatch) {
    const targetPlate = plateMatch[1].replace(/\s+/g, "").toUpperCase();
    for (const t of clusterTickets) {
      const tSubj = (t.canonicalSubject || "").replace(/\s+/g, "").toUpperCase();
      if (tSubj.includes("粤") && !tSubj.includes(targetPlate)) {
        return { passed: false, rejectedReason: `跨车牌号串扰混淆：目标车牌 [${targetPlate}] 与成员工单主体 [${t.canonicalSubject}] 不一致` };
      }
    }
  }

  // 3. 工单数量门槛
  if (clusterTickets.length < RULES.minClusterSize) {
    return { passed: false, rejectedReason: `聚类工单数 [${clusterTickets.length}] 未达到多频最低门槛 [${RULES.minClusterSize}]` };
  }

  // 4. 时空连续性与镇街拓扑校验
  const distinctTownships = new Set<string>();
  for (const t of clusterTickets) {
    const township = t.subdistrict || t.district;
    if (township && isValidShundeTownship(township)) {
      distinctTownships.add(township);
    }
  }

  // 主体型聚类若跨 3 个以上不相干镇街，属于潜在误拉郎配，需警惕
  if (distinctTownships.size > 2 && !subject.includes("公司") && !subject.includes("集团") && !subject.includes("网")) {
    return { passed: false, rejectedReason: `聚类工单跨越 ${distinctTownships.size} 个不同镇街，涉嫌跨区误绑` };
  }

  // 5. 平均置信度门槛校验
  const avgConfidence =
    clusterTickets.reduce((acc, t) => acc + ((t as any).confidence || 80), 0) / clusterTickets.length;
  if (avgConfidence < 45) {
    return { passed: false, rejectedReason: `聚类工单平均抽取置信度过低 (${avgConfidence.toFixed(1)}分)` };
  }

  return { passed: true };
}

/**
 * 批量过滤与校验多频主题列表
 */
export function validateAndFilterThemes(
  themes: MultiFrequencyTheme[],
  allEnrichedTickets: EnrichedTicket[]
): MultiFrequencyTheme[] {
  const validThemes: MultiFrequencyTheme[] = [];

  for (const theme of themes) {
    const memberTickets = theme.tickets || [];

    const check = validateSingleTheme(theme, memberTickets);
    if (check.passed) {
      validThemes.push(theme);
    } else {
      console.warn(`[ClusterValidator] 剔除不合规多频聚类 [${theme.id}: ${theme.title}]: ${check.rejectedReason}`);
      // 解除已被剔除聚类的工单绑定标记
      memberTickets.forEach((t) => {
        if (t.clusterId === theme.id) {
          t.clusterId = undefined;
        }
      });
    }
  }

  return validThemes;
}
