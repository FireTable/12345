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
const SQL_WHITESPACE_CHARS =
  "E' \\t\\n\\r\\x0b\\x0c\\u3000\\u00a0\\ufeff\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f'";

function btrimWsSql(expr: string): string {
  return `btrim(${expr}, ${SQL_WHITESPACE_CHARS})`;
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
  const trimmedStatusSql = btrimWsSql(`coalesce(${prefix}status, 'PENDING')`);
  return `(upper(${trimmedStatusSql}) NOT IN ('RESOLVED', 'FINISHED', 'CLOSED', '已办结', '办结') AND ${coreMissingExpr})`;
}

/**
 * 预计算持久化列条件（与 `buildUnresolvedMissingInfoSql` 由 PG BEFORE INSERT/UPDATE 触发器保持 100% 同步）。
 */
export function buildMissingInfoFlagSql(tableAlias = ""): string {
  const prefix = tableAlias ? (tableAlias.endsWith(".") ? tableAlias : `${tableAlias}.`) : "";
  return `${prefix}is_missing_info = true`;
}

/**
 * 识别 PostgreSQL undefined_column (42703) 错误，用于在未跑 0012 迁移的旧库上安全回退到实时表达式。
 */
export function isUndefinedColumnError(err: unknown, columnName?: string): boolean {
  const visited = new Set<unknown>();
  let cur: any = err;
  while (cur && typeof cur === "object" && !visited.has(cur)) {
    visited.add(cur);
    const code = typeof cur.code === "string" ? cur.code : "";
    const msg = typeof cur.message === "string" ? cur.message : "";
    if (code === "42703") {
      if (!columnName) return true;
      if (msg.includes(columnName)) return true;
    }
    cur = cur.cause ?? cur.originalError ?? null;
  }
  return false;
}

/**
 * 返回与本文件 `isTicketResolvedStatus` + `detectMissingTicketSlots` + `buildUnresolvedMissingInfoSql`
 * 100% 等价的 PostgreSQL 函数与触发器函数 DDL，供新租户初始化与迁移复用。
 */
export function buildMissingInfoTriggerFunctionsSql(): string[] {
  return [
    `CREATE OR REPLACE FUNCTION public.compute_ticket_is_missing_info(
  p_status text,
  p_address text,
  p_subdistrict text,
  p_canonical_subject text,
  p_is_ecommerce boolean
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_ws constant text := ${SQL_WHITESPACE_CHARS};
  v_status text;
  v_sub text;
  v_addr text;
  v_subj text;
BEGIN
  v_status := upper(btrim(coalesce(p_status, 'PENDING'), v_ws));
  IF v_status IN ('RESOLVED', 'FINISHED', 'CLOSED', '已办结', '办结') THEN
    RETURN FALSE;
  END IF;

  IF p_subdistrict IS NULL THEN
    RETURN TRUE;
  END IF;
  v_sub := btrim(p_subdistrict, v_ws);
  IF v_sub = '' THEN
    RETURN TRUE;
  END IF;

  IF p_address IS NULL THEN
    RETURN TRUE;
  END IF;
  v_addr := btrim(p_address, v_ws);
  IF v_addr = '' OR v_addr = v_sub OR (coalesce(p_is_ecommerce, false) AND char_length(v_addr) <= 6) THEN
    RETURN TRUE;
  END IF;

  IF p_canonical_subject IS NULL THEN
    RETURN TRUE;
  END IF;
  v_subj := btrim(p_canonical_subject, v_ws);
  IF v_subj = '' THEN
    RETURN TRUE;
  END IF;

  IF lower(v_subj) = ANY (ARRAY[${SQL_GENERIC_SUBJECT_LIST}]) THEN
    RETURN TRUE;
  END IF;

  IF v_subj ~ '(?:涉事方|责任主体|责任对象)$'
     OR v_subj ~ '^(?:某|该|这|那|一)?(?:家|位|个)?(?:我的|涉事|相关)?(?:单位|店铺|商铺|商店|商家|公司|企业|工厂|工地|餐厅|餐馆|饭店|超市|物业|快递|物流|商品|客服|卖家|买家|车主|市民|车辆)$' THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;`,
    `CREATE OR REPLACE FUNCTION public.trg_tickets_sync_missing_info()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_ecommerce boolean := (TG_NARGS > 0 AND lower(coalesce(TG_ARGV[0], 'false')) = 'true');
BEGIN
  NEW.is_missing_info := public.compute_ticket_is_missing_info(
    NEW.status,
    NEW.address,
    NEW.subdistrict,
    NEW.canonical_subject,
    v_is_ecommerce
  );
  RETURN NEW;
END;
$$;`,
  ];
}
