import { randomUUID } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { anonymize, deanonymize } from "@civic/anonymizer";
import { SystemOneEngine, hasCivicRedlineSignal } from "@civic/system-one";
import { getRegionDb, sql } from "@/db/client";
import {
  disposalLogsTable,
  themesTable,
  ticketThemesTable,
  ticketsTable,
  vocabulariesTable,
} from "@/db/schema";
import { createAbortError, isAbortError, linkAbortSignals } from "@civic/system-two";
import { getSystemTwoEngine } from "@/backend/model";
import { getLlmPool } from "@/backend/llm-pool";
import { profileTicket } from "@/backend/ticket-profile";
import { invalidateCivicAggregates } from "@/lib/civic-cache";
import { canonicalizeCategory, getRegionVocabulary, loadPresetVocabulary } from "@/lib/vocabulary";
import { getRegionDomainProfile, type DomainProfile, type DomainType } from "@/lib/domain-profile";
import { ensureDisposalLogsTable, recordDisposalLog } from "@/lib/disposal";
import { evaluateEcommerceTicket } from "@/lib/ecommerce-triage";
import { broadcastDataRefresh } from "@/lib/sse-broadcaster";
import { buildRecordsFromRows, insertRecordsBatch } from "@/lib/ticket-ingest";
import { triggerClusterJobAuto } from "@/lib/cluster-runner";

export interface IntakeDraft {
  title: string;
  content: string;
  subdistrict: string;
  category: string;
  subject: string;
  address: string;
  contactPhone: string;
}

export interface IntakeChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface IntakeOptionsResult {
  regionId: string;
  regionName: string;
  domainProfile: DomainProfile;
  subdistricts: string[];
  categories: string[];
  channels: string[];
}

export interface CitizenTicketLogDto {
  action: string;
  note: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  operator: string | null;
  createdAt: string;
}

export interface CitizenTicketDto {
  id: string;
  ticketNo: string;
  title: string;
  content: string;
  subdistrict: string;
  category: string;
  status: string;
  closureStatus: string | null;
  isFakeClosure: boolean;
  themeId: string | null;
  themeTitle: string | null;
  latestLog: CitizenTicketLogDto | null;
  createdAt: string;
}

export type AgentTaskType = "MISSING_INFO" | "SLA_OVERDUE" | "REOPEN_CALLBACK" | "REDLINE_BLOCK";
export type AutonomyLevel = "L1_AUTO" | "L2_APPROVAL" | "L3_BLOCKED";
export type AgentTaskStatus = "PENDING" | "APPROVED" | "EXECUTED" | "REJECTED" | "BLOCKED";

export interface AgentTaskDto {
  id: string;
  taskType: AgentTaskType;
  autonomyLevel: AutonomyLevel;
  status: AgentTaskStatus;
  targetType: "TICKET" | "THEME";
  targetId: string;
  targetTitle: string;
  channel: string;
  maskedContact: string | null;
  missingSlots: string[];
  draftMessage: string;
  suggestedOwner: string | null;
  reason: string;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTasksSummary {
  total: number;
  pending: number;
  l1Count: number;
  l2Count: number;
  l3Count: number;
}

export interface AgentReportDto {
  id: string;
  reportDate: string;
  title: string;
  markdown: string;
  statsJson: string;
  createdAt: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __citizenSubmissionsReady: boolean | undefined;
  // eslint-disable-next-line no-var
  var __citizenSubmissionsPending: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __agentGovEnsuredSchemas: Set<string> | undefined;
  // eslint-disable-next-line no-var
  var __agentGovPendingSchemas: Map<string, Promise<void>> | undefined;
  // eslint-disable-next-line no-var
  var __intakeSystemOnePromise: Promise<SystemOneEngine> | undefined;
}

const ensuredSchemas: Set<string> =
  globalThis.__agentGovEnsuredSchemas ?? new Set<string>();
globalThis.__agentGovEnsuredSchemas = ensuredSchemas;

const pendingSchemas: Map<string, Promise<void>> =
  globalThis.__agentGovPendingSchemas ?? new Map<string, Promise<void>>();
globalThis.__agentGovPendingSchemas = pendingSchemas;

const LLM_SHORT_TIMEOUT_MS = 12_000;
const CORE_REDLINE_PREFIX =
  "群体性?(?:事件|纠纷|维权|抗议|聚集)|集体讨薪|串联聚集|静坐抗议|绝食|下跪维权|抬棺|集体上访|越级上访|进京上访|赴省进京|到北京上访|组织上访|串联上访|上访|聚众(?:闹事|维权|抗议|堵路|堵门|讨薪|示威|冲击|围堵)|非法聚集|聚集(?:闹事|维权|抗议|堵路|堵门|讨薪|示威|冲击|围堵)";
const CORE_REDLINE_MIDDLE =
  "罢工|集体停工|跳楼|跳桥|跳河|轻生|自杀|自残|自焚|寻短见|割腕|服毒|不想活|生无可恋|一起死|报复社会|扬言报复|威胁报复|报复|杀人|持刀伤人|持刀砍|砍伤|持械伤人|行凶伤人|砍人|血案|同归于尽|鱼死网破|与人拼命|拼命|放火|纵火|泼汽油|带汽油|携带炸药|安放炸弹|群殴|聚众斗殴|涉黑(?:涉恶)?|涉恶|黑恶势力|强迫交易|收取保护费|欺行霸市|伤亡|人身伤害|人员重伤|多人重伤|重伤被困|突发地陷|路面塌陷|坍塌|重大(?:交通(?:安全)?|生产安全|安全|火灾)?事故|毒气(?:泄漏)?|投毒|燃气严重泄漏|煤气大量泄漏|(?:发生|突发|引发|造成)爆炸|爆炸起火|(?:化工厂|厂房|车间|燃气管道|危化品|仓库|现场)[^，。]{0,6}爆炸|群体中毒|集体腹泻|集体呕吐|食物中毒|腹泻|呕吐|12315|市监局|消协|黑猫投诉|媒体曝光|全网曝光|热搜|集体维权|集体抗议|维稳|(?:扬言|威胁|声称|逼得)[^，。！？；;\\n]{0,12}(?:闹事|拼命|极端|出人命|没法活)";
const CORE_REDLINE_TAIL = "堵桥|封桥|阻断交通|堵门|围堵|拉横幅";
const CORE_REDLINE_PATTERN = `${CORE_REDLINE_PREFIX}|堵路|${CORE_REDLINE_MIDDLE}|封路|${CORE_REDLINE_TAIL}`;
const ECOM_REDLINE_PATTERN = `${CORE_REDLINE_PATTERN}|假货|假冒|变质|发霉`;
const SQL_CORE_REDLINE_MIDDLE = CORE_REDLINE_MIDDLE.replace(
  "(?:发生|突发|引发|造成)爆炸",
  "(?:^|[^锅瓶未没无非不别勿有会]|(?:^|[^没])有|(?:^|[^不])会)(?:发生|突发|引发|造成)爆炸"
)
  .replace(
    "(?:化工厂|厂房|车间|燃气管道|危化品|仓库|现场)[^，。]{0,6}爆炸",
    "(?:化工厂|厂房|车间|燃气管道|危化品|仓库|现场)(?:(?!(?:未|没|无|并非|不是|排除))[^，。]){0,6}爆炸"
  )
  .replace("人员重伤", "(?:^|[^无未没有]|(?:^|[^没])有)人员重伤");
export const SQL_CORE_REDLINE_PATTERN = `${CORE_REDLINE_PREFIX}|(?:^|[^拥])堵路(?:[^况段]|$)|${SQL_CORE_REDLINE_MIDDLE}|(?:^|[^工]|(?:^|[^施])工)封路(?!施工)|${CORE_REDLINE_TAIL}`;
export const SQL_ECOM_REDLINE_PATTERN = `${SQL_CORE_REDLINE_PATTERN}|假货|假冒|变质|发霉`;
const REDLINE_ADVERSATIVE_GAP = "(?:(?!但|却|不过|可是|然而)[^，。！？；;\\n])";
const REDLINE_NEGATION_PRE_RE = new RegExp(
  `(?:(?:并非|不是|没有发生|未发生|没有|并未|未见|未出现|未(?!来|果)|不存在|已排除|排除|不涉及|防止|预防|杜绝|辟谣|谣言|虚假|避免|谨防|严防|切勿|不要|禁止)${REDLINE_ADVERSATIVE_GAP}{0,8}|无(?:任何|明显|实际|发生|人员|迹象)${REDLINE_ADVERSATIVE_GAP}{0,6}|无人|无)$`
);
const REDLINE_FOOD_SAFETY_CHAIN_NEG_RE =
  /(?:没有发生|未发生|没有|并未|未见|未出现|不存在|已排除|排除|不涉及|无)(?:(?:任何|明显|实际)的?)?(?:(?:食物中毒|群体中毒|(?:群体|集体)?(?:腹泻|呕吐))(?:及|和|或|与|、))+(?:群体|集体)?$/;
const REDLINE_WORRY_PRE_RE = new RegExp(
  `(?:担心|害怕|生怕|谨防|避免)${REDLINE_ADVERSATIVE_GAP}{0,8}$`
);
const REDLINE_EXTREME_VIOLENCE_WORRY_RE =
  /^(?:报复社会|扬言报复|威胁报复|报复|杀人|持刀伤人|持刀砍|砍伤|持械伤人|行凶伤人|砍人|血案|同归于尽|鱼死网破|与人拼命|拼命|放火|纵火|泼汽油|带汽油|携带炸药|安放炸弹|群殴|聚众斗殴)$/;
const REDLINE_ACCIDENT_PREVENTIVE_RE =
  /(?:(?:容易|极易|很易|较易|易|可能会?|或许会?|也许会?|恐会?|难免会?|防止|预防|避免|谨防|严防|杜绝|以免|以防)(?:引发|造成|发生|导致|出现|酿成|带来|产生|诱发|演变成){0,2})(?:(?:非常|极其|很|比较|较)?(?:严重的?|恶劣的?|更大的?|类似的?|新的?|不必要的?|惨重的?|潜在的?)|一起|各类|各种)?$/;
const REDLINE_ACCIDENT_POST_HAZARD_RE =
  /^(?:的(?:安全|潜在|重大|严重){0,2}(?:隐患|风险|苗头|可能(?:性)?)|(?:安全|潜在|重大|严重){0,2}(?:隐患|风险|苗头))/;
const REDLINE_EXPLOSION_BENIGN_CONTEXT_RE =
  /(?:锅|灯泡|热水器|烧水器|油烟机|抽油烟机|消毒柜|燃气灶|煤气灶|煤气瓶|电瓶(?!车)|筒灯|玻璃|钢化玻璃|如果[^，。]{0,8}发生爆炸)/;
const REDLINE_EXPLOSION_INDUSTRIAL_CONTEXT_RE =
  /(?:化工厂|厂房|车间|燃气管道|危化品|仓库)/;

export function hasRedlineSignal(
  text: string,
  options?: { isEcommerce?: boolean }
): boolean {
  if (!text) return false;
  const source = options?.isEcommerce ? ECOM_REDLINE_PATTERN : CORE_REDLINE_PATTERN;
  const globalRe = new RegExp(source, "g");
  let match: RegExpExecArray | null;
  while ((match = globalRe.exec(text)) !== null) {
    const idx = match.index;
    const matched = match[0];
    if (
      matched === "堵路" &&
      (text[idx - 1] === "拥" || text[idx + 2] === "况" || text[idx + 2] === "段")
    ) {
      continue;
    }
    if (
      matched === "封路" &&
      (text.slice(Math.max(0, idx - 2), idx) === "施工" ||
        text.slice(idx + 2, idx + 4) === "施工")
    ) {
      continue;
    }
    const before = text.slice(Math.max(0, idx - 16), idx);
    const beforeFood = text.slice(Math.max(0, idx - 24), idx);
    if (
      REDLINE_NEGATION_PRE_RE.test(before) ||
      REDLINE_FOOD_SAFETY_CHAIN_NEG_RE.test(beforeFood)
    ) {
      continue;
    }
    if (
      REDLINE_EXTREME_VIOLENCE_WORRY_RE.test(matched) &&
      REDLINE_WORRY_PRE_RE.test(before)
    ) {
      continue;
    }
    if (/^重大.*事故$/.test(matched)) {
      const accidentPre = text.slice(Math.max(0, idx - 20), idx);
      const accidentAfter = text.slice(
        idx + matched.length,
        Math.min(text.length, idx + matched.length + 8)
      );
      if (
        REDLINE_ACCIDENT_PREVENTIVE_RE.test(accidentPre) ||
        REDLINE_ACCIDENT_POST_HAZARD_RE.test(accidentAfter)
      ) {
        continue;
      }
    }
    if (matched.includes("爆炸")) {
      const expOffset = matched.indexOf("爆炸");
      if (expOffset > 0) {
        const expIdx = idx + expOffset;
        const beforeExplosion = text.slice(Math.max(0, expIdx - 16), expIdx);
        if (REDLINE_NEGATION_PRE_RE.test(beforeExplosion)) {
          continue;
        }
      }
      const explosionWindow = text.slice(
        Math.max(0, idx - 60),
        Math.min(text.length, idx + matched.length + 20)
      );
      if (
        REDLINE_EXPLOSION_BENIGN_CONTEXT_RE.test(explosionWindow) &&
        !REDLINE_EXPLOSION_INDUSTRIAL_CONTEXT_RE.test(explosionWindow)
      ) {
        continue;
      }
    }
    return true;
  }
  return false;
}
const GENERIC_SUBJECT_RE =
  /^(?:涉事方|相关主体|未知|不详|无|空|null|undefined|n\/a|市民|车主|商家|商铺|店铺|店主|单位|某单位|某店铺|某商家|某公司|某企业|某工厂|某餐厅|某餐馆|买家|卖家|消费者|顾客|客户|客服|外包客服|平台客服|当事人|反映人|诉求人|投诉人|业主|租客|物业|部门|相关单位|相关部门|涉事单位|涉事店铺|涉事商家|涉事主体|涉事车辆|车辆|司机|小贩|摊贩|咨询市民|催办诉求人|无名|不知名)$/i;
const GENERIC_SUBJECT_SUFFIX_RE = /(?:涉事方|责任主体|责任对象)$/;
const GENERIC_SUBJECT_WRAPPER_RE =
  /^(?:某|该|这|那|一)?(?:家|位|个)?(?:我的|涉事|相关)?(?:单位|店铺|商铺|商店|商家|公司|企业|工厂|工地|餐厅|餐馆|饭店|超市|物业|快递|物流|商品|客服|卖家|买家|车主|市民|车辆)$/;

function isGenericSubject(value?: string | null): boolean {
  const s = (value || "").trim();
  if (!s) return true;
  return (
    GENERIC_SUBJECT_RE.test(s) ||
    GENERIC_SUBJECT_SUFFIX_RE.test(s) ||
    GENERIC_SUBJECT_WRAPPER_RE.test(s)
  );
}

const PHONE_RE = /(?<!\d)(?:(?:\+|00)86)?(1[3-9]\d{9})(?!\d)|\b(0\d{2,3}-?\d{7,8})\b/;
const SKU_RE = /(?:^|[^A-Za-z0-9])(SKU[-_][A-Za-z0-9]{2,}(?:[-_][A-Za-z0-9]+)*|SKU[A-Za-z0-9]{3,})(?![A-Za-z0-9])/i;
const LABELED_SKU_RE = /(?:SKU编号|SKU|货号|商品编号)\s*(?:是|为|[：:])\s*([A-Za-z0-9][A-Za-z0-9_-]{3,28})/i;
const NEGATIVE_CALLBACK_RE =
  /(?:没|没有|未|并未|还没|还没有|还未|尚未|压根没|根本没|完全没)(?:彻底|完全|真正|实际|及时|妥善|实质性?地?|有效|真正地?)?(?:解决|修好|弄好|搞定|办妥|整改|处理|恢复|通水|改善|好转|退款|退到账|到账)|复发|敷衍|假办结|强行办结|强行结案|还是吵|还在吵|照样吵|照样漏|还在漏|还在响|还在臭|漏水|还是坏|还是漏|还是老问题|老问题(?:还在|依然|仍然|没变)?|(?:依然|仍然|还是)?老样子|一模一样|毫无变化|没啥变化|纹丝不动|照旧|又犯了|又坏了|又漏了|又开始了|反弹|回潮|依然(?:存在|没改|没解决|未解决|很吵|漏水|一样)|仍然(?:存在|没改|没解决|未解决|很吵|漏水|一样)|没收到退款|钱没退|退款没到|拒退|不给退|没人联系|没人管|压根没人管|根本没人管|没人理|没人回|没回电|一直拖着|一直拖|拖着不办|白跑一趟|白等了|不满意|不太满意|并不满意|不是很满意|态度(?:依然|仍然|还是|一直|依旧)?(?:很|太|极|非常|比较)?(?:差|不好|恶劣|敷衍)|(?:依然|仍然|还是)不好|(?:整改|质量|验收)?不过关|推诿|踢皮球|扯皮|(?:还有|仍有|存在)问题|还是有问题|问题(?:根本|依然|仍然)?还在|没人(?:上门|来修|来|处理|解决|管)|没办好|照样(?:响|臭|坏|漏|吵|堵)|又出现(?:了)?|(?:钱|退款)[^，,。！？；;]{0,4}(?:没|未)(?:给我?)?退|(?:没|没有|未|并未|还没|还没有|还未|尚未)(?:得到|能|给|给我|帮我|及时)(?:解决|修好|弄好|搞定|办妥|退到账|到账|处理|恢复)|(?:未能|没能)(?:解决|修好|弄好|处理|恢复|到账)/g;
const POSITIVE_RESOLUTION_RE =
  /(?:彻底|完全)好了|(?:完全|现在|已经|也)?不(?:再)?漏水了|没有再漏水了|已经?解决(?:了)?|彻底解决(?:了)?|解决好(?:了)?|解决(?:了)?|已整改|整改(?:了|到位)|已退款|收到退款|退到账(?:了)?|退款到账(?:了)?|钱退了|已赔付|恢复(?:了)?|修好(?:了)?|弄好(?:了)?|搞定(?:了)?|办妥(?:了)?|妥了|处理好(?:了)?|处理完(?:了)?|通水(?:了)?|安静了|不吵了|不漏了|不臭了|通畅了|正常了|没啥问题|没有问题|没问题|(?:不再|不会再|已经?不|并未再|也没|没再)(?:漏水|吵|臭|坏|漏)(?:了)?/g;
const POSITIVE_POLITE_RE = /满意|挺好(?:的)?|感谢|谢谢/g;

const CALLBACK_NEG_DENIAL_PREFIX_RE =
  /(?:并非|并不是|不是|并没有|没有|并未|不存在|谈不上|不算|别说|哪有)(?:[^，,。！？；;\n]{0,4})$/;
const CALLBACK_SYMPTOM_DENIAL_PREFIX_RE =
  /(?<!不是|并非)(?:不再|不会再|已经?不|再也不|再也没|并未再|也没|(?<![还老])不|(?<![还])没)(?:再|怎么|太)?$/;
const CALLBACK_SYMPTOM_TARGET_RE =
  /^(?:漏水|复发|反弹|回潮|敷衍|假办结|强行办结|强行结案|推诿|踢皮球|扯皮)$/;
const CALLBACK_POS_NEG_PREFIX_RE =
  /(?:并非|并不是|不是|并没有|没有|并未|尚未|还没|还没有|还未|根本没|压根没|完全没|一点没|丝毫没|一点都没|根本不|压根不|完全不|并不|不太|不算|谈不上|别说|哪有|哪里|(?<![已终没])未|(?<![还都])没|(?<![还从并])不)(?:太|很|算|真正|完全|彻底|怎么|什么|有多)?$/;
const CALLBACK_ADVERSATIVE_RE =
  /(?:(?:^|[，,。！？；;\s])(?:但(?:实际上|其实)?(?!是)|其实|实际上|反而|结果)|但是(?:实际上|其实)?|可是|不过(?!关|去|瘾|分|多|于|来)|然而)/g;

const CALLBACK_GAP_NEG_RE =
  /(?:没有?|未能?|没能|尚未|还没有?|还未|并未)([^，,。！？；;\n]{0,6})$/;
const CALLBACK_GAP_DOUBLE_DENIAL_RE = /(?:不是|并非|并不是|哪里是)(?:没|未)/;
const CALLBACK_GAP_FILLER_RE =
  /^(?:得到|能|给|给我|帮我|及时|一直|到现在|至今|也|还|妥善|如期|顺利)*$/;

function scoreCallbackChunk(chunk: string): {
  neg: number;
  pos: number;
  resolvedPos: number;
  ambiguous: number;
} {
  let neg = 0;
  let pos = 0;
  let resolvedPos = 0;
  let ambiguous = 0;
  const clauses = chunk.split(/[，,。！？；;\n]+/).filter(Boolean);
  for (const clause of clauses) {
    NEGATIVE_CALLBACK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NEGATIVE_CALLBACK_RE.exec(clause)) !== null) {
      const pre = clause.slice(Math.max(0, m.index - 12), m.index);
      if (CALLBACK_NEG_DENIAL_PREFIX_RE.test(pre)) continue;
      if (
        CALLBACK_SYMPTOM_TARGET_RE.test(m[0]) &&
        CALLBACK_SYMPTOM_DENIAL_PREFIX_RE.test(pre)
      ) {
        continue;
      }
      neg += 1;
    }

    POSITIVE_RESOLUTION_RE.lastIndex = 0;
    while ((m = POSITIVE_RESOLUTION_RE.exec(clause)) !== null) {
      const pre = clause.slice(Math.max(0, m.index - 12), m.index);
      if (CALLBACK_POS_NEG_PREFIX_RE.test(pre)) continue;
      // 否定词与解决类动词之间夹有若干字（如"没有得到解决""未能解决"）：
      // 规则层不得判为 POSITIVE；明确的未解决填充词计为负反馈，其余交由 LLM。
      const gapPre = clause.slice(Math.max(0, m.index - 8), m.index);
      const gap = CALLBACK_GAP_NEG_RE.exec(gapPre);
      if (gap && !CALLBACK_GAP_DOUBLE_DENIAL_RE.test(gapPre)) {
        if (CALLBACK_GAP_FILLER_RE.test(gap[1])) neg += 1;
        else ambiguous += 1;
        continue;
      }
      resolvedPos += 1;
      pos += 1;
    }

    POSITIVE_POLITE_RE.lastIndex = 0;
    while ((m = POSITIVE_POLITE_RE.exec(clause)) !== null) {
      const pre = clause.slice(Math.max(0, m.index - 12), m.index);
      if (CALLBACK_POS_NEG_PREFIX_RE.test(pre)) continue;
      pos += 1;
    }
  }
  return { neg, pos, resolvedPos, ambiguous };
}

const CALLBACK_AFTER_PROBLEM_RE = /[没未不还又]|照样|问题|漏|响|臭|坏|吵|堵|没人/;

export function evaluateCallbackSentiment(
  transcript: string
): "NEGATIVE" | "POSITIVE" | "UNCLEAR" {
  const text = (transcript || "").trim();
  if (!text) return "UNCLEAR";

  CALLBACK_ADVERSATIVE_RE.lastIndex = 0;
  let lastAdv: RegExpExecArray | null = null;
  let advMatch: RegExpExecArray | null;
  while ((advMatch = CALLBACK_ADVERSATIVE_RE.exec(text)) !== null) {
    lastAdv = advMatch;
  }

  if (lastAdv) {
    const before = text.slice(0, lastAdv.index);
    const after = text.slice(lastAdv.index + lastAdv[0].length);
    const afterScore = scoreCallbackChunk(after);
    if (afterScore.neg > 0) return "NEGATIVE";
    if (afterScore.resolvedPos > 0) return "POSITIVE";
    if (afterScore.ambiguous > 0) return "UNCLEAR";
    const beforeVerdict = evaluateCallbackSentiment(before);
    if (beforeVerdict === "NEGATIVE") return "NEGATIVE";
    // 转折后含问题迹象时，绝不以转折前的客套/声称"已解决"判为满意，交由 LLM 复核。
    if (CALLBACK_AFTER_PROBLEM_RE.test(after)) return "UNCLEAR";
    if (beforeVerdict !== "UNCLEAR") return beforeVerdict;
    if (afterScore.pos > 0) return "POSITIVE";
    return "UNCLEAR";
  }

  const score = scoreCallbackChunk(text);
  if (score.neg > 0) return "NEGATIVE";
  if (score.ambiguous > 0) return "UNCLEAR";
  if (score.pos > 0) return "POSITIVE";
  return "UNCLEAR";
}

function clampStr(value: unknown, max: number): string {
  const s = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max);
}

function clampNullable(value: unknown, max: number): string | null {
  const s = clampStr(value, max);
  return s || null;
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date().toISOString();
}

function shanghaiDateStr(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function safeJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function uniqueNonEmpty(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = (item || "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function assertSafeSchemaName(schemaName: string): void {
  if (!/^[a-zA-Z0-9_]+$/.test(schemaName)) {
    throw new Error(`Invalid tenant schema name: ${schemaName}`);
  }
}

function getIntakeSystemOne(): Promise<SystemOneEngine> {
  if (!globalThis.__intakeSystemOnePromise) {
    globalThis.__intakeSystemOnePromise = SystemOneEngine.create().catch((err) => {
      globalThis.__intakeSystemOnePromise = undefined;
      throw err;
    });
  }
  return globalThis.__intakeSystemOnePromise;
}

export function invalidateAgentGovernanceCache(schemaName?: string): void {
  if (schemaName) {
    ensuredSchemas.delete(schemaName);
    pendingSchemas.delete(schemaName);
  } else {
    globalThis.__citizenSubmissionsReady = false;
    globalThis.__citizenSubmissionsPending = undefined;
    ensuredSchemas.clear();
    pendingSchemas.clear();
  }
}

/**
 * 幂等创建 public.citizen_submissions 表及索引，隔离普通用户本人提交记录。
 */
export async function ensureCitizenSubmissionsTable(): Promise<void> {
  if (globalThis.__citizenSubmissionsReady) return;
  if (globalThis.__citizenSubmissionsPending) {
    await globalThis.__citizenSubmissionsPending;
    return;
  }

  const ddlPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS public.citizen_submissions (
        id VARCHAR(64) PRIMARY KEY,
        user_id TEXT NOT NULL,
        region_id VARCHAR(64) NOT NULL,
        ticket_id VARCHAR(64) NOT NULL,
        ticket_no VARCHAR(64) NOT NULL,
        title TEXT,
        category VARCHAR(64),
        subdistrict VARCHAR(64),
        created_at TIMESTAMPTZ DEFAULT now() NOT NULL
      );
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_citizen_submissions_user_region
      ON public.citizen_submissions (user_id, region_id);
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_citizen_submissions_ticket
      ON public.citizen_submissions (ticket_id);
    `;
    globalThis.__citizenSubmissionsReady = true;
  })();

  globalThis.__citizenSubmissionsPending = ddlPromise;
  try {
    await ddlPromise;
  } finally {
    globalThis.__citizenSubmissionsPending = undefined;
  }
}

/**
 * 沿用 ensureDisposalLogsTable 模式，在目标租户 schema 幂等创建 agent_tasks 与 agent_reports 表。
 */
export async function ensureAgentGovernanceTables(regionId?: string): Promise<string> {
  const { schemaName } = await getRegionDb(regionId);
  assertSafeSchemaName(schemaName);

  if (ensuredSchemas.has(schemaName)) {
    return schemaName;
  }

  const inflight = pendingSchemas.get(schemaName);
  if (inflight) {
    await inflight;
    return schemaName;
  }

  const ddlPromise = (async () => {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".agent_tasks (
        id VARCHAR(64) PRIMARY KEY,
        task_type VARCHAR(32) NOT NULL,
        autonomy_level VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        target_type VARCHAR(16) NOT NULL,
        target_id VARCHAR(64) NOT NULL,
        target_title TEXT NOT NULL,
        channel VARCHAR(32) NOT NULL DEFAULT 'VOICE_SIM',
        masked_contact VARCHAR(128),
        missing_slots_json TEXT,
        draft_message TEXT NOT NULL,
        suggested_owner VARCHAR(128),
        reason TEXT NOT NULL,
        result_summary TEXT,
        created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
      );
    `);
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON "${schemaName}".agent_tasks (status, autonomy_level);`
    );
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_agent_tasks_target ON "${schemaName}".agent_tasks (target_type, target_id, task_type);`
    );
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".agent_reports (
        id VARCHAR(64) PRIMARY KEY,
        report_date VARCHAR(16) NOT NULL,
        title TEXT NOT NULL,
        markdown TEXT NOT NULL,
        stats_json TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now() NOT NULL
      );
    `);
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_agent_reports_date ON "${schemaName}".agent_reports (report_date, created_at DESC);`
    );
    ensuredSchemas.add(schemaName);
  })();

  pendingSchemas.set(schemaName, ddlPromise);
  try {
    await ddlPromise;
  } finally {
    pendingSchemas.delete(schemaName);
  }
  return schemaName;
}

/**
 * 脱敏联系方式展示：真实电话走 anonymize 生成 {{PHONE_NUMBER_1}}，已加星号或缺失统一呈现安全占位符。
 */
export function maskContactForGovernance(
  rawPhone?: string | null,
  rawContent?: string | null
): string {
  const phone = (rawPhone || "").trim();
  if (phone) {
    const res = anonymize(phone, { categories: ["PHONE_NUMBER"] });
    if (res.spans.length > 0) {
      return res.text;
    }
    if (/\{\{PHONE_NUMBER_\d+\}\}/.test(phone)) {
      return phone;
    }
  }
  if (rawContent) {
    const match = rawContent.match(PHONE_RE);
    if (match?.[0]) {
      const res = anonymize(match[0], { categories: ["PHONE_NUMBER"] });
      if (res.spans.length > 0) {
        return res.text;
      }
    }
  }
  return "{{PHONE_NUMBER_1}}";
}

function maskFreeText(text: string): string {
  if (!text) return "";
  return anonymize(text).text;
}

async function callSystemTwoJsonSafe<T>(
  schema: z.ZodType<T>,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens = 512,
  signal?: AbortSignal
): Promise<{ data: T; usedLlm: true } | null> {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
  const linked = linkAbortSignals(LLM_SHORT_TIMEOUT_MS, signal);
  try {
    return await getLlmPool().run(
      async (slotSignal) => {
        const effectiveSignal = slotSignal ?? linked.signal;
        if (effectiveSignal.aborted) {
          throw createAbortError(effectiveSignal);
        }
        const engine = await getSystemTwoEngine();
        if (effectiveSignal.aborted) {
          throw createAbortError(effectiveSignal);
        }
        if (engine.getActiveBackend().toLowerCase().includes("fallback")) {
          return null;
        }
        const res = await engine.createJSON(schema, {
          messages,
          enableThinking: false,
          temperature: 0.1,
          maxTokens,
          signal: effectiveSignal,
        });
        return { data: res.data, usedLlm: true as const };
      },
      { lane: "interactive", signal: linked.signal }
    );
  } catch (err) {
    if (signal?.aborted || (isAbortError(err) && signal?.aborted)) {
      throw createAbortError(signal);
    }
    return null;
  } finally {
    linked.cleanup();
  }
}

async function sendWebhookIfConfigured(payload: Record<string, unknown>): Promise<boolean> {
  const url = (process.env.AGENT_WEBHOOK_URL || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return false;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function logSmtpAdapterIfConfigured(subject: string, summary: string): boolean {
  const host = (process.env.SMTP_HOST || "").trim();
  if (!host) return false;
  console.info(
    `[agent-smtp-adapter] SMTP_HOST=${host} 已配置，已记录邮件通知审计摘要 (${subject}): ${summary.slice(0, 120)}`
  );
  return true;
}

function toTaskDto(row: Record<string, unknown>): AgentTaskDto {
  return {
    id: String(row.id || ""),
    taskType: String(row.task_type || "MISSING_INFO") as AgentTaskType,
    autonomyLevel: String(row.autonomy_level || "L2_APPROVAL") as AutonomyLevel,
    status: String(row.status || "PENDING") as AgentTaskStatus,
    targetType: String(row.target_type || "TICKET") as "TICKET" | "THEME",
    targetId: String(row.target_id || ""),
    targetTitle: String(row.target_title || ""),
    channel: String(row.channel || "VOICE_SIM"),
    maskedContact: row.masked_contact == null ? null : String(row.masked_contact),
    missingSlots: safeJsonArray(row.missing_slots_json as string | null),
    draftMessage: String(row.draft_message || ""),
    suggestedOwner: row.suggested_owner == null ? null : String(row.suggested_owner),
    reason: String(row.reason || ""),
    resultSummary: row.result_summary == null ? null : String(row.result_summary),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function toReportDto(row: Record<string, unknown>): AgentReportDto {
  return {
    id: String(row.id || ""),
    reportDate: String(row.report_date || ""),
    title: String(row.title || ""),
    markdown: String(row.markdown || ""),
    statsJson: String(row.stats_json || "{}"),
    createdAt: asIso(row.created_at),
  };
}

function summarizeTasks(tasks: AgentTaskDto[]): AgentTasksSummary {
  const active = tasks.filter((t) => t.status !== "EXECUTED" && t.status !== "REJECTED");
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "PENDING").length,
    l1Count: active.filter((t) => t.autonomyLevel === "L1_AUTO").length,
    l2Count: active.filter((t) => t.autonomyLevel === "L2_APPROVAL").length,
    l3Count: active.filter((t) => t.autonomyLevel === "L3_BLOCKED").length,
  };
}

// =========================================================================
// 1. 普通用户受理中心 (/api/intake/*)
// =========================================================================

export async function loadIntakeOptions(regionId: string): Promise<IntakeOptionsResult> {
  const { db: tenantDb, region } = await getRegionDb(regionId);
  const domainProfile = await getRegionDomainProfile(regionId);

  let vocabRows: Array<{ type: string; name: string; fullName: string | null }> = [];
  try {
    vocabRows = await tenantDb
      .select({
        type: vocabulariesTable.type,
        name: vocabulariesTable.name,
        fullName: vocabulariesTable.fullName,
      })
      .from(vocabulariesTable);
  } catch {
    vocabRows = [];
  }

  const vocabTownships = uniqueNonEmpty(
    vocabRows
      .filter((r) => r.type === "TOWNSHIP")
      .map((r) => r.fullName || r.name)
  );
  const vocabCategories = uniqueNonEmpty(
    vocabRows
      .filter((r) => r.type === "CATEGORY")
      .map((r) => r.name || r.fullName)
  );

  let subdistricts: string[];
  if (domainProfile.domainType === "ECOMMERCE_CS") {
    subdistricts = uniqueNonEmpty([...vocabTownships, ...domainProfile.channels]);
  } else {
    subdistricts =
      vocabTownships.length > 0 ? vocabTownships : uniqueNonEmpty(domainProfile.channels);
  }

  const categories = uniqueNonEmpty([...domainProfile.categories, ...vocabCategories]);

  return {
    regionId,
    regionName: region?.name || domainProfile.displayName,
    domainProfile,
    subdistricts,
    categories,
    channels: uniqueNonEmpty(domainProfile.channels),
  };
}

const ECOM_CHANNEL_ALIASES: Array<{ pattern: RegExp; matchHint: string }> = [
  { pattern: /天猫|淘宝|tmall/i, matchHint: "天猫" },
  { pattern: /抖音|直播间|douyin/i, matchHint: "抖音" },
  { pattern: /京东|\bjd\b/i, matchHint: "京东" },
  { pattern: /拼多多|pdd/i, matchHint: "拼多多" },
  { pattern: /华南冷链|华南仓|冷链仓/i, matchHint: "华南冷链" },
  { pattern: /华东中心|华东仓/i, matchHint: "华东" },
  { pattern: /华北分拨|华北仓/i, matchHint: "华北" },
  { pattern: /保税仓|跨境仓/i, matchHint: "保税" },
];

function matchChannelOrSubdistrict(
  text: string,
  candidates: string[],
  domainType: DomainType,
  regionId: string
): string {
  const cleaned = text.trim();
  if (!cleaned) return "";

  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  for (const cand of sorted) {
    if (cleaned.includes(cand)) return cand;
    const short = cand.replace(/(街道|镇|乡|旗舰店|官方店|自营店|直播间)$/, "");
    if (short.length >= 2 && cleaned.includes(short)) return cand;
  }

  if (domainType === "ECOMMERCE_CS") {
    for (const rule of ECOM_CHANNEL_ALIASES) {
      if (rule.pattern.test(cleaned)) {
        const hit = sorted.find((cand) => cand.includes(rule.matchHint));
        if (hit) return hit;
      }
    }
    return "";
  }

  if (domainType === "GOV_12345") {
    const preset = loadPresetVocabulary(regionId);
    const candidateSet = new Set(candidates);
    const regionMatchesPreset =
      preset.regionId === regionId ||
      regionId === "shunde" ||
      regionId === "fs_shunde" ||
      regionId === "gz_tianhe";
    for (const town of preset.townships) {
      const targetName = town.fullName || town.name;
      if (!regionMatchesPreset && !candidateSet.has(targetName) && !candidateSet.has(town.name)) {
        continue;
      }
      const labels = [
        town.fullName,
        town.name,
        ...(town.aliases || []),
        ...(town.communities || []),
        ...(town.landmarks || []),
      ];
      for (const lbl of labels) {
        if (lbl && lbl.length >= 2 && cleaned.includes(lbl)) {
          return targetName;
        }
      }
    }
  }
  return "";
}

function inferGovCategory(text: string, allowed: string[]): string {
  const profiled = profileTicket({ content: text }, []);
  if (profiled.category && allowed.includes(profiled.category)) {
    return profiled.category;
  }
  if (/噪音|噪声|油烟|废气|恶臭|异味|排污|黑臭|倾倒/.test(text)) return "生态环境";
  if (/违停|拥堵|堵车|红绿灯|信号灯|出租车|公交|占道施工/.test(text)) return "交通出行";
  if (/停水|爆管|漏水|路灯|井盖|积水|下水道|垃圾|占道|摊贩|违建|电梯/.test(text)) return "城市管理";
  if (/欠薪|工资|社保|医保|工伤|劳动/.test(text)) return "劳动社保";
  if (/退款|欺诈|假货|假冒|价格|无证|食安|食品|超市|消费/.test(text)) return "市场监管";
  if (/消防|飞线|烟花|爆竹|火灾|燃气|危险品|充电/.test(text)) return "公共安全";
  if (/物业|业委会|邻里|纠纷|信访|噪音扰民|保安/.test(text)) return "社会治理";
  return "";
}

function extractAddressSlot(text: string, domainType: DomainType): string {
  const compact = text.replace(/\s+/g, "");
  if (domainType === "ECOMMERCE_CS") {
    const orderMatch = compact.match(
      /(?:订单编号|快递单号|物流单号|运单号|订单号?|单号)(?:是|为|[：:#])*([A-Za-z0-9][A-Za-z0-9-]{5,31})/
    );
    if (orderMatch?.[1]) return `订单 ${orderMatch[1]}`;
    const warehouseMatch = compact.match(
      /([\u4e00-\u9fff]{2,8}(?:冷链仓|中心仓|分拨仓|保税仓|配送站|网点|分拣中心))/
    );
    if (warehouseMatch?.[1]) return warehouseMatch[1];
    return "";
  }

  const cleaned = compact.replace(/广东省|广州市|佛山市|天河区|顺德区/g, "");
  const addrMatch = cleaned.match(
    /([\u4e00-\u9fffA-Za-z0-9·]{2,14}(?:大道|路|巷|街(?!道)|小区|花园|苑|轩|广场|大厦|工业区|市场|村|公园)(?:\d+(?:[-、]\d+)?号)?(?:[\u4e00-\u9fff0-9·]{1,12}(?:档|店|铺|馆|栋|座|号))?)/
  );
  if (addrMatch?.[1]) {
    const raw = addrMatch[1];
    // 仅剥离匹配串开头的叙事引导词，避免误切「XX路88号楼下XX店」的门牌前缀
    const val = raw
      .replace(
        /^(?:我是|我家|我们|我|小区|目前|现在|关于|具体)?(?:位于|具体地址是?|具体位置是?|地址是?|位置是?|就在|在|到|是|反映|投诉|楼下|旁边|附近|门口|对面|的|了)+/,
        ""
      )
      .trim();
    if (val.length >= 3 && !/(?:街道|镇)$/.test(val)) {
      return val.slice(0, 120);
    }
  }
  const labeledAddr = compact.match(/(?:具体地址|详细地址|事发地址|地址|位置|地点)(?:是|为|[：:])([^，,。；;\n]{3,40})/);
  if (labeledAddr?.[1]) {
    const val = labeledAddr[1].trim();
    if (val.length >= 3 && !/(?:街道|镇)$/.test(val)) {
      return val.slice(0, 120);
    }
  }
  return "";
}

function extractSubjectSlot(text: string, domainType: DomainType): string {
  const skuMatch = text.match(SKU_RE);
  if (skuMatch?.[1]) {
    return skuMatch[1].toUpperCase();
  }
  const labeledSku = text.match(LABELED_SKU_RE);
  if (labeledSku?.[1]) {
    const code = labeledSku[1].toUpperCase();
    return code.startsWith("SKU") ? code : `SKU-${code}`;
  }

  const compact = text.replace(/\s+/g, "");
  if (domainType === "ECOMMERCE_CS") {
    const labeledEcom = compact.match(
      /(?:涉事店铺|店铺名称?|商家|品牌|商品名称?|购买商品)(?:是|为|叫|[：:])([^，,。；;\n]{2,24})/
    );
    if (labeledEcom?.[1]) {
      const cleaned = labeledEcom[1].replace(/^(?:我?在|我?从|买的|购买的)+/, "").trim();
      if (cleaned.length >= 2 && !isGenericSubject(cleaned)) {
        return cleaned.slice(0, 120);
      }
    }

    const productMatch = compact.match(
      /([\u4e00-\u9fffA-Za-z0-9]{2,18}(?:礼盒|生鲜|海鲜|牛肉|牛排|水果|奶粉|保健品|护肤品|洗面奶|面霜|精华|耳机|空气炸锅|加湿器|破壁机|咖啡机|纸巾|猫粮|狗粮|羽绒服|家电|手机))/
    );
    if (productMatch?.[1]) {
      const stripped = productMatch[1]
        .replace(/^.*?(?:买的|购买的|下单的|收到|寄来的|损坏的|变质的)/, "")
        .trim();
      const val = stripped.length >= 2 ? stripped : productMatch[1];
      if (!isGenericSubject(val)) return val.slice(0, 120);
    }

    const shopOrCarrierMatch = compact.match(
      /([\u4e00-\u9fffA-Za-z0-9]{2,16}(?:旗舰店|官方店|自营店|专营店|直播间|店铺|快递|冷链|承运商))/
    );
    if (shopOrCarrierMatch?.[1]) {
      const stripped = shopOrCarrierMatch[1]
        .replace(/^(?:我的|买的|收到的|寄来的|我?在|我?从|承运商是?|快递是?|店铺是?|关于|投诉)+/, "")
        .trim();
      if (stripped.length >= 2 && !isGenericSubject(stripped)) {
        return stripped.slice(0, 120);
      }
    }
  }

  const govSubjMatch = compact.match(
    /(?:店名|招牌|商家|涉事单位|单位名称)(?:是|为|叫|[：:])\s*([^，,。；;\n]{2,30})|(?:号|门口|楼下|旁边|附近|在|位于)?([\u4e00-\u9fffA-Za-z·]{2,16}(?:烧烤档|烧烤摊|烧烤店|大排档|餐厅|餐馆|饭店|清吧|酒吧|KTV|ktv|工地|电子厂|工厂|物业公司|物业|有限公司|公司|药店|超市|夜市|小吃店|奶茶店))/
  );
  const candidateRaw = (govSubjMatch?.[1] || govSubjMatch?.[2] || "").trim();
  const candidateParts = candidateRaw.split(/(?:街道|镇|大道|路|巷|街|门口|楼下|旁边|附近|在|位于)/);
  const candidate = (candidateParts[candidateParts.length - 1] || candidateRaw).trim();
  if (candidate && candidate.length >= 2 && !isGenericSubject(candidate)) {
    return candidate.slice(0, 120);
  }
  return "";
}

function mergeUniqueUserContent(draftContent: string | undefined, userTexts: string[]): string {
  let acc = (draftContent || "").trim();
  for (const part of userTexts) {
    const clean = part.trim();
    if (!clean) continue;
    if (!acc) {
      acc = clean;
    } else if (!acc.includes(clean)) {
      acc = `${acc}；${clean}`;
    }
  }
  return acc;
}

function replyAddressesMissingFields(reply: string, missingFields: string[]): boolean {
  if (!reply) return false;
  return missingFields.some((field) => {
    if (reply.includes(field.slice(0, 2))) return true;
    if (field.includes("镇街") || field.includes("渠道")) return /镇街|街道|渠道|仓网|店铺/.test(reply);
    if (field.includes("地址") || field.includes("门牌")) return /地址|路名|门牌|地点|位置/.test(reply);
    if (field.includes("SKU") || field.includes("商品")) return /SKU|sku|商品|店铺|品牌/.test(reply);
    if (field.includes("分类")) return /分类|类型/.test(reply);
    if (field.includes("描述")) return /描述|详情|经过|问题/.test(reply);
    return false;
  });
}

function buildConciseTitle(draft: IntakeDraft, domainType: DomainType): string {
  if (draft.title.trim()) return draft.title.trim().slice(0, 48);
  const head = [draft.subdistrict, draft.subject || draft.address].filter(Boolean).join(" · ");
  if (head && draft.category) return `${head}（${draft.category}）`.slice(0, 48);
  const firstClause = draft.content.split(/[。！？；;\n]/)[0]?.trim() || "";
  if (firstClause.length >= 4) return firstClause.slice(0, 36);
  return domainType === "ECOMMERCE_CS" ? "电商售后客诉登记" : "市民民生诉求登记";
}

function computeMissingFields(draft: IntakeDraft, domainType: DomainType): string[] {
  const missing: string[] = [];
  if (draft.content.trim().length < 6) {
    missing.push("详细诉求描述");
  }
  if (!draft.subdistrict.trim()) {
    missing.push(domainType === "ECOMMERCE_CS" ? "渠道/仓网" : "所属镇街");
  }
  if (!draft.category.trim()) {
    missing.push("诉求分类");
  }
  if (domainType === "GOV_12345" && !draft.address.trim()) {
    missing.push("具体路名门牌/地点");
  }
  if (domainType === "ECOMMERCE_CS" && !draft.subject.trim()) {
    missing.push("涉事SKU/商品或店铺");
  }
  return missing;
}

const IntakeLlmSchema = z.object({
  reply: z.string().optional().default(""),
  title: z.string().optional().default(""),
  subdistrict: z.string().optional().default(""),
  category: z.string().optional().default(""),
  subject: z.string().optional().default(""),
  address: z.string().optional().default(""),
});

export async function processIntakeChat(input: {
  regionId: string;
  messages: IntakeChatMessage[];
  draft?: Partial<IntakeDraft>;
  signal?: AbortSignal;
}): Promise<{
  domainType: DomainType;
  reply: string;
  draft: IntakeDraft;
  missingFields: string[];
  readyToSubmit: boolean;
  usedLlm: boolean;
}> {
  if (input.signal?.aborted) {
    throw createAbortError(input.signal);
  }
  const options = await loadIntakeOptions(input.regionId);
  const domainType = options.domainProfile.domainType;

  const userTexts = input.messages
    .filter((m) => m.role === "user" && m.content.trim().length > 0)
    .map((m) => m.content.trim());
  const latestUserText = userTexts[userTexts.length - 1] || "";

  // 汇总全部用户陈述（跨轮次去重，不重复拼接历史句）
  const combinedRaw = mergeUniqueUserContent(input.draft?.content, userTexts);

  // 保留既有已填槽位，绝不在后续轮次无意覆盖已确认的槽位
  const existingTitle = clampStr(input.draft?.title, 48);
  const existingSubdistrict = clampStr(input.draft?.subdistrict, 64);
  const existingCategory = clampStr(input.draft?.category, 64);
  const existingAddress = clampStr(input.draft?.address, 120);
  const rawExistingSubject = clampStr(input.draft?.subject, 120);
  const existingSubject = isGenericSubject(rawExistingSubject) ? "" : rawExistingSubject;
  const existingPhone = clampStr(input.draft?.contactPhone, 32);

  // 1. 确定性中文规则抽取（永远保底可用）
  const phoneMatch = latestUserText.match(PHONE_RE) || combinedRaw.match(PHONE_RE);
  const extractedPhone = existingPhone || (phoneMatch?.[0] ?? "");

  const ruleSubdistrict =
    existingSubdistrict ||
    matchChannelOrSubdistrict(latestUserText, options.subdistricts, domainType, input.regionId) ||
    matchChannelOrSubdistrict(combinedRaw, options.subdistricts, domainType, input.regionId);

  const ruleCategoryRaw =
    existingCategory ||
    (domainType === "ECOMMERCE_CS"
      ? combinedRaw.length >= 4
        ? evaluateEcommerceTicket({ content: combinedRaw, subdistrict: ruleSubdistrict }).category
        : ""
      : inferGovCategory(combinedRaw, options.categories));
  const ruleCategory = options.categories.includes(ruleCategoryRaw)
    ? ruleCategoryRaw
    : canonicalizeCategory(ruleCategoryRaw) || ruleCategoryRaw;

  const ruleAddress =
    existingAddress ||
    extractAddressSlot(latestUserText, domainType) ||
    extractAddressSlot(combinedRaw, domainType);

  const ruleSubject =
    existingSubject ||
    extractSubjectSlot(latestUserText, domainType) ||
    extractSubjectSlot(combinedRaw, domainType);

  // 2. 脱敏后再尝试 System-2 增强（12s 超时 + 严格 JSON 解析）
  let usedLlm = false;
  let llmReply = "";
  let llmPatch: Partial<IntakeDraft> = {};

  if (latestUserText.length > 0) {
    const anonCombined = anonymize(combinedRaw);
    const anonLatest = anonymize(latestUserText, { seedKeymap: anonCombined.keymap });
    const mergedKeymap = { ...anonCombined.keymap, ...anonLatest.keymap };

    const systemPrompt =
      domainType === "ECOMMERCE_CS"
        ? `你是电商平台「智能售后客服」。请从脱敏后的用户陈述中抽取结构化草稿，并返回严格 JSON：{ "reply": "1-2句亲切自然的中文口播回复", "title": "简短标题", "subdistrict": "匹配渠道/仓网名", "category": "匹配客诉分类", "subject": "SKU编号或涉事商品/店铺", "address": "订单号或仓网地点" }。可选渠道/仓网：${options.subdistricts.join("、")}；可选分类：${options.categories.join("、")}。未提及的字段留空字符串。`
        : `你是12345政务服务热线「智能语音受理员」。请从脱敏后的市民陈述中抽取结构化草稿，并返回严格 JSON：{ "reply": "1-2句亲切自然的中文口播回复", "title": "简短标题", "subdistrict": "匹配镇街名", "category": "匹配分类", "subject": "涉事主体/商铺/单位", "address": "具体路名门牌/地点" }。可选镇街：${options.subdistricts.join("、")}；可选分类：${options.categories.join("、")}。未提及的字段留空字符串。`;

    const llmRes = await callSystemTwoJsonSafe(
      IntakeLlmSchema,
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `历史累积陈述：${anonCombined.text}\n最新一句：${anonLatest.text}`,
        },
      ],
      480,
      input.signal
    );

    if (llmRes) {
      usedLlm = true;
      const restored = deanonymize(llmRes.data, mergedKeymap);
      const subText = (restored.subdistrict || "").trim();
      const catText = (restored.category || "").trim();
      llmReply = clampStr(restored.reply, 220);
      const validSub = options.subdistricts.includes(subText) ? subText : "";
      const validCat = options.categories.includes(catText) ? catText : "";
      const llmSubj = clampStr(restored.subject, 120);
      llmPatch = {
        title: clampStr(restored.title, 48),
        subdistrict: validSub,
        category: validCat,
        subject: isGenericSubject(llmSubj) ? "" : llmSubj,
        address: clampStr(restored.address, 120),
      };
    }
  }

  // 已确认的 existing* 槽位优先保护；缺失槽位优先采纳经校验的 LLM 语义抽取，并保留明确 SKU/订单号
  const preferExplicitEcomOrder =
    domainType === "ECOMMERCE_CS" &&
    /^订单\s+[A-Za-z0-9-]+/.test(ruleAddress) &&
    !/[A-Za-z0-9]{5,}/.test(llmPatch.address || "");
  const preferExplicitSku =
    domainType === "ECOMMERCE_CS" &&
    /^SKU[-_]/i.test(ruleSubject) &&
    !/SKU[-_]/i.test(llmPatch.subject || "");

  const prevDraftForTitle: IntakeDraft = {
    title: "",
    content: clampStr(input.draft?.content, 2000),
    subdistrict: existingSubdistrict,
    category: existingCategory,
    subject: existingSubject,
    address: existingAddress,
    contactPhone: existingPhone,
  };
  const prevFirstClause =
    prevDraftForTitle.content.split(/[。！？；;\n]/)[0]?.trim().slice(0, 36) || "";
  const prevAutoTitle = prevDraftForTitle.content
    ? buildConciseTitle(prevDraftForTitle, domainType)
    : "";
  const isPlaceholderTitle =
    !existingTitle ||
    existingTitle === "市民民生诉求登记" ||
    existingTitle === "电商售后客诉登记" ||
    (prevFirstClause.length >= 4 && existingTitle === prevFirstClause) ||
    (Boolean(prevAutoTitle) && existingTitle === prevAutoTitle);

  // 群众在最新一句里明确说出的主体/地址（原文可见）视为更正，覆盖前几轮推断出的旧值
  const subjectCandidate = preferExplicitSku ? ruleSubject : llmPatch.subject || ruleSubject;
  const addressCandidate = preferExplicitEcomOrder ? ruleAddress : llmPatch.address || ruleAddress;
  const explicitlyRestated = (candidate: string | undefined, existing: string): boolean =>
    Boolean(candidate) &&
    candidate !== existing &&
    latestUserText.includes(candidate as string) &&
    !(existing && latestUserText.includes(existing));

  const mergedDraft: IntakeDraft = {
    title: isPlaceholderTitle ? llmPatch.title || "" : existingTitle,
    content: clampStr(combinedRaw, 2000),
    subdistrict: existingSubdistrict || llmPatch.subdistrict || ruleSubdistrict || "",
    category: existingCategory || llmPatch.category || ruleCategory || "",
    subject:
      (explicitlyRestated(subjectCandidate, existingSubject) ? subjectCandidate : existingSubject) ||
      subjectCandidate ||
      "",
    address:
      (explicitlyRestated(addressCandidate, existingAddress) ? addressCandidate : existingAddress) ||
      addressCandidate ||
      "",
    contactPhone: clampStr(extractedPhone, 32),
  };

  if (!mergedDraft.title) {
    mergedDraft.title = buildConciseTitle(mergedDraft, domainType);
  }

  const missingFields = computeMissingFields(mergedDraft, domainType);
  const readyToSubmit =
    mergedDraft.content.trim().length >= 6 &&
    mergedDraft.subdistrict.trim().length > 0 &&
    mergedDraft.category.trim().length > 0 &&
    missingFields.length === 0;

  let reply = llmReply;
  if (!reply || (!readyToSubmit && !replyAddressesMissingFields(reply, missingFields))) {
    if (readyToSubmit) {
      reply =
        domainType === "ECOMMERCE_CS"
          ? `已为您整理好「${mergedDraft.subdistrict} · ${mergedDraft.category}」客诉摘要，信息已齐全，请核对后确认提交。`
          : `已为您整理好「${mergedDraft.subdistrict} · ${mergedDraft.category}」诉求草稿，关键信息已齐全，请核对后点击确认提交。`;
    } else if (latestUserText.length === 0) {
      reply =
        domainType === "ECOMMERCE_CS"
          ? "您好，我是智能售后客服，请告诉我您遇到的商品或物流问题、购买渠道和SKU编号。"
          : "您好，我是 12345 智能语音受理员，请告诉我您要反映的问题、所在街道以及具体路名门牌。";
    } else {
      reply = `我已记录您的诉求，还需要补充${missingFields.join("和")}，麻烦再说明一下以便精准派单。`;
    }
  }

  return {
    domainType,
    reply,
    draft: mergedDraft,
    missingFields,
    readyToSubmit,
    usedLlm,
  };
}

export async function submitCitizenTicket(input: {
  regionId: string;
  userId: string;
  userName: string;
  title?: string;
  content: string;
  subdistrict: string;
  category: string;
  subject?: string;
  address?: string;
  contactPhone?: string;
  source?: "FORM" | "AGENT_VOICE";
  skipAutoCluster?: boolean;
}) {
  const content = input.content.trim();
  const subdistrict = input.subdistrict.trim();
  const category = input.category.trim();
  const domainProfile = await getRegionDomainProfile(input.regionId);
  const isEcommerce = domainProfile.domainType === "ECOMMERCE_CS";
  const { region } = await getRegionDb(input.regionId);
  const vocab = await getRegionVocabulary(input.regionId);

  const anonContent = anonymize(content);
  const cleanTitle =
    clampStr(input.title, 120) ||
    content.split(/[。！？；;\n]/)[0]?.trim().slice(0, 48) ||
    (isEcommerce ? "买家售后客诉" : "市民诉求");

  let urgency: "NORMAL" | "MEDIUM" | "URGENT" = "NORMAL";
  let slaHours = 120;
  let stabilityRisk = false;

  if (isEcommerce) {
    const decision = evaluateEcommerceTicket({
      title: cleanTitle,
      content: anonContent.text,
      subdistrict,
    });
    urgency = decision.urgency;
    slaHours = decision.slaHours;
    stabilityRisk = decision.stabilityRisk;
  } else {
    const rawFullText = [cleanTitle, content].filter(Boolean).join(" ");
    const symbolicRedline = hasCivicRedlineSignal(rawFullText);
    try {
      const systemOne = await getIntakeSystemOne();
      const decision = await systemOne.evaluate(
        {
          title: cleanTitle,
          content: anonContent.text,
          subdistrict,
        },
        { townships: vocab.townships }
      );
      stabilityRisk = decision.stabilityRisk || symbolicRedline;
      urgency =
        stabilityRisk || decision.urgencyLevel === 3
          ? "URGENT"
          : decision.urgencyLevel === 2
            ? "MEDIUM"
            : "NORMAL";
      slaHours = stabilityRisk ? 2 : decision.slaHours;
    } catch {
      stabilityRisk = symbolicRedline;
      urgency = stabilityRisk ? "URGENT" : "NORMAL";
      slaHours = stabilityRisk ? 2 : 120;
    }
  }

  const randSuffix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const ticketNo = `${isEcommerce ? "EC" : "IN"}-${shanghaiDateStr().replace(/-/g, "").slice(2)}-${randSuffix}`;

  const { records } = buildRecordsFromRows(
    [
      {
        ticketNo,
        title: cleanTitle,
        content,
        subdistrict,
        sourceCategory: category,
        citizenName: clampStr(input.userName, 64) || (isEcommerce ? "买家用户" : "热线市民"),
        citizenPhone: clampStr(input.contactPhone, 64),
        channel:
          input.source === "AGENT_VOICE"
            ? "AI语音受理"
            : isEcommerce
              ? subdistrict
              : "市民自助提交",
      },
    ],
    isEcommerce ? "EC" : "IN",
    {
      townships: vocab.townships,
      district: region?.name || null,
      city: region?.city || null,
      province: region?.province || null,
    }
  );

  const record = records[0];
  if (!record) {
    throw new Error("构建工单记录失败");
  }

  const now = new Date();
  record.id = `tk-${Date.now()}-${randomUUID().slice(0, 6)}`;
  record.ticketNo = ticketNo;
  record.title = cleanTitle;
  record.summarizeTitle = cleanTitle;
  record.maskedContent = anonContent.text;
  record.subdistrict = clampStr(subdistrict, 64);
  record.sourceCategory = clampStr(category, 64);
  record.address = clampNullable(input.address, 255);
  record.canonicalSubject = clampNullable(input.subject, 255);
  record.urgency = urgency;
  record.slaHours = slaHours;
  record.stabilityRisk = stabilityRisk;
  record.createTime = now;
  record.status = "PENDING";
  record.confidence = null;
  record.primaryThemeId = null;

  const insertResult = await insertRecordsBatch([record], input.regionId);
  if (insertResult.insertedCount === 0 && insertResult.failedCount > 0) {
    throw new Error("工单写入租户数据库失败");
  }

  await ensureCitizenSubmissionsTable();
  const submissionId = `sub-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await sql`
    INSERT INTO public.citizen_submissions (
      id, user_id, region_id, ticket_id, ticket_no, title, category, subdistrict, created_at
    ) VALUES (
      ${submissionId},
      ${input.userId},
      ${input.regionId},
      ${record.id},
      ${record.ticketNo},
      ${cleanTitle},
      ${clampStr(category, 64)},
      ${clampStr(subdistrict, 64)},
      ${now.toISOString()}
    )
  `;

  if (input.skipAutoCluster !== true) {
    triggerClusterJobAuto(input.regionId).catch((err) => {
      console.warn("[intake/submit] auto cluster warning:", err?.message || err);
    });
  }

  broadcastDataRefresh(input.regionId);

  return {
    ticketId: record.id as string,
    ticketNo: record.ticketNo as string,
    status: String(record.status || "PENDING"),
    urgency,
    slaHours,
    maskedPreview: anonContent.text,
    themeId: (record.primaryThemeId as string | null) ?? null,
  };
}

export async function listCitizenTickets(
  userId: string,
  regionId: string
): Promise<CitizenTicketDto[]> {
  await ensureCitizenSubmissionsTable();
  const submissions = await sql<
    Array<{
      id: string;
      ticket_id: string;
      ticket_no: string;
      title: string | null;
      category: string | null;
      subdistrict: string | null;
      created_at: Date;
    }>
  >`
    SELECT id, ticket_id, ticket_no, title, category, subdistrict, created_at
    FROM public.citizen_submissions
    WHERE user_id = ${userId} AND region_id = ${regionId}
    ORDER BY created_at DESC
    LIMIT 100
  `;

  if (submissions.length === 0) {
    return [];
  }

  await ensureDisposalLogsTable(regionId);
  const { db: tenantDb } = await getRegionDb(regionId);
  const ticketIds = submissions.map((s) => s.ticket_id);

  const ticketRows = await tenantDb
    .select({
      id: ticketsTable.id,
      ticketNo: ticketsTable.ticketNo,
      title: ticketsTable.title,
      summarizeTitle: ticketsTable.summarizeTitle,
      content: ticketsTable.content,
      maskedContent: ticketsTable.maskedContent,
      subdistrict: ticketsTable.subdistrict,
      sourceCategory: ticketsTable.sourceCategory,
      status: ticketsTable.status,
      closureStatus: ticketsTable.closureStatus,
      isFakeClosure: ticketsTable.isFakeClosure,
      primaryThemeId: ticketsTable.primaryThemeId,
      createdAt: ticketsTable.createdAt,
    })
    .from(ticketsTable)
    .where(inArray(ticketsTable.id, ticketIds));

  const ticketMap = new Map(ticketRows.map((t) => [t.id, t]));
  const themeIds = uniqueNonEmpty(ticketRows.map((t) => t.primaryThemeId));

  const themeRows =
    themeIds.length > 0
      ? await tenantDb
          .select({ id: themesTable.id, title: themesTable.title })
          .from(themesTable)
          .where(inArray(themesTable.id, themeIds))
      : [];
  const themeMap = new Map(themeRows.map((th) => [th.id, th.title]));

  const ticketLogs = await tenantDb
    .select()
    .from(disposalLogsTable)
    .where(and(eq(disposalLogsTable.targetType, "TICKET"), inArray(disposalLogsTable.targetId, ticketIds)))
    .orderBy(desc(disposalLogsTable.createdAt));

  const latestTicketLogMap = new Map<string, CitizenTicketLogDto>();
  for (const log of ticketLogs) {
    if (!latestTicketLogMap.has(log.targetId)) {
      latestTicketLogMap.set(log.targetId, {
        action: log.action,
        note: log.note ?? null,
        fromStatus: log.fromStatus ?? null,
        toStatus: log.toStatus ?? null,
        operator: log.operator ?? null,
        createdAt: asIso(log.createdAt),
      });
    }
  }

  const latestThemeLogMap = new Map<string, CitizenTicketLogDto>();
  if (themeIds.length > 0) {
    const themeLogs = await tenantDb
      .select()
      .from(disposalLogsTable)
      .where(and(eq(disposalLogsTable.targetType, "THEME"), inArray(disposalLogsTable.targetId, themeIds)))
      .orderBy(desc(disposalLogsTable.createdAt));
    for (const log of themeLogs) {
      if (!latestThemeLogMap.has(log.targetId)) {
        latestThemeLogMap.set(log.targetId, {
          action: log.action,
          note: log.note ?? null,
          fromStatus: log.fromStatus ?? null,
          toStatus: log.toStatus ?? null,
          operator: log.operator ?? null,
          createdAt: asIso(log.createdAt),
        });
      }
    }
  }

  return submissions.map((sub) => {
    const tk = ticketMap.get(sub.ticket_id);
    const themeId = tk?.primaryThemeId ?? null;
    const latestLog =
      latestTicketLogMap.get(sub.ticket_id) ??
      (themeId ? latestThemeLogMap.get(themeId) ?? null : null);

    return {
      id: tk?.id || sub.ticket_id,
      ticketNo: tk?.ticketNo || sub.ticket_no,
      title: tk?.summarizeTitle || tk?.title || sub.title || "我的诉求",
      content: tk?.maskedContent || tk?.content || "",
      subdistrict: tk?.subdistrict || sub.subdistrict || "",
      category: tk?.sourceCategory || sub.category || "",
      status: tk?.status || "PENDING",
      closureStatus: tk?.closureStatus ?? null,
      isFakeClosure: Boolean(tk?.isFakeClosure),
      themeId,
      themeTitle: themeId ? themeMap.get(themeId) ?? null : null,
      latestLog,
      createdAt: asIso(tk?.createdAt ?? sub.created_at),
    };
  });
}

export async function reopenCitizenTicket(input: {
  idOrNo: string;
  userId: string;
  operatorName: string;
  regionId: string;
  reason?: string;
}): Promise<
  | { ok: true; ticketId: string; ticketNo: string; themeId: string | null; reopened: true }
  | { ok: false; status: 403 | 404; error: string }
> {
  await ensureCitizenSubmissionsTable();
  const rows = await sql<Array<{ user_id: string; ticket_id: string; ticket_no: string }>>`
    SELECT user_id, ticket_id, ticket_no
    FROM public.citizen_submissions
    WHERE region_id = ${input.regionId}
      AND (ticket_id = ${input.idOrNo} OR ticket_no = ${input.idOrNo} OR id = ${input.idOrNo})
    LIMIT 1
  `;

  const sub = rows[0];
  if (!sub) {
    return { ok: false, status: 404, error: "未找到对应的本人提交工单记录" };
  }
  if (sub.user_id !== input.userId) {
    return { ok: false, status: 403, error: "无权操作其他用户提交的工单" };
  }

  const { db: tenantDb } = await getRegionDb(input.regionId);
  const [ticket] = await tenantDb
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, sub.ticket_id))
    .limit(1);

  if (!ticket) {
    return { ok: false, status: 404, error: "目标工单在当前辖区中不存在" };
  }

  const now = new Date();
  const note = clampStr(input.reason, 400) || "诉求人反馈问题未真正解决，申请重开复核";

  await tenantDb
    .update(ticketsTable)
    .set({
      isFakeClosure: true,
      status: "REOPENED",
      closureStatus: "REOPENED",
      updatedAt: now,
    })
    .where(eq(ticketsTable.id, ticket.id));

  await recordDisposalLog({
    regionId: input.regionId,
    targetType: "TICKET",
    targetId: ticket.id,
    action: "REOPEN",
    fromStatus: ticket.status || "RESOLVED",
    toStatus: "REOPENED",
    operator: clampStr(input.operatorName, 64) || input.userId,
    note,
    meta: { source: "CITIZEN_REOPEN", ticketNo: ticket.ticketNo },
  });

  let reopenedThemeId: string | null = ticket.primaryThemeId ?? null;
  if (reopenedThemeId) {
    const [theme] = await tenantDb
      .select()
      .from(themesTable)
      .where(eq(themesTable.id, reopenedThemeId))
      .limit(1);
    const themeStatus = (theme?.handlingStatus || "").trim().toUpperCase();
    if (theme && (themeStatus === "RESOLVED" || theme.handlingStatus === "已办结")) {
      await tenantDb
        .update(themesTable)
        .set({
          handlingStatus: "REOPENED",
          handlingProgress: 30,
        })
        .where(eq(themesTable.id, theme.id));

      await recordDisposalLog({
        regionId: input.regionId,
        targetType: "THEME",
        targetId: theme.id,
        action: "REOPEN",
        fromStatus: theme.handlingStatus || "RESOLVED",
        toStatus: "REOPENED",
        owner: theme.handlingOwner || null,
        operator: clampStr(input.operatorName, 64) || input.userId,
        note: `市民对工单 ${ticket.ticketNo} 申请假闭环重开：${note}`,
        meta: { ticketId: ticket.id, ticketNo: ticket.ticketNo },
      });
    }
  }

  invalidateCivicAggregates(input.regionId);
  broadcastDataRefresh(input.regionId);

  return {
    ok: true,
    ticketId: ticket.id,
    ticketNo: ticket.ticketNo,
    themeId: reopenedThemeId,
    reopened: true,
  };
}

// =========================================================================
// 2. 管理员高参与度主动 Agent 治理中心 (/api/agent/*)
// =========================================================================

export async function listAgentTasks(
  regionId: string,
  filters?: { status?: string | null; autonomyLevel?: string | null }
): Promise<{
  domainType: DomainType;
  summary: AgentTasksSummary;
  tasks: AgentTaskDto[];
}> {
  const schemaName = await ensureAgentGovernanceTables(regionId);
  const profile = await getRegionDomainProfile(regionId);

  const rows = await sql.unsafe(
    `SELECT * FROM "${schemaName}".agent_tasks ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 100`
  );
  const allTasks = rows.map((r) => toTaskDto(r as Record<string, unknown>));
  const summary = summarizeTasks(allTasks);

  let filtered = allTasks;
  if (filters?.status?.trim()) {
    const s = filters.status.trim().toUpperCase();
    filtered = filtered.filter((t) => t.status === s);
  }
  if (filters?.autonomyLevel?.trim()) {
    const lvl = filters.autonomyLevel.trim().toUpperCase();
    filtered = filtered.filter((t) => t.autonomyLevel === lvl);
  }

  return {
    domainType: profile.domainType,
    summary,
    tasks: filtered,
  };
}

function extractOwnerFromAction(recommendedAction?: string | null, fallbackOwner?: string | null): string {
  if (fallbackOwner && fallbackOwner.trim()) return fallbackOwner.trim().slice(0, 64);
  const raw = recommendedAction || "";
  const m = raw.match(/(?:牵头部门|责任部门|责任团队|承办单位)[：:]\s*([^\n；;，,。]+)/);
  if (m?.[1]) return m[1].trim().slice(0, 64);
  return "综合督办专班";
}

function detectMissingSlots(
  ticket: {
    address: string | null;
    canonicalSubject: string | null;
    subdistrict: string | null;
    confidence: number | null;
  },
  isEcommerce: boolean
): string[] {
  const slots: string[] = [];
  const addr = (ticket.address || "").trim();
  const sub = (ticket.subdistrict || "").trim();
  const subj = (ticket.canonicalSubject || "").trim();

  if (!addr || (isEcommerce && addr === sub)) {
    slots.push(isEcommerce ? "订单号/收货仓网明细" : "具体路名门牌/地点");
  }
  if (!subj || isGenericSubject(subj)) {
    slots.push(isEcommerce ? "涉事SKU/商品名称" : "涉事主体/商铺单位");
  }
  if (!sub) {
    slots.push(isEcommerce ? "渠道/仓网" : "所属镇街");
  }
  if (slots.length === 0 && (ticket.confidence == null || ticket.confidence < 70)) {
    slots.push("要素置信度待核验");
  }
  return slots;
}

interface PatrolCandidate {
  taskType: AgentTaskType;
  autonomyLevel: AutonomyLevel;
  status: AgentTaskStatus;
  targetType: "TICKET" | "THEME";
  targetId: string;
  targetTitle: string;
  channel: string;
  maskedContact: string | null;
  missingSlots: string[];
  draftMessage: string;
  suggestedOwner: string | null;
  reason: string;
}

export async function runAgentPatrol(regionId: string): Promise<{
  domainType: DomainType;
  createdCount: number;
  summary: AgentTasksSummary;
  tasks: AgentTaskDto[];
}> {
  const [schemaName, profile] = await Promise.all([
    ensureAgentGovernanceTables(regionId),
    getRegionDomainProfile(regionId),
  ]);
  const isEcommerce = profile.domainType === "ECOMMERCE_CS";

  const genericSubjectSqlList =
    "('涉事方', '相关主体', '未知', '不详', '无', '空', 'null', 'undefined', '市民', '车主', '商家', '某单位', '某店铺', '买家', '卖家', '客服', '当事人', '业主', '消费者', '顾客', '商铺', '店铺', '单位', '涉事单位', '涉事店铺', '涉事商家', '涉事主体')";
  const missingCondition = isEcommerce
    ? `(t.address IS NULL OR t.address = '' OR t.address = t.subdistrict OR char_length(coalesce(t.address, '')) <= 6 OR t.canonical_subject IS NULL OR t.canonical_subject = '' OR t.canonical_subject IN ${genericSubjectSqlList} OR t.confidence IS NULL OR t.confidence < 70)`
    : `(t.address IS NULL OR t.address = '' OR t.canonical_subject IS NULL OR t.canonical_subject = '' OR t.canonical_subject IN ${genericSubjectSqlList} OR t.confidence IS NULL OR t.confidence < 70)`;

  const [existingRows, stabilityRows, missingRowsRaw, overdueThemeRowsRaw, resolvedThemeRows] =
    await Promise.all([
      sql.unsafe(
        `SELECT target_type, target_id, task_type FROM "${schemaName}".agent_tasks WHERE status <> 'REJECTED'`
      ),
      sql.unsafe(`
        SELECT t.id, t.ticket_no, t.title, t.summarize_title, t.content, t.masked_content,
               t.citizen_phone, t.subdistrict, t.address, t.canonical_subject, t.confidence, t.stability_risk
        FROM "${schemaName}".tickets t
        WHERE t.status IN ('PENDING', 'IN_PROGRESS', 'REOPENED')
          AND t.stability_risk = true
          AND NOT EXISTS (
            SELECT 1 FROM "${schemaName}".agent_tasks at
            WHERE at.target_type = 'TICKET'
              AND at.target_id = t.id
              AND at.task_type = 'REDLINE_BLOCK'
              AND at.status <> 'REJECTED'
          )
        ORDER BY t.create_time DESC NULLS LAST, t.id DESC
        LIMIT 24
      `),
      sql.unsafe(`
        SELECT t.id, t.ticket_no, t.title, t.summarize_title, t.content, t.masked_content,
               t.citizen_phone, t.subdistrict, t.source_category, t.address, t.canonical_subject, t.confidence, t.stability_risk
        FROM "${schemaName}".tickets t
        WHERE t.status = 'PENDING'
          AND coalesce(t.stability_risk, false) = false
          AND ${missingCondition}
          AND NOT EXISTS (
            SELECT 1 FROM "${schemaName}".agent_tasks at
            WHERE at.target_type = 'TICKET'
              AND at.target_id = t.id
              AND at.task_type = 'MISSING_INFO'
              AND at.status <> 'REJECTED'
          )
        ORDER BY
          (CASE WHEN t.address IS NULL OR t.address = '' OR t.canonical_subject IS NULL OR t.canonical_subject = '' THEN 0 ELSE 1 END) ASC,
          t.create_time DESC NULLS LAST,
          t.id DESC
        LIMIT 30
      `),
      sql.unsafe(`
        SELECT th.id, th.title, th.category, th.risk_level, th.ticket_count, th.time_span_hours,
               th.handling_owner, th.recommended_action, th.canonical_location
        FROM "${schemaName}".themes th
        WHERE upper(coalesce(th.handling_status, 'PENDING')) = 'PENDING'
          AND th.ticket_count >= 5
          AND (
            (th.handling_eta IS NOT NULL AND th.handling_eta < now())
            OR (th.handling_eta IS NULL AND (
              (th.last_at IS NOT NULL AND th.last_at < now() - interval '24 hours')
              OR (th.first_at IS NOT NULL AND th.first_at < now() - interval '24 hours')
              OR th.time_span_hours >= 24
              OR th.created_at < now() - interval '24 hours'
            ))
          )
          AND NOT EXISTS (
            SELECT 1 FROM "${schemaName}".agent_tasks at
            WHERE at.target_type = 'THEME'
              AND at.target_id = th.id
              AND at.task_type = 'SLA_OVERDUE'
              AND at.status <> 'REJECTED'
          )
        ORDER BY
          CASE upper(coalesce(th.risk_level, '')) WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END ASC,
          th.ticket_count DESC,
          th.id DESC
        LIMIT 24
      `),
      sql.unsafe(`
        SELECT th.id, th.title, th.category, th.ticket_count, th.handling_owner, th.recommended_action, th.canonical_location
        FROM "${schemaName}".themes th
        WHERE upper(coalesce(th.handling_status, '')) IN ('RESOLVED', '已办结')
          AND NOT EXISTS (
            SELECT 1 FROM "${schemaName}".agent_tasks at
            WHERE at.target_type = 'THEME'
              AND at.target_id = th.id
              AND at.task_type = 'REOPEN_CALLBACK'
              AND at.status <> 'REJECTED'
          )
        ORDER BY th.last_at DESC NULLS LAST, th.ticket_count DESC, th.id DESC
        LIMIT 12
      `),
    ]);

  const activeOrDoneKeys = new Set<string>();
  for (const row of existingRows) {
    activeOrDoneKeys.add(`${row.target_type}:${row.target_id}:${row.task_type}`);
  }

  // 1. 扫描涉稳/合规红线工单 -> L3_BLOCKED (REDLINE_BLOCK)
  const sqlRedlinePattern = isEcommerce ? SQL_ECOM_REDLINE_PATTERN : SQL_CORE_REDLINE_PATTERN;
  const redlineCandidates: PatrolCandidate[] = [];
  const pushRedlineCandidate = (r: Record<string, unknown>) => {
    const id = String(r.id);
    if (activeOrDoneKeys.has(`TICKET:${id}:REDLINE_BLOCK`)) return;
    if (
      r.stability_risk !== true &&
      !hasRedlineSignal(`${r.title || ""} ${r.content || ""}`, { isEcommerce })
    ) {
      return;
    }
    const rawTitle = String(r.summarize_title || r.title || r.ticket_no || id);
    const safeTitle = maskFreeText(rawTitle).slice(0, 140);
    const maskedContact = maskContactForGovernance(
      r.citizen_phone as string | null,
      r.content as string | null
    );
    const missingSlots = detectMissingSlots(
      {
        address: r.address as string | null,
        canonicalSubject: r.canonical_subject as string | null,
        subdistrict: r.subdistrict as string | null,
        confidence: r.confidence == null ? null : Number(r.confidence),
      },
      isEcommerce
    );
    redlineCandidates.push({
      taskType: "REDLINE_BLOCK",
      autonomyLevel: "L3_BLOCKED",
      status: "BLOCKED",
      targetType: "TICKET",
      targetId: id,
      targetTitle: `${r.ticket_no} · ${safeTitle}`,
      channel: "MANUAL",
      maskedContact,
      missingSlots,
      draftMessage: maskFreeText(
        isEcommerce
          ? `【合规红线熔断】工单 ${r.ticket_no}（${safeTitle}）涉及 12315/食安/社媒舆情红线（联系方式 ${maskedContact}），系统严禁自动外联，请法务与主管人工接管核查。`
          : `【涉稳红线熔断】工单 ${r.ticket_no}（${safeTitle}）触发群体涉稳红线（联系方式 ${maskedContact}），已禁止 AI 自动外呼，请专班人工研判接管。`
      ),
      suggestedOwner: isEcommerce ? "售后合规与法务专班" : "涉稳督办专班",
      reason: "命中红线规则（stabilityRisk=true 或高敏舆情/人体健康风险），L3 强制人工熔断拦截",
    });
  };

  for (const r of stabilityRows) {
    pushRedlineCandidate(r as Record<string, unknown>);
  }

  if (stabilityRows.length < 4) {
    const FALLBACK_PAGE_SIZE = 120;
    const MAX_FALLBACK_PAGES = 10;
    for (let page = 0; page < MAX_FALLBACK_PAGES && redlineCandidates.length < 24; page++) {
      const batch = await sql.unsafe(
        `
        SELECT t.id, t.ticket_no, t.title, t.summarize_title, t.content, t.masked_content,
               t.citizen_phone, t.subdistrict, t.address, t.canonical_subject, t.confidence, t.stability_risk
        FROM "${schemaName}".tickets t
        WHERE t.status IN ('PENDING', 'IN_PROGRESS', 'REOPENED')
          AND coalesce(t.stability_risk, false) = false
          AND (t.title ~ $1 OR t.content ~ $1)
          AND NOT EXISTS (
            SELECT 1 FROM "${schemaName}".agent_tasks at
            WHERE at.target_type = 'TICKET'
              AND at.target_id = t.id
              AND at.task_type = 'REDLINE_BLOCK'
              AND at.status <> 'REJECTED'
          )
        ORDER BY t.create_time DESC NULLS LAST, t.id DESC
        LIMIT ${FALLBACK_PAGE_SIZE} OFFSET $2
        `,
        [sqlRedlinePattern, page * FALLBACK_PAGE_SIZE]
      );
      for (const r of batch) {
        pushRedlineCandidate(r as Record<string, unknown>);
      }
      if (batch.length < FALLBACK_PAGE_SIZE) break;
    }
  }

  // 2. 扫描要素缺失/低置信度待处置工单 -> MISSING_INFO (政务 L2_APPROVAL / 电商 L1_AUTO)
  const missingRows = [...missingRowsRaw].sort((a, b) => {
    const aMiss = !a.address || !a.canonical_subject ? 0 : 1;
    const bMiss = !b.address || !b.canonical_subject ? 0 : 1;
    return aMiss - bMiss;
  });

  const missingCandidates: PatrolCandidate[] = [];
  for (const r of missingRows) {
    const id = String(r.id);
    const fullText = `${r.title || ""} ${r.content || ""}`;
    if (hasRedlineSignal(fullText, { isEcommerce })) continue;
    if (activeOrDoneKeys.has(`TICKET:${id}:MISSING_INFO`)) continue;

    const rawTitle = String(r.summarize_title || r.title || r.ticket_no || id);
    const safeTitle = maskFreeText(rawTitle).slice(0, 140);
    const maskedContact = maskContactForGovernance(
      r.citizen_phone as string | null,
      r.content as string | null
    );
    const missingSlots = detectMissingSlots(
      {
        address: r.address as string | null,
        canonicalSubject: r.canonical_subject as string | null,
        subdistrict: r.subdistrict as string | null,
        confidence: r.confidence == null ? null : Number(r.confidence),
      },
      isEcommerce
    );

    const slotLabel = missingSlots.join("、") || "关键要素";
    const draftMessage = maskFreeText(
      isEcommerce
        ? `您好（联系方式 ${maskedContact}），关于您在「${r.subdistrict || "平台店铺"}」提交的「${safeTitle}」客诉，为加快核赔进度，请补充您的${slotLabel}（如订单号及SKU编号）。`
        : `您好（来电号码 ${maskedContact}），这里是12345民声智能核实专席，关于您反映的「${safeTitle}」，为精准派单核查，请问方便补充一下${slotLabel}吗？`
    );

    missingCandidates.push({
      taskType: "MISSING_INFO",
      autonomyLevel: isEcommerce ? "L1_AUTO" : "L2_APPROVAL",
      status: "PENDING",
      targetType: "TICKET",
      targetId: id,
      targetTitle: `${r.ticket_no} · ${safeTitle}`,
      channel: "VOICE_SIM",
      maskedContact,
      missingSlots,
      draftMessage,
      suggestedOwner: isEcommerce ? "智能售后补全专员" : `${r.subdistrict || "属地"}核查专员`,
      reason: `缺失核心槽位（${slotLabel}）或置信度偏低（${r.confidence ?? "未抽取"}）`,
    });
  }

  // 3. 扫描高聚集且处于 PENDING 的主题 -> SLA_OVERDUE (L1_AUTO)
  const riskRank = (lvl: unknown) => {
    const s = String(lvl || "").toUpperCase();
    return s === "HIGH" ? 0 : s === "MEDIUM" ? 1 : 2;
  };
  const overdueThemeRows = [...overdueThemeRowsRaw].sort(
    (a, b) => riskRank(a.risk_level) - riskRank(b.risk_level) || Number(b.ticket_count || 0) - Number(a.ticket_count || 0)
  );

  const overdueCandidates: PatrolCandidate[] = [];
  for (const th of overdueThemeRows) {
    const id = String(th.id);
    if (activeOrDoneKeys.has(`THEME:${id}:SLA_OVERDUE`)) continue;
    const safeTitle = maskFreeText(String(th.title || id)).slice(0, 140);
    const owner = extractOwnerFromAction(
      th.recommended_action as string | null,
      th.handling_owner as string | null
    );
    const count = Number(th.ticket_count || 0);
    overdueCandidates.push({
      taskType: "SLA_OVERDUE",
      autonomyLevel: "L1_AUTO",
      status: "PENDING",
      targetType: "THEME",
      targetId: id,
      targetTitle: safeTitle,
      channel: "WORKFLOW_WEBHOOK",
      maskedContact: null,
      missingSlots: [],
      draftMessage: maskFreeText(
        isEcommerce
          ? `【客诉积压催办单】专题「${safeTitle}」已汇聚 ${count} 起待办客诉（风险等级 ${th.risk_level}），请责任团队「${owner}」在 2 小时内响应整改并同步赔付方案。`
          : `【12345超期督办催办单】专题「${safeTitle}」已聚集 ${count} 件待处置工单（风险等级 ${th.risk_level}），请牵头部门「${owner}」立即核实处置并回传进展。`
      ),
      suggestedOwner: owner,
      reason: `多频专题（${count} 件诉求，风险 ${th.risk_level}）长期处于 PENDING 待处置状态`,
    });
  }

  // 4. 扫描 RESOLVED 已办结主题 -> REOPEN_CALLBACK (L2_APPROVAL)
  const callbackCandidates: PatrolCandidate[] = [];
  for (const th of resolvedThemeRows) {
    const id = String(th.id);
    if (activeOrDoneKeys.has(`THEME:${id}:REOPEN_CALLBACK`)) continue;
    const safeTitle = maskFreeText(String(th.title || id)).slice(0, 140);
    const owner = extractOwnerFromAction(
      th.recommended_action as string | null,
      th.handling_owner as string | null
    );
    callbackCandidates.push({
      taskType: "REOPEN_CALLBACK",
      autonomyLevel: "L2_APPROVAL",
      status: "PENDING",
      targetType: "THEME",
      targetId: id,
      targetTitle: safeTitle,
      channel: "VOICE_SIM",
      maskedContact: "{{PHONE_NUMBER_1}}",
      missingSlots: [],
      draftMessage: maskFreeText(
        isEcommerce
          ? `您好（联系方式 {{PHONE_NUMBER_1}}），这里是售后质检回访专席，关于您此前反馈的「${safeTitle}」已显示办结，请问问题是否已经真正解决、退款或补发是否已到位？`
          : `您好（来电号码 {{PHONE_NUMBER_1}}），这里是12345政务服务48小时满意度回访专席，关于您反映的「${safeTitle}」系统显示已办结，请问现场是否已彻底整改、问题有没有复发？`
      ),
      suggestedOwner: owner,
      reason: "已办结专题 48h 满意度抽查回访，严防假闭环",
    });
  }

  // 如果该租户没有任何已办结主题，降级检查已办结单工单（供演示假闭环回访）
  if (resolvedThemeRows.length === 0) {
    const resolvedThemeExists = await sql.unsafe(`
      SELECT 1 FROM "${schemaName}".themes
      WHERE upper(coalesce(handling_status, '')) IN ('RESOLVED', '已办结')
      LIMIT 1
    `);
    if (resolvedThemeExists.length === 0) {
      const resolvedTickets = await sql.unsafe(`
      SELECT t.id, t.ticket_no, t.title, t.summarize_title, t.citizen_phone, t.content, t.subdistrict, t.primary_theme_id
      FROM "${schemaName}".tickets t
      WHERE (t.status = 'RESOLVED' OR t.closure_status = 'RESOLVED')
        AND NOT EXISTS (
          SELECT 1 FROM "${schemaName}".agent_tasks at
          WHERE at.task_type = 'REOPEN_CALLBACK'
            AND at.status <> 'REJECTED'
            AND (
              (at.target_type = 'TICKET' AND at.target_id = t.id)
              OR (t.primary_theme_id IS NOT NULL AND at.target_type = 'THEME' AND at.target_id = t.primary_theme_id)
            )
        )
      ORDER BY t.closed_at DESC NULLS LAST, t.created_at DESC, t.id DESC
      LIMIT 6
    `);
      for (const tk of resolvedTickets) {
        const id = String(tk.id);
        const themeId = tk.primary_theme_id ? String(tk.primary_theme_id) : "";
        if (activeOrDoneKeys.has(`TICKET:${id}:REOPEN_CALLBACK`)) continue;
        if (themeId && activeOrDoneKeys.has(`THEME:${themeId}:REOPEN_CALLBACK`)) continue;
        const safeTitle = maskFreeText(String(tk.summarize_title || tk.title || tk.ticket_no)).slice(0, 140);
        const maskedContact = maskContactForGovernance(
          tk.citizen_phone as string | null,
          tk.content as string | null
        );
        callbackCandidates.push({
          taskType: "REOPEN_CALLBACK",
          autonomyLevel: "L2_APPROVAL",
          status: "PENDING",
          targetType: "TICKET",
          targetId: id,
          targetTitle: `${tk.ticket_no} · ${safeTitle}`,
          channel: "VOICE_SIM",
          maskedContact,
          missingSlots: [],
          draftMessage: maskFreeText(
            `您好（联系方式 ${maskedContact}），关于已办结工单「${safeTitle}」进行48小时满意度回访，请问问题是否已经真正解决？`
          ),
          suggestedOwner: `${tk.subdistrict || "属地"}回访坐席`,
          reason: "已办结工单 48h 满意度核验，排查假闭环",
        });
      }
    }
  }

  // 均衡轮询挑选最多 8 条（确保 L1/L2/L3 各类型样本均衡）
  const buckets = [redlineCandidates, missingCandidates, overdueCandidates, callbackCandidates];
  const selected: PatrolCandidate[] = [];
  const cursors = [0, 0, 0, 0];

  while (selected.length < 8) {
    let progressed = false;
    for (let i = 0; i < buckets.length && selected.length < 8; i++) {
      if (cursors[i] < buckets[i].length) {
        selected.push(buckets[i][cursors[i]]);
        cursors[i] += 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  const baseMs = Date.now();
  if (selected.length > 0) {
    await Promise.all(
      selected.map((item, idx) => {
        const taskId = `at-${baseMs}-${idx}-${randomUUID().slice(0, 8)}`;
        const itemIso = new Date(baseMs - idx).toISOString();
        return sql.unsafe(
          `
          INSERT INTO "${schemaName}".agent_tasks (
            id, task_type, autonomy_level, status, target_type, target_id, target_title,
            channel, masked_contact, missing_slots_json, draft_message, suggested_owner,
            reason, result_summary, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12,
            $13, NULL, $14, $14
          )
          `,
          [
            taskId,
            item.taskType,
            item.autonomyLevel,
            item.status,
            item.targetType,
            item.targetId,
            item.targetTitle,
            item.channel,
            item.maskedContact,
            JSON.stringify(item.missingSlots),
            item.draftMessage,
            item.suggestedOwner,
            item.reason,
            itemIso,
          ]
        );
      })
    );
  }

  const latest = await listAgentTasks(regionId);
  return {
    domainType: latest.domainType,
    createdCount: selected.length,
    summary: latest.summary,
    tasks: latest.tasks,
  };
}

export async function applyAgentTaskAction(input: {
  regionId: string;
  taskId: string;
  action: "APPROVE" | "REJECT" | "EXECUTE";
  operatorName: string;
  note?: string;
}): Promise<
  | { ok: true; task: AgentTaskDto; webhookSent: boolean; smtpLogged: boolean }
  | { ok: false; status: 400 | 404; code: string; error: string }
> {
  const schemaName = await ensureAgentGovernanceTables(input.regionId);
  const rows = await sql.unsafe(
    `SELECT * FROM "${schemaName}".agent_tasks WHERE id = $1 LIMIT 1`,
    [input.taskId]
  );
  const rawTask = rows[0] as Record<string, unknown> | undefined;
  if (!rawTask) {
    return { ok: false, status: 404, code: "NOT_FOUND", error: "未找到指定的 Agent 待办任务" };
  }

  const task = toTaskDto(rawTask);

  if (
    (task.autonomyLevel === "L3_BLOCKED" || task.taskType === "REDLINE_BLOCK") &&
    (input.action === "EXECUTE" || input.action === "APPROVE")
  ) {
    return {
      ok: false,
      status: 400,
      code: "REDLINE_BLOCKED",
      error: "该任务受涉稳/合规红线熔断保护，严禁通过 API 自动外联，请前往详情页人工核查接管",
    };
  }

  const now = new Date();
  const note = clampStr(input.note, 400);
  let nextStatus: AgentTaskStatus = task.status;
  let resultSummary = task.resultSummary || "";
  let webhookSent = false;
  let smtpLogged = false;

  if (input.action === "REJECT") {
    nextStatus = "REJECTED";
    resultSummary = note || "管理员已驳回该主动治理任务";
    await recordDisposalLog({
      regionId: input.regionId,
      targetType: task.targetType,
      targetId: task.targetId,
      action: "UPDATE_STATUS",
      fromStatus: task.status,
      toStatus: "REJECTED",
      owner: task.suggestedOwner,
      operator: clampStr(input.operatorName, 64) || "admin",
      note: `[Agent任务驳回] ${resultSummary}`,
      meta: { agentTaskId: task.id, taskType: task.taskType },
    });
  } else {
    const isExpedite = task.taskType === "SLA_OVERDUE";
    nextStatus = input.action === "EXECUTE" ? "EXECUTED" : "APPROVED";

    if (isExpedite) {
      webhookSent = await sendWebhookIfConfigured({
        type: "SLA_OVERDUE_EXPEDITE",
        regionId: input.regionId,
        taskId: task.id,
        targetId: task.targetId,
        targetTitle: task.targetTitle,
        suggestedOwner: task.suggestedOwner,
        message: task.draftMessage,
        operator: input.operatorName,
        timestamp: now.toISOString(),
      });
      smtpLogged = logSmtpAdapterIfConfigured(
        `催办提醒: ${task.targetTitle}`,
        task.draftMessage
      );
      if (input.action === "EXECUTE") {
        nextStatus = "EXECUTED";
      }
      resultSummary =
        note ||
        (webhookSent
          ? "已发送 Webhook 催办卡片并写入处置审计日志"
          : smtpLogged
            ? "已记录 SMTP 催办适配日志并完成内部闭环"
            : "已通过内部闭环记录超期催办审计日志");
    } else {
      resultSummary =
        note ||
        (nextStatus === "EXECUTED"
          ? `已完成 ${task.taskType} 主动治理执行闭环`
          : `管理员已批准 ${task.taskType} 主动治理话术`);
    }

    await recordDisposalLog({
      regionId: input.regionId,
      targetType: task.targetType,
      targetId: task.targetId,
      action: isExpedite ? "DISPATCH" : "ADVANCE",
      fromStatus: task.status,
      toStatus: nextStatus,
      owner: task.suggestedOwner,
      operator: clampStr(input.operatorName, 64) || "admin",
      note: `[Agent主动治理] ${resultSummary}`,
      meta: {
        agentTaskId: task.id,
        taskType: task.taskType,
        autonomyLevel: task.autonomyLevel,
        webhookSent,
        smtpLogged,
      },
    });
  }

  const updatedRows = await sql.unsafe(
    `
    UPDATE "${schemaName}".agent_tasks
    SET status = $1, result_summary = $2, updated_at = $3
    WHERE id = $4
    RETURNING *
    `,
    [nextStatus, resultSummary, now.toISOString(), task.id]
  );

  return {
    ok: true,
    task: toTaskDto((updatedRows[0] as Record<string, unknown>) || rawTask),
    webhookSent,
    smtpLogged,
  };
}

const VoiceMissingInfoLlmSchema = z.object({
  address: z.string().optional().default(""),
  canonicalSubject: z.string().optional().default(""),
  subdistrict: z.string().optional().default(""),
  reply: z.string().optional().default(""),
});

const VoiceCallbackLlmSchema = z.object({
  sentiment: z.enum(["NEGATIVE", "POSITIVE", "UNCLEAR"]).default("UNCLEAR"),
  reply: z.string().optional().default(""),
});

export async function processAgentVoiceTurn(input: {
  regionId: string;
  taskId: string;
  transcript: string;
  turnIndex?: number;
  operatorName: string;
  signal?: AbortSignal;
}): Promise<
  | {
      ok: true;
      reply: string;
      completed: boolean;
      extractedPatch?: Record<string, string>;
      triggeredFakeClosure?: boolean;
      reopenedThemeId?: string | null;
      task: AgentTaskDto;
    }
  | { ok: false; status: 400 | 404; code: string; error: string }
> {
  if (input.signal?.aborted) {
    throw createAbortError(input.signal);
  }
  const schemaName = await ensureAgentGovernanceTables(input.regionId);
  const rows = await sql.unsafe(
    `SELECT * FROM "${schemaName}".agent_tasks WHERE id = $1 LIMIT 1`,
    [input.taskId]
  );
  const rawTask = rows[0] as Record<string, unknown> | undefined;
  if (!rawTask) {
    return { ok: false, status: 404, code: "NOT_FOUND", error: "未找到指定的 Agent 任务" };
  }

  const task = toTaskDto(rawTask);
  if (task.autonomyLevel === "L3_BLOCKED" || task.taskType === "REDLINE_BLOCK") {
    return {
      ok: false,
      status: 400,
      code: "REDLINE_BLOCKED",
      error: "红线熔断任务禁止 AI 自动语音外呼，请转人工核查",
    };
  }

  const transcript = input.transcript.trim();
  const options = await loadIntakeOptions(input.regionId);
  const domainType = options.domainProfile.domainType;
  const { db: tenantDb } = await getRegionDb(input.regionId);
  const anonTranscript = anonymize(transcript);
  const now = new Date();

  if (task.taskType === "MISSING_INFO") {
    const [existingTicket] = await tenantDb
      .select({
        address: ticketsTable.address,
        canonicalSubject: ticketsTable.canonicalSubject,
        subdistrict: ticketsTable.subdistrict,
        confidence: ticketsTable.confidence,
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, task.targetId))
      .limit(1);

    const existingAddr = (existingTicket?.address || "").trim();
    const existingSubd = (existingTicket?.subdistrict || "").trim();
    const existingSubj = (existingTicket?.canonicalSubject || "").trim();
    const isEcommerce = domainType === "ECOMMERCE_CS";

    const hasConfirmedAddress =
      Boolean(existingAddr) &&
      !(isEcommerce && (existingAddr === existingSubd || existingAddr.length <= 6));
    const hasConfirmedSubject = Boolean(existingSubj) && !isGenericSubject(existingSubj);
    const hasConfirmedSubdistrict = Boolean(existingSubd);

    const ruleAddr = extractAddressSlot(transcript, domainType);
    const rawRuleSubj = extractSubjectSlot(transcript, domainType);
    const ruleSubj = isGenericSubject(rawRuleSubj) ? "" : rawRuleSubj;
    const ruleSubd = matchChannelOrSubdistrict(
      transcript,
      options.subdistricts,
      domainType,
      input.regionId
    );
    let llmAddr = "";
    let llmSubj = "";
    let llmSubd = "";
    let llmReply = "";

    const llmRes = await callSystemTwoJsonSafe(
      VoiceMissingInfoLlmSchema,
      [
        {
          role: "system",
          content:
            domainType === "ECOMMERCE_CS"
              ? `你是售后核查专员。从客户口述中提取补充信息，返回严格 JSON：{ "address": "订单号或仓网地点", "canonicalSubject": "SKU编号或涉事商品/店铺", "subdistrict": "购买渠道或仓网", "reply": "1句礼貌确认或追问" }。可选渠道：${options.subdistricts.join("、")}。`
              : `你是12345核查回访专员。从市民口述中提取补充要素，返回严格 JSON：{ "address": "具体路名门牌/地点", "canonicalSubject": "涉事商铺/单位名称", "subdistrict": "所属镇街", "reply": "1句礼貌确认或追问" }。可选镇街：${options.subdistricts.join("、")}。`,
        },
        { role: "user", content: anonTranscript.text },
      ],
      384,
      input.signal
    );

    if (llmRes) {
      const restored = deanonymize(llmRes.data, anonTranscript.keymap);
      llmAddr = clampStr(restored.address, 255);
      const rawLlmSubj = clampStr(restored.canonicalSubject, 255);
      llmSubj = isGenericSubject(rawLlmSubj) ? "" : rawLlmSubj;
      const candidateSubd = (restored.subdistrict || "").trim();
      llmSubd = options.subdistricts.includes(candidateSubd) ? candidateSubd : "";
      llmReply = clampStr(restored.reply, 220);
    }

    const preferExplicitEcomOrder =
      isEcommerce &&
      /^订单\s+[A-Za-z0-9-]+/.test(ruleAddr) &&
      !/[A-Za-z0-9]{5,}/.test(llmAddr);
    const preferExplicitSku =
      isEcommerce &&
      /^SKU[-_]/i.test(ruleSubj) &&
      !/SKU[-_]/i.test(llmSubj);

    const resolvedAddress = preferExplicitEcomOrder ? ruleAddr : llmAddr || ruleAddr;
    const resolvedSubject = preferExplicitSku ? ruleSubj : llmSubj || ruleSubj;
    const resolvedSubdistrict = llmSubd || ruleSubd;

    const patch: Record<string, string> = {};
    if (!hasConfirmedAddress && resolvedAddress) {
      patch.address = resolvedAddress.slice(0, 255);
    }
    if (!hasConfirmedSubject && resolvedSubject && !isGenericSubject(resolvedSubject)) {
      patch.canonicalSubject = resolvedSubject.slice(0, 255);
    }
    if (!hasConfirmedSubdistrict && resolvedSubdistrict) {
      patch.subdistrict = resolvedSubdistrict.slice(0, 64);
    }

    if (Object.keys(patch).length > 0) {
      await tenantDb
        .update(ticketsTable)
        .set({
          ...patch,
          confidence: Math.max(Number(existingTicket?.confidence || 0), 88),
          updatedAt: now,
        })
        .where(eq(ticketsTable.id, task.targetId));

      const patchDesc = Object.entries(patch)
        .map(([k, v]) => `${k}=${v}`)
        .join("，");
      const summary = `语音核查已补全要素：${patchDesc}`;

      await recordDisposalLog({
        regionId: input.regionId,
        targetType: "TICKET",
        targetId: task.targetId,
        action: "CORRECT_ENTITY",
        operator: clampStr(input.operatorName, 64) || "admin",
        note: `[AI语音补全] ${summary}`,
        meta: { agentTaskId: task.id, extractedPatch: patch },
      });

      const updatedRows = await sql.unsafe(
        `
        UPDATE "${schemaName}".agent_tasks
        SET status = 'EXECUTED', result_summary = $1, updated_at = $2
        WHERE id = $3
        RETURNING *
        `,
        [summary, now.toISOString(), task.id]
      );

      invalidateCivicAggregates(input.regionId);
      broadcastDataRefresh(input.regionId);

      const reply =
        llmReply ||
        `好的，感谢您的补充！我已经记录到${Object.values(patch).join(" · ")}，工单信息已补全并转入精准处置流程。`;

      return {
        ok: true,
        reply,
        completed: true,
        extractedPatch: patch,
        task: toTaskDto((updatedRows[0] as Record<string, unknown>) || rawTask),
      };
    }

    return {
      ok: true,
      reply:
        llmReply ||
        (domainType === "ECOMMERCE_CS"
          ? "抱歉暂未听清订单号或具体SKU编号，麻烦您再提供一下涉及的商品名称、SKU或购买渠道。"
          : "抱歉暂未识别到具体路名门牌或涉事商铺名称，麻烦您再说明一下详细位置。"),
      completed: false,
      extractedPatch: {},
      task,
    };
  }

  // REOPEN_CALLBACK 分支（48h 满意度回访与假闭环嗅探）
  let sentiment: "NEGATIVE" | "POSITIVE" | "UNCLEAR" = evaluateCallbackSentiment(transcript);

  let llmReply = "";
  const llmCb = await callSystemTwoJsonSafe(
    VoiceCallbackLlmSchema,
    [
      {
        role: "system",
        content:
          '你是12345/售后满意度回访专员。判断对方回复属于未解决/复发负反馈(NEGATIVE)、满意办结(POSITIVE)还是未表态(UNCLEAR)，返回 JSON：{ "sentiment": "NEGATIVE|POSITIVE|UNCLEAR", "reply": "1句礼貌得体的回访应答" }。',
      },
      { role: "user", content: anonTranscript.text },
    ],
    320,
    input.signal
  );
  if (llmCb) {
    if (sentiment === "UNCLEAR" && llmCb.data.sentiment) {
      sentiment = llmCb.data.sentiment;
    }
    llmReply = clampStr(deanonymize(llmCb.data.reply, anonTranscript.keymap), 220);
  }

  if (sentiment === "NEGATIVE") {
    let reopenedThemeId: string | null = null;

    if (task.targetType === "THEME") {
      reopenedThemeId = task.targetId;
      await tenantDb
        .update(themesTable)
        .set({
          handlingStatus: "REOPENED",
          handlingProgress: 30,
          riskLevel: "HIGH",
        })
        .where(eq(themesTable.id, task.targetId));

      const linkedRows = await tenantDb
        .select({ ticketId: ticketThemesTable.ticketId })
        .from(ticketThemesTable)
        .where(eq(ticketThemesTable.themeId, task.targetId))
        .limit(3);

      const repTicketIds = linkedRows.map((l) => l.ticketId);
      if (repTicketIds.length === 0) {
        const directTickets = await tenantDb
          .select({ id: ticketsTable.id })
          .from(ticketsTable)
          .where(eq(ticketsTable.primaryThemeId, task.targetId))
          .limit(3);
        repTicketIds.push(...directTickets.map((t) => t.id));
      }

      if (repTicketIds.length > 0) {
        await tenantDb
          .update(ticketsTable)
          .set({
            isFakeClosure: true,
            status: "REOPENED",
            closureStatus: "REOPENED",
            updatedAt: now,
          })
          .where(inArray(ticketsTable.id, repTicketIds));
      }

      await recordDisposalLog({
        regionId: input.regionId,
        targetType: "THEME",
        targetId: task.targetId,
        action: "REOPEN",
        fromStatus: "RESOLVED",
        toStatus: "REOPENED",
        owner: task.suggestedOwner,
        operator: clampStr(input.operatorName, 64) || "admin",
        note: `[AI语音回访触发假闭环重开] 反馈内容：${anonTranscript.text.slice(0, 120)}`,
        meta: { agentTaskId: task.id, repTicketIds },
      });
    } else {
      const [tk] = await tenantDb
        .select({ primaryThemeId: ticketsTable.primaryThemeId })
        .from(ticketsTable)
        .where(eq(ticketsTable.id, task.targetId))
        .limit(1);

      await tenantDb
        .update(ticketsTable)
        .set({
          isFakeClosure: true,
          status: "REOPENED",
          closureStatus: "REOPENED",
          updatedAt: now,
        })
        .where(eq(ticketsTable.id, task.targetId));

      reopenedThemeId = tk?.primaryThemeId ?? null;
      if (reopenedThemeId) {
        await tenantDb
          .update(themesTable)
          .set({
            handlingStatus: "REOPENED",
            handlingProgress: 30,
            riskLevel: "HIGH",
          })
          .where(eq(themesTable.id, reopenedThemeId));
      }

      await recordDisposalLog({
        regionId: input.regionId,
        targetType: "TICKET",
        targetId: task.targetId,
        action: "REOPEN",
        fromStatus: "RESOLVED",
        toStatus: "REOPENED",
        operator: clampStr(input.operatorName, 64) || "admin",
        note: `[AI语音回访触发假闭环重开] 反馈内容：${anonTranscript.text.slice(0, 120)}`,
        meta: { agentTaskId: task.id, reopenedThemeId },
      });
    }

    const updatedRows = await sql.unsafe(
      `
      UPDATE "${schemaName}".agent_tasks
      SET status = 'EXECUTED', result_summary = $1, updated_at = $2
      WHERE id = $3
      RETURNING *
      `,
      ["语音回访发现问题未解决，已触发疑似假闭环重开督办", now.toISOString(), task.id]
    );

    invalidateCivicAggregates(input.regionId);
    broadcastDataRefresh(input.regionId);

    return {
      ok: true,
      reply:
        llmReply ||
        "非常抱歉给您带来困扰！我已将此事项标记为疑似假闭环并立即重开督办，将安排专人复核整改并向您反馈。",
      completed: true,
      triggeredFakeClosure: true,
      reopenedThemeId,
      task: toTaskDto((updatedRows[0] as Record<string, unknown>) || rawTask),
    };
  }

  if (sentiment === "POSITIVE") {
    await recordDisposalLog({
      regionId: input.regionId,
      targetType: task.targetType,
      targetId: task.targetId,
      action: "RESOLVE",
      fromStatus: "RESOLVED",
      toStatus: "RESOLVED",
      owner: task.suggestedOwner,
      operator: clampStr(input.operatorName, 64) || "admin",
      note: `[AI语音回访满意完结] 反馈内容：${anonTranscript.text.slice(0, 120)}`,
      meta: { agentTaskId: task.id },
    });

    const updatedRows = await sql.unsafe(
      `
      UPDATE "${schemaName}".agent_tasks
      SET status = 'EXECUTED', result_summary = $1, updated_at = $2
      WHERE id = $3
      RETURNING *
      `,
      ["48h AI 语音回访确认已满意解决，正常完结归档", now.toISOString(), task.id]
    );

    return {
      ok: true,
      reply:
        llmReply ||
        "感谢您的宝贵反馈！很高兴确认问题已经顺利解决，本次回访已完成归档，祝您生活愉快！",
      completed: true,
      triggeredFakeClosure: false,
      reopenedThemeId: null,
      task: toTaskDto((updatedRows[0] as Record<string, unknown>) || rawTask),
    };
  }

  return {
    ok: true,
    reply:
      llmReply ||
      "请问您此前反映的问题目前是否已经彻底解决？如果仍存在反复或敷衍办结的情况，请直接告诉我。",
    completed: false,
    triggeredFakeClosure: false,
    reopenedThemeId: null,
    task,
  };
}

export async function listAgentReports(regionId: string): Promise<AgentReportDto[]> {
  const schemaName = await ensureAgentGovernanceTables(regionId);
  const rows = await sql.unsafe(
    `SELECT * FROM "${schemaName}".agent_reports ORDER BY created_at DESC LIMIT 20`
  );
  return rows.map((r) => toReportDto(r as Record<string, unknown>));
}

export async function generateAgentReport(regionId: string): Promise<{
  report: AgentReportDto;
  reports: AgentReportDto[];
  webhookSent: boolean;
}> {
  const [schemaName, profile, { region }] = await Promise.all([
    ensureAgentGovernanceTables(regionId),
    getRegionDomainProfile(regionId),
    getRegionDb(regionId),
  ]);
  const isEcommerce = profile.domainType === "ECOMMERCE_CS";

  const [
    ticketAggRows,
    themeAggRows,
    topThemes,
    overdueThemes,
    fakeClosureItems,
    taskStatusRows,
  ] = await Promise.all([
    sql.unsafe(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE upper(coalesce(status, 'PENDING')) = 'PENDING')::int AS pending,
        count(*) FILTER (WHERE upper(coalesce(status, '')) = 'IN_PROGRESS')::int AS in_progress,
        count(*) FILTER (WHERE upper(coalesce(status, '')) = 'RESOLVED' OR closure_status = 'RESOLVED')::int AS resolved,
        count(*) FILTER (WHERE is_fake_closure = true)::int AS fake_closure,
        count(*) FILTER (WHERE stability_risk = true)::int AS stability_risk
      FROM "${schemaName}".tickets
    `),
    sql.unsafe(`
      SELECT
        count(*)::int AS total_themes,
        count(*) FILTER (WHERE upper(coalesce(risk_level, '')) = 'HIGH')::int AS high_risk_themes,
        count(*) FILTER (WHERE upper(coalesce(handling_status, 'PENDING')) = 'PENDING' AND ticket_count >= 5)::int AS overdue_themes,
        count(*) FILTER (WHERE upper(coalesce(handling_status, '')) = 'REOPENED')::int AS reopened_themes
      FROM "${schemaName}".themes
    `),
    sql.unsafe(`
      SELECT id, title, category, risk_level, ticket_count, handling_status, handling_owner, canonical_location
      FROM "${schemaName}".themes
      ORDER BY
        CASE upper(coalesce(risk_level, ''))
          WHEN 'HIGH' THEN 0
          WHEN 'MEDIUM' THEN 1
          ELSE 2
        END,
        ticket_count DESC
      LIMIT 5
    `),
    sql.unsafe(`
      SELECT id, title, ticket_count, risk_level, handling_owner, recommended_action
      FROM "${schemaName}".themes
      WHERE handling_status = 'PENDING' AND ticket_count >= 5
      ORDER BY ticket_count DESC
      LIMIT 5
    `),
    sql.unsafe(`
      SELECT id, ticket_no, title, subdistrict, status
      FROM "${schemaName}".tickets
      WHERE is_fake_closure = true OR status = 'REOPENED'
      LIMIT 5
    `),
    sql.unsafe(`
      SELECT autonomy_level, status, count(*)::int AS c
      FROM "${schemaName}".agent_tasks
      GROUP BY autonomy_level, status
    `),
  ]);

  const ticketAgg = ticketAggRows[0];
  const themeAgg = themeAggRows[0];

  const reportDate = shanghaiDateStr();
  const regionLabel = region?.name || profile.displayName;
  const stats = {
    regionId,
    regionName: regionLabel,
    domainType: profile.domainType,
    reportDate,
    totalTickets: Number(ticketAgg?.total || 0),
    pendingTickets: Number(ticketAgg?.pending || 0),
    inProgressTickets: Number(ticketAgg?.in_progress || 0),
    resolvedTickets: Number(ticketAgg?.resolved || 0),
    fakeClosureTickets: Number(ticketAgg?.fake_closure || 0),
    stabilityRiskTickets: Number(ticketAgg?.stability_risk || 0),
    totalThemes: Number(themeAgg?.total_themes || 0),
    highRiskThemes: Number(themeAgg?.high_risk_themes || 0),
    overdueThemes: Number(themeAgg?.overdue_themes || 0),
    reopenedThemes: Number(themeAgg?.reopened_themes || 0),
    agentTaskBreakdown: taskStatusRows,
  };

  const title = isEcommerce
    ? `${regionLabel} · 全渠道客诉质检与挽回专报（${reportDate}）`
    : `${regionLabel} · 每日民声研判与闭环督办专报（${reportDate}）`;

  const escapeMd = (s: string) => s.replace(/\*/g, "\\*").replace(/\|/g, "\\|");

  const topRowsMd =
    topThemes.length > 0
      ? topThemes
          .map(
            (th, idx) =>
              `| ${idx + 1} | ${escapeMd(maskFreeText(String(th.title || th.id)))} | ${escapeMd(String(th.category || "-"))} | ${th.risk_level || "LOW"} | ${th.ticket_count || 0} | ${th.handling_status || "PENDING"} |`
          )
          .join("\n")
      : "| - | 暂无多频聚集专题 | - | - | 0 | - |";

  const overdueMd =
    overdueThemes.length > 0
      ? overdueThemes
          .map((th) => {
            const owner = extractOwnerFromAction(
              th.recommended_action as string | null,
              th.handling_owner as string | null
            );
            const cleanTitle = escapeMd(maskFreeText(String(th.title || th.id)));
            return `- 「${cleanTitle}」（${th.ticket_count} 件 / 风险 ${th.risk_level} / 牵头：${escapeMd(owner)}）`;
          })
          .join("\n")
      : "- 当前无积压 >= 5 件的 PENDING 超期专题。";

  const fakeMd =
    fakeClosureItems.length > 0
      ? fakeClosureItems
          .map(
            (tk) =>
              `- \`${tk.ticket_no}\` · ${escapeMd(maskFreeText(String(tk.title || tk.id)))}（${escapeMd(String(tk.subdistrict || "未标明"))} · 当前状态：${tk.status}）`
          )
          .join("\n")
      : "- 本周期暂未新增假闭环重开工单。";

  const markdown = isEcommerce
    ? `# ${title}

> 报告域：${profile.displayName}（${regionId}） ｜ 生成日期：${reportDate} ｜ 合规脱敏状态：已启用 PII 气隙隔离

## 一、全渠道客诉核心指标总览

| 核心指标 | 数值 | 说明 |
| --- | ---: | --- |
| 累计客诉工单总量 | ${stats.totalTickets.toLocaleString("zh-CN")} | 待处置 ${stats.pendingTickets} / 处置中 ${stats.inProgressTickets} / 已办结 ${stats.resolvedTickets} |
| 客诉多频案卷总数 | ${stats.totalThemes.toLocaleString("zh-CN")} | 高风险案卷 ${stats.highRiskThemes} 个 |
| 合规/食安/12315 红线单 | ${stats.stabilityRiskTickets.toLocaleString("zh-CN")} | 强制 L3 人工接管，禁止自动外联 |
| 疑似假闭环与重开单 | ${stats.fakeClosureTickets.toLocaleString("zh-CN")} | 含重开案卷 ${stats.reopenedThemes} 个 |

## 二、Top 5 高危/多频客诉案卷排行

| 排名 | 客诉案卷标题 | 分类 | 风险 | 汇聚量 | 处置状态 |
| --- | --- | --- | --- | ---: | --- |
${topRowsMd}

## 三、超期积压督办清单（待处置 >= 5 件）

${overdueMd}

## 四、售后假闭环重开与挽回明细

${fakeMd}

## 五、次日质检与挽回行动建议

1. **红线零容忍**：对 ${stats.stabilityRiskTickets} 条涉食安/假冒/12315 风险工单由法务与品质团队优先人工兜底挽回。
2. **SKU 与仓网溯源**：聚焦 Top 5 案卷对应店铺与冷链/分拨仓，推动批量赔付与批次下架核验。
3. **48h 回访防反弹**：持续对已办结案卷开展 AI 语音回访，拦截机械安抚式假闭环。`
    : `# ${title}

> 呈报单位：${regionLabel}智能民声治理专班（${regionId}） ｜ 日期：${reportDate} ｜ 脱敏合规：全程遵循 PII 占位符隔离

## 一、辖区民生诉求核心态势

| 核心指标 | 数值 | 态势说明 |
| --- | ---: | --- |
| 累计民生工单总量 | ${stats.totalTickets.toLocaleString("zh-CN")} | 待处置 ${stats.pendingTickets} / 处置中 ${stats.inProgressTickets} / 已办结 ${stats.resolvedTickets} |
| 多频研判专题总数 | ${stats.totalThemes.toLocaleString("zh-CN")} | 高风险专题 ${stats.highRiskThemes} 个 |
| 涉稳红线预警工单 | ${stats.stabilityRiskTickets.toLocaleString("zh-CN")} | 触发 L3 熔断拦截，专班人工核查 |
| 疑似假闭环重开记录 | ${stats.fakeClosureTickets.toLocaleString("zh-CN")} | 含重开专题 ${stats.reopenedThemes} 个 |

## 二、Top 5 高风险/多频专题研判

| 排名 | 专题名称 | 业务分类 | 风险等级 | 汇聚工单 | 处置状态 |
| --- | --- | --- | --- | ---: | --- |
${topRowsMd}

## 三、超期未处置重点督办（聚集 >= 5 件）

${overdueMd}

## 四、疑似假闭环与重开核查明细

${fakeMd}

## 五、治理工作建议

1. **严格执行 L1/L2/L3 分级自治**：涉稳红线诉求坚持 L3 人工接管，普通要素补全与 48h 满意度回访须经管理员批准后外呼。
2. **压实牵头部门首办责任**：针对超期未处置专题下发内部督办单，明确整改时限。
3. **强化 48 小时回头看**：对已办结民生专题持续抽查回访，杜绝虚假办结导致重复投诉。`;

  const reportId = `rpt-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const now = new Date();
  const inserted = await sql.unsafe(
    `
    INSERT INTO "${schemaName}".agent_reports (
      id, report_date, title, markdown, stats_json, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6
    )
    RETURNING *
    `,
    [reportId, reportDate, title, markdown, JSON.stringify(stats), now.toISOString()]
  );

  const report = toReportDto((inserted[0] as Record<string, unknown>) || {});
  logSmtpAdapterIfConfigured(title, markdown.slice(0, 200));
  const [webhookSent, reports] = await Promise.all([
    sendWebhookIfConfigured({
      type: "DAILY_AGENT_REPORT",
      regionId,
      reportId: report.id,
      reportDate,
      title,
      stats,
      markdownPreview: markdown.slice(0, 800),
    }),
    listAgentReports(regionId),
  ]);
  return { report, reports, webhookSent };
}
