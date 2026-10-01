/**
 * 12345 政务工单快思考决策引擎数据类型契约
 */

// 1. 国标法定五大诉求行为性质（全国统一，GB/T 33358 规范）
export type CivicIntent =
  | "INQUIRY"       // 纯咨询（秒答，不立案不派单）
  | "COMPLAINT"     // 执法投诉（立案派发承办单位）
  | "SUGGESTION"    // 社情建言（归档建言智库，不考核时限）
  | "REMINDER"      // 催办跟进（挂接原工单，严禁生新单）
  | "COMMENDATION";  // 通报表扬

// 2. 预设基准法定业务分类（支持属地自定义扩展）
export type CivicCategory =
  | "urban_management"   // 城市管理
  | "traffic"            // 交通出行
  | "market_reg"         // 市场监管
  | "environment"        // 生态环境
  | "labor_social"       // 劳动社保
  | "public_safety"      // 公共安全
  | "social_governance"  // 社会治理
  | (string & {});       // 允许属地特色分类扩展（如 port_shipping, exhibition_service 等）

export interface CivicTicketInput {
  title?: string;
  content: string;
  subdistrict?: string;
}

/**
 * 动态属地评估配置项（实现多城市 Schema 分类动态插拔）
 */
export interface CivicEvaluateOptions {
  /** 属地自定义业务大类标准描述字典 (覆盖或扩展默认7大类)，直接读取自 regions.categoryConfigJson */
  categories?: Record<string, string>;
  /** 属地分类英文标识与中文展示名称映射表 */
  categoryNameMap?: Record<string, string>;
  /** 自定义诉求行为性质描述 (通常使用默认国标五大性质) */
  intentCriteria?: Record<CivicIntent, string>;
  /** 自定义紧迫度评级阶梯描述 (通常使用默认四级) */
  urgencyLevels?: string[];
}

export interface CivicSystemOneDecision {
  // 1. 诉求性质判定
  intent: CivicIntent;
  intentProbability: number;

  // 2. 法定业务分类
  category: CivicCategory;
  categoryName: string;
  categoryProbability: number;
  categoryDistribution: Record<string, number>;

  // 3. 紧迫度与 SLA 时限
  urgencyLevel: 0 | 1 | 2 | 3;
  urgencyScore: number; // 连续分值 (0.0 ~ 3.0)
  slaHours: 0 | 2 | 24 | 120 | 360;

  // 4. 涉稳红线安全护栏
  stabilityRisk: boolean;
  stabilityRiskProbability: number;

  // 5. 镇街不在共享权重里。模型固定返回 UNKNOWN，页面上的镇街来自当前城市的字典。
  township: string;
  townshipProbability: number;

  // 6. 本次送进模型的 token 数。正文不再截成 128。
  titleTokenCount: number;
  bodyTokenCount: number;

  // 7. 诉求合理性与缠访识别。规则字段，不参与训练。
  isReasonable: boolean;

  // 6. 多部门权责交叉与踢皮球风险
  crossDepartmentRisk: boolean;

  // 元数据
  adapterUsed: "onnx" | "fallback";
  latencyMs: number;
}

export interface SystemOneConfig {
  preferredMode?: "auto" | "onnx" | "fallback";
  onnxModelDir?: string;
  intraOpNumThreads?: number;
}
