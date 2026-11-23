export const GENERIC_SUBJECT_TERMS = [
  "涉事方",
  "相关主体",
  "未知",
  "不详",
  "无",
  "空",
  "null",
  "undefined",
  "n/a",
  "市民",
  "车主",
  "商家",
  "商铺",
  "店铺",
  "店主",
  "单位",
  "某单位",
  "某店铺",
  "某商家",
  "某公司",
  "某企业",
  "某工厂",
  "某餐厅",
  "某餐馆",
  "买家",
  "卖家",
  "消费者",
  "顾客",
  "客户",
  "客服",
  "外包客服",
  "平台客服",
  "当事人",
  "反映人",
  "诉求人",
  "投诉人",
  "业主",
  "租客",
  "物业",
  "部门",
  "相关单位",
  "相关部门",
  "涉事单位",
  "涉事店铺",
  "涉事商家",
  "涉事主体",
  "涉事车辆",
  "车辆",
  "司机",
  "小贩",
  "摊贩",
  "咨询市民",
  "催办诉求人",
  "无名",
  "不知名",
] as const;

const GENERIC_SUBJECT_SET = new Set<string>(
  GENERIC_SUBJECT_TERMS.map((t) => t.toLowerCase())
);
const GENERIC_SUBJECT_SUFFIX_RE = /(?:涉事方|责任主体|责任对象)$/;
const GENERIC_SUBJECT_WRAPPER_RE =
  /^(?:某|该|这|那|一)?(?:家|位|个)?(?:我的|涉事|相关)?(?:单位|店铺|商铺|商店|商家|公司|企业|工厂|工地|餐厅|餐馆|饭店|超市|物业|快递|物流|商品|客服|卖家|买家|车主|市民|车辆)$/;

export function isGenericSubject(value?: string | null): boolean {
  const s = (value || "").trim();
  if (!s) return true;
  return (
    GENERIC_SUBJECT_SET.has(s.toLowerCase()) ||
    GENERIC_SUBJECT_SUFFIX_RE.test(s) ||
    GENERIC_SUBJECT_WRAPPER_RE.test(s)
  );
}

export function isTicketResolvedStatus(status?: string | null): boolean {
  const trimmed = (status || "").trim();
  const upper = trimmed.toUpperCase();
  return (
    upper === "RESOLVED" ||
    upper === "FINISHED" ||
    upper === "CLOSED" ||
    trimmed === "已办结" ||
    trimmed === "办结"
  );
}

export function detectMissingTicketSlots(
  ticket: {
    address?: string | null;
    canonicalSubject?: string | null;
    subdistrict?: string | null;
    confidence?: number | null;
  },
  isEcommerce: boolean,
  options?: { includeLowConfidence?: boolean }
): string[] {
  const slots: string[] = [];
  const addr = (ticket.address || "").trim();
  const sub = (ticket.subdistrict || "").trim();
  const subj = (ticket.canonicalSubject || "").trim();

  if (!addr || addr === sub || (isEcommerce && addr.length <= 6)) {
    slots.push(isEcommerce ? "订单号/收货仓网明细" : "具体路名门牌/地点");
  }
  if (!subj || isGenericSubject(subj)) {
    slots.push(isEcommerce ? "涉事SKU/商品名称" : "涉事主体/商铺单位");
  }
  if (!sub) {
    slots.push(isEcommerce ? "渠道/仓网" : "所属镇街");
  }
  if (
    options?.includeLowConfidence &&
    slots.length === 0 &&
    (ticket.confidence == null || ticket.confidence < 70)
  ) {
    slots.push("要素置信度待核验");
  }
  return slots;
}

const SQL_GENERIC_SUBJECT_LIST = GENERIC_SUBJECT_TERMS.map((t) => `'${t}'`).join(", ");

function btrimWsSql(expr: string): string {
  return `btrim(${expr}, E' \\t\\n\\r\\x0b\\x0c\\u3000\\u00a0\\ufeff\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f')`;
}

export function buildMissingInfoSqlParts(tableAlias: string, isEcommerce: boolean) {
  const prefix = tableAlias ? (tableAlias.endsWith(".") ? tableAlias : `${tableAlias}.`) : "";
  const subjCol = `${prefix}canonical_subject`;
  const addrCol = `${prefix}address`;
  const subdCol = `${prefix}subdistrict`;

  const trimmedSubjectSql = btrimWsSql(subjCol);
  const trimmedAddressSql = btrimWsSql(addrCol);
  const trimmedSubdistrictSql = btrimWsSql(subdCol);
  const trimmedCoalescedSubdistrictSql = btrimWsSql(`coalesce(${subdCol}, '')`);

  const genericSubjectSqlExpr = `(${subjCol} IS NULL OR ${trimmedSubjectSql} = '' OR lower(${trimmedSubjectSql}) IN (${SQL_GENERIC_SUBJECT_LIST}) OR ${trimmedSubjectSql} ~ '(?:涉事方|责任主体|责任对象)$' OR ${trimmedSubjectSql} ~ '^(?:某|该|这|那|一)?(?:家|位|个)?(?:我的|涉事|相关)?(?:单位|店铺|商铺|商店|商家|公司|企业|工厂|工地|餐厅|餐馆|饭店|超市|物业|快递|物流|商品|客服|卖家|买家|车主|市民|车辆)$')`;
  const missingAddressExpr = isEcommerce
    ? `(${addrCol} IS NULL OR ${trimmedAddressSql} = '' OR ${trimmedAddressSql} = ${trimmedCoalescedSubdistrictSql} OR char_length(${trimmedAddressSql}) <= 6)`
    : `(${addrCol} IS NULL OR ${trimmedAddressSql} = '' OR ${trimmedAddressSql} = ${trimmedCoalescedSubdistrictSql})`;
  const missingSubdistrictExpr = `(${subdCol} IS NULL OR ${trimmedSubdistrictSql} = '')`;
  const coreMissingExpr = `(${missingAddressExpr} OR ${genericSubjectSqlExpr} OR ${missingSubdistrictExpr})`;

  return {
    genericSubjectSqlExpr,
    missingAddressExpr,
    missingSubdistrictExpr,
    coreMissingExpr,
  };
}

export function buildMissingInfoSqlCondition(
  tableAlias: string,
  isEcommerce: boolean,
  options?: { includeLowConfidence?: boolean }
): string {
  const prefix = tableAlias ? (tableAlias.endsWith(".") ? tableAlias : `${tableAlias}.`) : "";
  const { genericSubjectSqlExpr, missingAddressExpr, missingSubdistrictExpr } =
    buildMissingInfoSqlParts(tableAlias, isEcommerce);
  if (options?.includeLowConfidence) {
    return `(${missingAddressExpr} OR ${genericSubjectSqlExpr} OR ${missingSubdistrictExpr} OR ${prefix}confidence IS NULL OR ${prefix}confidence < 70)`;
  }
  return `(${missingAddressExpr} OR ${genericSubjectSqlExpr} OR ${missingSubdistrictExpr})`;
}

export function buildUnresolvedMissingInfoSql(tableAlias: string, isEcommerce: boolean): string {
  const prefix = tableAlias ? (tableAlias.endsWith(".") ? tableAlias : `${tableAlias}.`) : "";
  const { coreMissingExpr } = buildMissingInfoSqlParts(tableAlias, isEcommerce);
  return `(upper(coalesce(${prefix}status, 'PENDING')) NOT IN ('RESOLVED', 'FINISHED', 'CLOSED') AND ${coreMissingExpr})`;
}
