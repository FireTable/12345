/**
 * 12345 政务 PII 敏感要素分类定义
 */
export type CivicPiiCategory =
  | "ID_CARD"         // 二代身份证 (含校验和)
  | "LICENSE_PLATE"   // 中国机动车号牌 (蓝牌/黄牌/绿牌新能源)
  | "PHONE_NUMBER"    // 手机与带区号固话
  | "PRIVATE_ROOM"    // 私密个人房号 (保留外部公共建筑物/园区)
  | "PERSON_NAME";    // 市民姓名与特定称谓

/**
 * 文本敏感要素区间坐标元数据 (Span)
 */
export interface PiiSpan {
  category: CivicPiiCategory;
  start: number;
  end: number;
  value: string;
  score: number; // 置信度分值 (0~1)
}

/**
 * 脱敏执行配置项
 */
export interface AnonymizeOptions {
  /** 允许指定仅脱敏哪些特定类别（默认全部开启） */
  categories?: CivicPiiCategory[];
  /** 跨流程/跨模型节点复用的已有映射表，保持全生命周期 Token 一致 */
  seedKeymap?: Record<string, string>;
  /** 占位符风格，默认 double-curly: {{CATEGORY_N}}，可选 unicode-bracket: ⟦CATEGORY_N⟧ */
  bracketStyle?: "double-curly" | "unicode-bracket";
}

/**
 * 脱敏产出物：包含清洗后文本与会话级还原映射表
 */
export interface AnonymizeResult {
  /** 已完成占位符替换的安全文本（可放行至外部大模型） */
  text: string;
  /** 会话级占位符反向查表字典：{"{{LICENSE_PLATE_1}}": "鄂B 1JQ53"} */
  keymap: Record<string, string>;
  /** 本次检测出的所有敏感实体区间统计 */
  spans: PiiSpan[];
}
