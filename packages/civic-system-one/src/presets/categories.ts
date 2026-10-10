import type { CivicCategory, CivicIntent } from "../types";

export const CATEGORY_NAME_MAP: Record<CivicCategory, string> = {
  urban_management: "城市管理",
  traffic: "交通出行",
  market_reg: "市场监管",
  environment: "生态环境",
  labor_social: "劳动社保",
  public_safety: "公共安全",
  social_governance: "社会治理",
};

export const CIVIC_CATEGORY_CRITERIA: Record<CivicCategory, string> = {
  urban_management:
    "市政供水排污管网破损漏水、市容市貌流动摊贩占道、违建占绿、环卫垃圾清运、住宅小区物业纠纷、电梯维保故障困人",
  traffic:
    "道路交通严重拥堵、机动车违规停放阻碍通行、非机动车乱堆放、公共交通客运公交服务、交通信号灯破损",
  market_reg:
    "消费者退款维权纠纷、虚假宣传与价格欺诈、预付卡健身房退费、商户无证无照经营、食品药品安全与过期变质",
  environment:
    "商业夜间经营音响噪音扰民、建筑工地超时施工打桩噪声、餐饮油烟恶臭排放、工业废气粉尘、河道水体黑臭与偷排",
  labor_social:
    "企业用人单位拖欠工人工资欠薪、解除劳动合同经济补偿纠纷、社保医保缴纳与断缴、工伤认定与劳动争议维权",
  public_safety:
    "住宅单元楼道电动自行车违规私拉飞线充电、安全出口消防通道堆物堵塞占用、易燃易爆危化品安全隐患",
  social_governance:
    "社区邻里日常琐事矛盾、租房房屋中介租赁纠纷、综合信访诉求调解、政务平台与业务办理政策综合咨询",
};

export const CIVIC_INTENT_CRITERIA: Record<CivicIntent, string> = {
  INQUIRY: "纯政策咨询、办事流程查询、证件申领条件等非争端咨询，无需现场执法处理",
  COMPLAINT: "针对具体违法违规行为、噪音侵权、欠薪等侵害事实明确提出的执法查处诉求，要求限期核实整改",
  SUGGESTION: "对城市公共治理、道路交通规划、政务便民举措提出的建言献策与优化建议",
  REMINDER: "对此前已提交但逾期未结的工单进行催办追踪、询问进展，非新发事件",
  COMMENDATION: "对政府部门、执法人员或抢修工人的优质服务表达致谢与通报表扬",
};
