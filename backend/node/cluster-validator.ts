/**
 * 聚类真实性与质量交叉质检器 (Cluster Quality & Fidelity Validator)
 * 在多频主题输出与持久化之前，进行严格的多维度物理真实性、时空拓扑与合理性核验。
 */

import type { MultiFrequencyTheme, EnrichedTicket } from "../state";
import { RULES, isGenericOrPlaceholderSubject } from "../rules";
import { extractSpatialCore } from "./canonical-node";
import { profileTicket } from "../ticket-profile";
import { canonicalizeCategory, isValidTownship, type RegionVocabulary } from "@/lib/vocabulary";

export interface ValidationReport {
  passed: boolean;
  rejectedReason?: string;
  issues?: string[];
}

const WILDCARD_CATEGORY_SET = new Set(["", "综合民生", "其他", "未分类"]);
const SITE_SPECIFIC_HINT =
  /欠薪|拖欠工资|克扣工资|工资未发|劳资|工地|施工|噪音|噪声|油烟|违停|占道|路灯|下水道|井盖|供水|停水|消防|垃圾|电梯|物业/;

function normalizePlaceBucket(ticket: EnrichedTicket, vocab?: RegionVocabulary): string | null {
  const profiled = profileTicket(
    { title: ticket.title, content: ticket.content, subdistrict: ticket.subdistrict },
    vocab?.townships || []
  );
  const raw = (profiled.place || ticket.canonicalLocation || ticket.address || "").trim();
  if (!raw || RULES.adminOnlyLocation.test(raw)) return null;
  const cleaned = raw
    .replace(/^[\u4e00-\u9fff]{1,8}(?:省|市|区|县|街道|镇)/g, "")
    .replace(/(?:某建设工程工地|某在建[\u4e00-\u9fffA-Za-z0-9]*工地|某号.*|某[\u4e00-\u9fffA-Za-z0-9]{0,16}(?:工地|项目|餐饮|湘菜馆|餐厅|商铺|店铺|公司|单位).*)$/, "")
    .trim();
  if (!cleaned || RULES.adminOnlyLocation.test(cleaned)) return null;
  if (!RULES.microLocationHint.test(cleaned)) return null;
  const core = extractSpatialCore(cleaned) || cleaned;
  if (!core || RULES.adminOnlyLocation.test(core)) return null;
  return core;
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

  // 1. 涉事主体物理真实性校验：严禁空泛虚词/占位词作为独立聚类主体
  if (!subject || subject.length < 2) {
    return { passed: false, rejectedReason: "主体名称过短或为空" };
  }
  if (
    (RULES.genericSubjects as readonly string[]).includes(subject) ||
    isGenericOrPlaceholderSubject(subject)
  ) {
    return { passed: false, rejectedReason: `涉事主体为通用虚词或占位词 [${subject}]，严禁单独成群` };
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

  const issues: string[] = [];

  // 6. 业务分类纯度校验：存在多种非泛化具体分类且主分类占比 < 75% 时拒绝
  const categoryCounts = new Map<string, number>();
  let categorizedTotal = 0;
  for (const t of clusterTickets) {
    const rawCat = (t.sourceCategory || "").trim();
    if (!rawCat || WILDCARD_CATEGORY_SET.has(rawCat)) continue;
    const normCat = canonicalizeCategory(rawCat) || rawCat;
    if (WILDCARD_CATEGORY_SET.has(normCat)) continue;
    categoryCounts.set(normCat, (categoryCounts.get(normCat) || 0) + 1);
    categorizedTotal += 1;
  }
  if (categoryCounts.size > 1 && categorizedTotal > 0) {
    const maxCatCount = Math.max(...categoryCounts.values());
    if (maxCatCount / categorizedTotal < 0.75) {
      issues.push(
        `跨业务类型混杂（主分类占比 ${Math.round((maxCatCount / categorizedTotal) * 100)}% < 75%，包含 ${Array.from(categoryCounts.keys()).join("、")}）`
      );
    }
  }

  // 7. 场地/欠薪类主题空间纯度校验：>= 5 条具备微观地点的工单若主点位占比 < 50%，涉嫌多工地/多主体混杂
  const themeContextText = `${theme.eventType || ""} ${theme.title || ""} ${theme.category || ""} ${subject} ${location}`;
  const isSiteOrWageTheme =
    SITE_SPECIFIC_HINT.test(themeContextText) ||
    clusterTickets.some((t) => SITE_SPECIFIC_HINT.test(`${t.title || ""} ${t.eventType || ""}`));
  if (isSiteOrWageTheme) {
    const placeCounts = new Map<string, number>();
    let concretePlaceTotal = 0;
    for (const t of clusterTickets) {
      const bucket = normalizePlaceBucket(t, vocab);
      if (!bucket) continue;
      placeCounts.set(bucket, (placeCounts.get(bucket) || 0) + 1);
      concretePlaceTotal += 1;
    }
    if (concretePlaceTotal >= 5 && placeCounts.size > 1) {
      const maxPlaceCount = Math.max(...placeCounts.values());
      if (maxPlaceCount / concretePlaceTotal < 0.5) {
        issues.push(
          `多主体/多工地混杂（主点位占比 ${Math.round((maxPlaceCount / concretePlaceTotal) * 100)}% < 50%，涉及 ${placeCounts.size} 个不同点位）`
        );
      }
    }
  }

  if (issues.length > 0) {
    return { passed: false, rejectedReason: issues.join("；"), issues };
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
