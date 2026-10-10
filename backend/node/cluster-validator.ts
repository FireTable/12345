/**
 * 聚类真实性与质量交叉质检器 (Cluster Quality & Fidelity Validator)
 * 在多频主题输出与持久化之前，进行严格的多维度物理真实性、时空拓扑与合理性核验。
 */

import type { MultiFrequencyTheme, EnrichedTicket } from "../state";
import { RULES } from "../rules";
import { isValidTownship, type RegionVocabulary } from "@/lib/vocabulary";

export interface ValidationReport {
  passed: boolean;
  rejectedReason?: string;
}

/**
 * 单个多频主题深度合规性校验
 */
export function validateSingleTheme(
  theme: MultiFrequencyTheme,
  clusterTickets: EnrichedTicket[],
  vocab?: RegionVocabulary
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
      const tPlateMatch = tSubj.match(/([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][\s]?[A-Z0-9]{4,6})/i);
      if (tPlateMatch && tPlateMatch[1].replace(/\s+/g, "").toUpperCase() !== targetPlate) {
        return { passed: false, rejectedReason: `跨车牌号串扰混淆：目标车牌 [${targetPlate}] 与成员工单主体 [${tPlateMatch[1]}] 不一致` };
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
    if (township && isValidTownship(township, vocab)) {
      distinctTownships.add(township);
    }
  }

  // 主体型聚类若跨 3 个以上不同镇街，且非具有多分支特性的企事业单位，需警惕跨区误绑
  const isMultiSiteEntity = /(?:公司|集团|网点|分行|专卖|连锁|医院|学校|中心|局|所|队)$/.test(subject) || subject.length >= 6;
  if (distinctTownships.size > 2 && !isMultiSiteEntity) {
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
  allEnrichedTickets: EnrichedTicket[],
  vocab?: RegionVocabulary
): MultiFrequencyTheme[] {
  const validThemes: MultiFrequencyTheme[] = [];

  for (const theme of themes) {
    const memberTickets = theme.tickets || [];

    const check = validateSingleTheme(theme, memberTickets, vocab);
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
