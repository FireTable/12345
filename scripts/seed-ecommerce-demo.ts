import nextEnvPkg from "@next/env";
const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

import { eq, sql as dsql } from "drizzle-orm";

interface ThemeBlueprint {
  id: string;
  title: string;
  canonicalSubject: string;
  canonicalLocation: string;
  eventType: string;
  category: string;
  riskLevel: "HIGH" | "MEDIUM" | "LOW";
  riskReason: string;
  aiSummary: string;
  recommendedAction: string;
  patternType: string;
  civicMode: string;
  aiConfidence: number;
  handlingStatus: "PENDING" | "IN_PROGRESS" | "RESOLVED";
  handlingProgress: number;
  handlingOwner: string;
  trendPct: number;
  memberTargetCount: number;
  fakeClosureMembers?: number;
  hoursSpan: number;
  startDaysAgo: number;
  urgency: "URGENT" | "MEDIUM" | "NORMAL";
  slaHours: number;
  stabilityRisk: boolean;
  sampleTexts: string[];
}

const CHANNELS = [
  {
    name: "天猫旗舰店",
    aliases: ["天猫店", "旗舰店", "官方旗舰店", "天猫官旗"],
    communities: ["美妆洗护专线", "食品生鲜旗舰组"],
    landmarks: ["天猫客服工作台", "天猫售后仲裁中心"],
    weight: 18,
  },
  {
    name: "抖音直播间",
    aliases: ["大促直播间", "抖音官方直播间", "达人带货直播间", "抖店直播间"],
    communities: ["自播1号间", "达人专场", "夜场秒杀"],
    landmarks: ["抖音电商飞鸽工作台"],
    weight: 19,
  },
  {
    name: "京东自营店",
    aliases: ["京东官方店", "JD自营", "京东旗舰店"],
    communities: ["家电3C自营组", "生鲜自营仓配"],
    landmarks: ["京东售后工单中心"],
    weight: 13,
  },
  {
    name: "拼多多官方店",
    aliases: ["PDD官方店", "多多旗舰店", "百亿补贴店"],
    communities: ["百亿补贴专场", "万人团专场"],
    landmarks: ["拼多多仅退款仲裁组"],
    weight: 13,
  },
  {
    name: "华南冷链仓",
    aliases: ["广州冷链仓", "佛山冷链仓", "顺德生鲜仓", "珠三角前置冷仓"],
    communities: ["A区-18℃冻库", "B区0-4℃保鲜库"],
    landmarks: ["华南冷链质检台"],
    weight: 12,
  },
  {
    name: "华东中心仓",
    aliases: ["上海中心仓", "杭州集散仓", "昆山大仓"],
    communities: ["1号自动分拣线", "大促爆品前置区"],
    landmarks: ["华东仓储履约中心"],
    weight: 10,
  },
  {
    name: "华北分拨仓",
    aliases: ["北京分拨仓", "廊坊仓", "天津物流中心"],
    communities: ["京津冀干线区", "华北退货返修区"],
    landmarks: ["华北中转枢纽"],
    weight: 8,
  },
  {
    name: "跨境保税仓",
    aliases: ["宁波保税仓", "前海保税仓", "香港直邮仓"],
    communities: ["美妆保税区", "母婴进口查验区"],
    landmarks: ["跨境清关售后站"],
    weight: 7,
  },
] as const;

const CATEGORIES = [
  {
    category: "商品质量与破损",
    subItems: ["包装破损", "漏液碎裂", "批次质量异常", "冷链解冻变软"],
    leadDepartment: "品控质检组",
  },
  {
    category: "物流延误与丢件",
    subItems: ["揽收后停滞", "超72小时未更新", "错分丢失", "面单隐私外泄"],
    leadDepartment: "物流履约协同组",
  },
  {
    category: "货不对板与宣传不符",
    subItems: ["直播间夸大功效", "颜色规格错发", "赠品漏发少发"],
    leadDepartment: "店铺运营与选品组",
  },
  {
    category: "退款与价保纠纷",
    subItems: ["大促保价拒退", "退货签收未退款", "定金尾款差价"],
    leadDepartment: "售后价保赔付组",
  },
  {
    category: "假冒伪劣与欺诈",
    subItems: ["防伪码验证失败", "三无贴牌疑似假货", "以次充好"],
    leadDepartment: "法务合规与12315应对组",
  },
  {
    category: "客服推诿与售后超时",
    subItems: ["机器人机械回复", "未解决强行结案", "48h假闭环反弹"],
    leadDepartment: "客服督导组",
  },
  {
    category: "食安与合规红线",
    subItems: ["生鲜腐败发臭", "食后腹泻呕吐", "临期过期产品", "12315/舆情升级"],
    leadDepartment: "法务合规与12315应对组",
  },
] as const;

const DEPARTMENTS = [
  { code: "EC-QC", name: "品控质检组", fullName: "品控质检组", category: "商品质量与破损" },
  { code: "EC-CC", name: "冷链仓储运营组", fullName: "冷链仓储运营组", category: "物流延误与丢件" },
  { code: "EC-LG", name: "物流履约协同组", fullName: "物流履约协同组", category: "物流延误与丢件" },
  { code: "EC-RF", name: "售后价保赔付组", fullName: "售后价保赔付组", category: "退款与价保纠纷" },
  { code: "EC-LW", name: "法务合规与12315应对组", fullName: "法务合规与12315应对组", category: "食安与合规红线" },
  { code: "EC-CS", name: "客服督导组", fullName: "客服督导组", category: "客服推诿与售后超时" },
  { code: "EC-OP", name: "店铺运营与选品组", fullName: "店铺运营与选品组", category: "货不对板与宣传不符" },
] as const;

const ALIAS_SEED = [
  { id: "ECOM-AL-001", alias: "大促直播间", canonical: "抖音直播间", type: "TOWNSHIP" },
  { id: "ECOM-AL-002", alias: "抖音官方直播间", canonical: "抖音直播间", type: "TOWNSHIP" },
  { id: "ECOM-AL-003", alias: "广州冷链仓", canonical: "华南冷链仓", type: "TOWNSHIP" },
  { id: "ECOM-AL-004", alias: "佛山冷链仓", canonical: "华南冷链仓", type: "TOWNSHIP" },
  { id: "ECOM-AL-005", alias: "上海中心仓", canonical: "华东中心仓", type: "TOWNSHIP" },
  { id: "ECOM-AL-006", alias: "北京分拨仓", canonical: "华北分拨仓", type: "TOWNSHIP" },
  { id: "ECOM-AL-007", alias: "宁波保税仓", canonical: "跨境保税仓", type: "TOWNSHIP" },
  { id: "ECOM-AL-008", alias: "天猫官旗", canonical: "天猫旗舰店", type: "TOWNSHIP" },
  { id: "ECOM-AL-009", alias: "JD自营", canonical: "京东自营店", type: "TOWNSHIP" },
  { id: "ECOM-AL-010", alias: "PDD官方店", canonical: "拼多多官方店", type: "TOWNSHIP" },
  { id: "ECOM-AL-011", alias: "百亿补贴店", canonical: "拼多多官方店", type: "TOWNSHIP" },
  { id: "ECOM-AL-012", alias: "机械话术安抚", canonical: "售后敷衍未解决", type: "SUBJECT" },
  { id: "ECOM-AL-013", alias: "消协举报", canonical: "12315市场监管投诉", type: "SUBJECT" },
  { id: "ECOM-AL-014", alias: "黑猫维权", canonical: "社媒舆情曝光风险", type: "SUBJECT" },
  { id: "ECOM-AL-015", alias: "冷链融化", canonical: "冷链温控失效化冻", type: "SUBJECT" },
  { id: "ECOM-AL-016", alias: "顺丰生鲜专线", canonical: "顺丰冷链", type: "DEPARTMENT" },
] as const;

const THEME_BLUEPRINTS: ThemeBlueprint[] = [
  // 亮点案例 1：同批次 SKU 质量爆发（>=28 条，HIGH 预警）
  {
    id: "ECOM-TH-001",
    title: "SKU-GD2026-881 冻干生鲜礼盒冷链化冻变质批次爆发",
    canonicalSubject: "SKU-GD2026-881",
    canonicalLocation: "华南冷链仓",
    eventType: "冷链温控失效导致生鲜批量化冻变质",
    category: "食安与合规红线",
    riskLevel: "HIGH",
    riskReason:
      "72小时内华南冷链仓发出同批次 SKU-GD2026-881 集中爆发 34 起化冻发臭与腹泻投诉，命中食品安全红线并存在微博/小红书扩散风险。",
    aiSummary:
      "华南冷链仓 B区 批次 B2026-11A 干冰配比不足且干线控温波动，致使 SKU-GD2026-881 生鲜礼盒送达时化冻发酸，多名消费者反馈食用后腹泻并扬言向 12315 举报。",
    recommendedAction:
      "1. 立即暂停华南冷链仓 SKU-GD2026-881 同批次待发库存出库；2. 对已签收用户主动发起“仅退款+三倍赔付”回访；3. 法务合规组同步准备质检与冷链温度留痕迎检材料。",
    patternType: "HOTSPOT",
    civicMode: "BATCH_EXPLOSION",
    aiConfidence: 96,
    handlingStatus: "IN_PROGRESS",
    handlingProgress: 60,
    handlingOwner: "冷链仓储运营组",
    trendPct: 245,
    memberTargetCount: 34,
    hoursSpan: 68,
    startDaysAgo: 3,
    urgency: "URGENT",
    slaHours: 2,
    stabilityRisk: true,
    sampleTexts: [
      "在直播间买的 SKU-GD2026-881 生鲜礼盒从华南冷链仓发出，收到时冰袋全化了且有明显酸臭味，家人试吃后轻微腹泻，要求全额退款并按食安法赔付，否则直接打 12315 举报！",
      "华南冷链仓发的 SKU-GD2026-881 到货完全解冻变质了，包装袋都鼓包了，客服一直拖着不处理，再不解决就要去小红书和黑猫投诉曝光这个批次！",
      "订单里的 SKU-GD2026-881 礼盒打开全是化水异味，冰袋都温了，属于同批次生鲜变质问题，请立刻拦截仓内余货并安排赔付。",
    ],
  },
  // 亮点案例 2：假闭环重开案例（48h 内二次投诉威胁 12315，isFakeClosure=true + REOPEN）
  {
    id: "ECOM-TH-002",
    title: "抖音直播间破壁机 SKU-DY2026-309 48h 假闭环复诉升级 12315",
    canonicalSubject: "SKU-DY2026-309",
    canonicalLocation: "抖音直播间",
    eventType: "售后敷衍结案触发48小时假闭环升级12315",
    category: "客服推诿与售后超时",
    riskLevel: "HIGH",
    riskReason:
      "原工单客服仅勾选“已话术安抚”未落实退货退款即强行结案，48小时内 8 名消费者再次进线复诉并已向 12315 / 市场监管部门递交投诉，系统判定售后假闭环自动重开并提级 HIGH。",
    aiSummary:
      "抖音直播间大促爆品破壁机 SKU-DY2026-309 出现电机异响与少发杯盖，部分外包坐席在未核实退款到账前机械关闭工单，引发消费者 48 小时内集中反弹与 12315 举报。",
    recommendedAction:
      "1. 客服督导组接管重开工单，2 小时内人工电话回访兑现补发/极速退款；2. 对前序“已安抚”虚假结案坐席执行质检扣分并拦截自动闭环权限；3. 法务合规组跟进已提单 12315 案件撤诉协调。",
    patternType: "FAKE_CLOSURE",
    civicMode: "FAKE_CLOSURE",
    aiConfidence: 94,
    handlingStatus: "IN_PROGRESS",
    handlingProgress: 40,
    handlingOwner: "客服督导组",
    trendPct: 182,
    memberTargetCount: 14,
    fakeClosureMembers: 8,
    hoursSpan: 52,
    startDaysAgo: 4,
    urgency: "URGENT",
    slaHours: 2,
    stabilityRisk: true,
    sampleTexts: [
      "两天前反映抖音直播间买的破壁机 SKU-DY2026-309 电机异响漏水，客服回复“已安抚”就直接把工单关闭了！现在 48 小时过去退款一分没到，我已经向 12315 提交市场监管举报！",
      "你们售后是不是假闭环？大促直播间下单的 SKU-DY2026-309 根本没给解决就显示已完结，每次进去都是机器人机械回复，再不人工回电就抖音曝光加 12315 投诉到底！",
    ],
  },
  // 亮点案例 3：快递面单/客服聊天记录敏感 PII 脱敏验证
  {
    id: "ECOM-TH-003",
    title: "天猫旗舰店顺丰冷链面单延误丢件与隐私信息核验群诉",
    canonicalSubject: "顺丰冷链-面单专线",
    canonicalLocation: "天猫旗舰店",
    eventType: "物流延误丢件伴随面单隐私信息泄漏风险",
    category: "物流延误与丢件",
    riskLevel: "HIGH",
    riskReason:
      "该案卷多条工单包含消费者完整手机号、真实姓名、收货门牌地址及快递单号，需验证 @civic/anonymizer 写入 masked_content 的可逆脱敏链路。",
    aiSummary:
      "天猫旗舰店大促发出的多笔美妆与礼盒订单在分拣节点滞留超 96 小时或错贴他人面单，消费者在客诉正文直接粘贴了完整收件人手机号、住址和单号要求追回包裹。",
    recommendedAction:
      "1. 所有含手机号与住址的工单先经过可逆 PII 脱敏后进入模型抽取，严禁将明文面单暴露至外网队列；2. 物流履约协同组联同承运商 24 小时内定位滞留件并重发补单。",
    patternType: "MULTI_FREQ",
    civicMode: "NORMAL_CLUSTER",
    aiConfidence: 92,
    handlingStatus: "IN_PROGRESS",
    handlingProgress: 40,
    handlingOwner: "物流履约协同组",
    trendPct: 135,
    memberTargetCount: 18,
    hoursSpan: 96,
    startDaysAgo: 5,
    urgency: "MEDIUM",
    slaHours: 24,
    stabilityRisk: false,
    sampleTexts: [
      "天猫旗舰店订单包裹卡在分拣站 5 天不动，面单上还贴错了别人的信息！",
      "在天猫旗舰店买的护肤套装物流停滞 96 小时疑似丢件，客服让核对面单收件地址却一直没回复！",
    ],
  },
];

// 自动生成 ECOM-TH-004 ~ ECOM-TH-040（合计 40 个主题，覆盖全部 8 渠道与 7 分类，含 PENDING/IN_PROGRESS/RESOLVED）
const EXTRA_THEME_SEEDS: Array<{
  title: string;
  subject: string;
  location: string;
  eventType: string;
  category: string;
  risk: "HIGH" | "MEDIUM" | "LOW";
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED";
  owner: string;
  count: number;
  daysAgo: number;
}> = [
  { title: "SKU-TM2026-104 玻尿酸精华瓶口渗漏破损", subject: "SKU-TM2026-104", location: "天猫旗舰店", eventType: "玻璃滴管运输震荡渗漏破损", category: "商品质量与破损", risk: "MEDIUM", status: "IN_PROGRESS", owner: "品控质检组", count: 22, daysAgo: 6 },
  { title: "京东自营笔记本电脑大促保价差价拒退纠纷", subject: "SKU-JD2026-502", location: "京东自营店", eventType: "7天价保系统判定失效引发差价投诉", category: "退款与价保纠纷", risk: "MEDIUM", status: "IN_PROGRESS", owner: "售后价保赔付组", count: 19, daysAgo: 7 },
  { title: "拼多多官方店蓝牙耳机宣传降噪与实物不符", subject: "SKU-PDD2026-218", location: "拼多多官方店", eventType: "页面宣传主动降噪功能与实物不符", category: "货不对板与宣传不符", risk: "HIGH", status: "PENDING", owner: "店铺运营与选品组", count: 25, daysAgo: 4 },
  { title: "华东中心仓大促包裹积压超72小时未揽收", subject: "华东中心仓发运专线", location: "华东中心仓", eventType: "大促波峰分拣线拥堵导致揽收延误", category: "物流延误与丢件", risk: "MEDIUM", status: "IN_PROGRESS", owner: "物流履约协同组", count: 26, daysAgo: 5 },
  { title: "跨境保税仓进口奶粉防伪码扫码验证异常", subject: "SKU-KJ2026-771", location: "跨境保税仓", eventType: "溯源防伪码校验失败引发假货质疑", category: "假冒伪劣与欺诈", risk: "HIGH", status: "IN_PROGRESS", owner: "法务合规与12315应对组", count: 16, daysAgo: 3 },
  { title: "华北分拨仓冬季羽绒服退换货寄回签收未退款", subject: "华北分拨仓退货组", location: "华北分拨仓", eventType: "退货仓签收超7日未触发自动退款", category: "退款与价保纠纷", risk: "MEDIUM", status: "PENDING", owner: "售后价保赔付组", count: 18, daysAgo: 8 },
  { title: "抖音直播间胶原蛋白饮品临期发货未告知", subject: "SKU-DY2026-412", location: "抖音直播间", eventType: "未标明临期批次引发消费者投诉", category: "食安与合规红线", risk: "HIGH", status: "PENDING", owner: "法务合规与12315应对组", count: 15, daysAgo: 2 },
  { title: "天猫旗舰店空气炸锅烤盘涂层脱落客诉", subject: "SKU-TM2026-615", location: "天猫旗舰店", eventType: "首次高温使用后不粘涂层起泡脱落", category: "商品质量与破损", risk: "MEDIUM", status: "RESOLVED", owner: "品控质检组", count: 14, daysAgo: 12 },
  { title: "京东自营生鲜蓝莓运输挤压发霉烂果投诉", subject: "SKU-JD2026-119", location: "华南冷链仓", eventType: "冷链缓冲不足导致鲜果压烂发霉", category: "食安与合规红线", risk: "HIGH", status: "IN_PROGRESS", owner: "冷链仓储运营组", count: 17, daysAgo: 4 },
  { title: "拼多多官方店纸巾规格克重缩水货不对板", subject: "SKU-PDD2026-089", location: "拼多多官方店", eventType: "实发抽纸张数与详情页标注不符", category: "货不对板与宣传不符", risk: "LOW", status: "RESOLVED", owner: "店铺运营与选品组", count: 21, daysAgo: 15 },
  { title: "华东中心仓玻璃花瓶未缠气泡柱碎裂客诉", subject: "SKU-HD2026-330", location: "华东中心仓", eventType: "易碎品打包规范漏执行导致破损", category: "商品质量与破损", risk: "LOW", status: "RESOLVED", owner: "品控质检组", count: 13, daysAgo: 16 },
  { title: "跨境保税仓香水外盒塑封破损被疑二手", subject: "SKU-KJ2026-904", location: "跨境保税仓", eventType: "查验后二次封箱瑕疵引发假货怀疑", category: "假冒伪劣与欺诈", risk: "MEDIUM", status: "PENDING", owner: "法务合规与12315应对组", count: 11, daysAgo: 5 },
  { title: "天猫旗舰店预售定金膨胀券未抵扣纠纷", subject: "天猫预售促销活动组", location: "天猫旗舰店", eventType: "尾款合并支付优惠券未生效多扣款", category: "退款与价保纠纷", risk: "LOW", status: "RESOLVED", owner: "售后价保赔付组", count: 20, daysAgo: 18 },
  { title: "抖音直播间网红零食袋内发现异物投诉", subject: "SKU-DY2026-990", location: "抖音直播间", eventType: "休闲食品封装带入疑似塑料异物", category: "食安与合规红线", risk: "HIGH", status: "IN_PROGRESS", owner: "法务合规与12315应对组", count: 12, daysAgo: 2 },
  { title: "华北分拨仓干线暴雪预警导致快递停滞", subject: "华北干线承运车队", location: "华北分拨仓", eventType: "干线受阻中转扫描连续4天无更新", category: "物流延误与丢件", risk: "LOW", status: "IN_PROGRESS", owner: "物流履约协同组", count: 16, daysAgo: 9 },
  { title: "京东自营洗地机赠品刷头批量漏发投诉", subject: "SKU-JD2026-805", location: "京东自营店", eventType: "仓配拣货漏扫赠品条码导致少发", category: "货不对板与宣传不符", risk: "LOW", status: "RESOLVED", owner: "店铺运营与选品组", count: 15, daysAgo: 14 },
  { title: "拼多多官方店客服夜间超时未响应自动关单", subject: "夜班外包客服团队", location: "拼多多官方店", eventType: "22点后排队超30分钟机器人强制结案", category: "客服推诿与售后超时", risk: "MEDIUM", status: "PENDING", owner: "客服督导组", count: 19, daysAgo: 6 },
  { title: "华南冷链仓冰淇淋礼盒冰袋不足化水投诉", subject: "SKU-HN2026-205", location: "华南冷链仓", eventType: "干冰克重配置低于夏季阈值", category: "商品质量与破损", risk: "MEDIUM", status: "RESOLVED", owner: "冷链仓储运营组", count: 14, daysAgo: 19 },
  { title: "天猫旗舰店洗面奶批次味道刺鼻质量争议", subject: "SKU-TM2026-512", location: "天猫旗舰店", eventType: "新旧配方切换未公示引发刺激感", category: "商品质量与破损", risk: "LOW", status: "PENDING", owner: "品控质检组", count: 12, daysAgo: 10 },
  { title: "抖音直播间主播口播承诺买一送一未兑现", subject: "抖音达人专场03", location: "抖音直播间", eventType: "直播口播福利口径与后台配置不一致", category: "货不对板与宣传不符", risk: "MEDIUM", status: "IN_PROGRESS", owner: "店铺运营与选品组", count: 23, daysAgo: 5 },
  { title: "跨境保税仓清关身份证核验超时退运纠纷", subject: "跨境清关系统对接", location: "跨境保税仓", eventType: "身份信息异常退运未主动通知退款", category: "物流延误与丢件", risk: "LOW", status: "PENDING", owner: "物流履约协同组", count: 10, daysAgo: 11 },
  { title: "华东中心仓猫粮包装袋划破撒漏投诉", subject: "SKU-HD2026-718", location: "华东中心仓", eventType: "拆箱美工刀误划内袋导致猫粮受潮", category: "商品质量与破损", risk: "LOW", status: "RESOLVED", owner: "品控质检组", count: 13, daysAgo: 20 },
  { title: "京东自营路由器无线断流退货检测扯皮", subject: "SKU-JD2026-640", location: "京东自营店", eventType: "间歇断流质检复现难拒绝7天退货", category: "客服推诿与售后超时", risk: "MEDIUM", status: "IN_PROGRESS", owner: "客服督导组", count: 12, daysAgo: 7 },
  { title: "拼多多官方店低价防晒霜疑似贴牌假货举报", subject: "SKU-PDD2026-995", location: "拼多多官方店", eventType: "批号无法在品牌官网查询疑似仿冒", category: "假冒伪劣与欺诈", risk: "HIGH", status: "PENDING", owner: "法务合规与12315应对组", count: 14, daysAgo: 3 },
  { title: "华北分拨仓加湿器水箱开裂漏水客诉", subject: "SKU-HB2026-142", location: "华北分拨仓", eventType: "冬季低温塑料壳体发脆运输开裂", category: "商品质量与破损", risk: "LOW", status: "PENDING", owner: "品控质检组", count: 11, daysAgo: 13 },
  { title: "天猫旗舰店满减跨店凑单部分退货扣款争议", subject: "天猫满减计算模块", location: "天猫旗舰店", eventType: "分摊优惠退回金额与用户预期偏差", category: "退款与价保纠纷", risk: "LOW", status: "RESOLVED", owner: "售后价保赔付组", count: 16, daysAgo: 22 },
  { title: "抖音直播间羽绒被钻绒严重品质差评潮", subject: "SKU-DY2026-733", location: "抖音直播间", eventType: "内胆防钻绒密织工艺不达标", category: "商品质量与破损", risk: "MEDIUM", status: "IN_PROGRESS", owner: "品控质检组", count: 17, daysAgo: 6 },
  { title: "华南冷链仓冷鲜牛肉真空包装漏气涨袋", subject: "SKU-HN2026-550", location: "华南冷链仓", eventType: "热封机压边不严导致真空失效涨袋", category: "食安与合规红线", risk: "HIGH", status: "IN_PROGRESS", owner: "冷链仓储运营组", count: 13, daysAgo: 4 },
  { title: "京东自营机械键盘轴体失灵以旧换新拖延", subject: "SKU-JD2026-441", location: "京东自营店", eventType: "换新检测周期超过5个工作日引催办", category: "客服推诿与售后超时", risk: "LOW", status: "PENDING", owner: "客服督导组", count: 10, daysAgo: 9 },
  { title: "跨境保税仓膳食补剂标签与中文说明不符", subject: "SKU-KJ2026-312", location: "跨境保税仓", eventType: "中文贴标剂量换算错误引发担忧", category: "货不对板与宣传不符", risk: "MEDIUM", status: "PENDING", owner: "法务合规与12315应对组", count: 11, daysAgo: 7 },
  { title: "华东中心仓同城极速达超时未赔偿运费险", subject: "华东同城闪送专线", location: "华东中心仓", eventType: "承诺当日达延误至次日未自动赔付", category: "退款与价保纠纷", risk: "LOW", status: "RESOLVED", owner: "售后价保赔付组", count: 12, daysAgo: 21 },
  { title: "拼多多官方店儿童玩具边缘毛刺安全隐患", subject: "SKU-PDD2026-604", location: "拼多多官方店", eventType: "注塑水口毛刺划伤手部投诉", category: "商品质量与破损", risk: "MEDIUM", status: "PENDING", owner: "品控质检组", count: 13, daysAgo: 8 },
  { title: "华北分拨仓快递网点代签未投柜丢件", subject: "华北末端驿站代签组", location: "华北分拨仓", eventType: "驿站虚假签收后包裹遗失推诿", category: "物流延误与丢件", risk: "MEDIUM", status: "IN_PROGRESS", owner: "物流履约协同组", count: 14, daysAgo: 5 },
  { title: "天猫旗舰店美妆小样赠品发错色号批量投诉", subject: "天猫小样配赠组", location: "天猫旗舰店", eventType: "拣货位条码混淆发错粉底液小样", category: "货不对板与宣传不符", risk: "LOW", status: "RESOLVED", owner: "店铺运营与选品组", count: 12, daysAgo: 24 },
  { title: "抖音直播间盲盒福袋概率不透明质疑欺诈", subject: "抖音福袋玩法活动", location: "抖音直播间", eventType: "未明示低概率款比例引发投诉", category: "假冒伪劣与欺诈", risk: "MEDIUM", status: "PENDING", owner: "法务合规与12315应对组", count: 11, daysAgo: 10 },
  { title: "华南冷链仓顺丰冷链面单号串号错发他省", subject: "华南冷链分拣贴单组", location: "华南冷链仓", eventType: "高峰波次面单贴错导致生鲜发往异地", category: "物流延误与丢件", risk: "MEDIUM", status: "IN_PROGRESS", owner: "冷链仓储运营组", count: 12, daysAgo: 6 },
  { title: "京东自营保税直采红酒木塞渗液损坏", subject: "SKU-JD2026-918", location: "京东自营店", eventType: "温差剧烈导致瓶塞顶出渗酒", category: "商品质量与破损", risk: "LOW", status: "PENDING", owner: "品控质检组", count: 9, daysAgo: 12 },
];

function buildAllThemes(): ThemeBlueprint[] {
  const extras: ThemeBlueprint[] = EXTRA_THEME_SEEDS.map((item, idx) => {
    const id = `ECOM-TH-${String(idx + 4).padStart(3, "0")}`;
    const progress =
      item.status === "RESOLVED" ? 100 : item.status === "IN_PROGRESS" ? 50 : 0;
    const urgency: "URGENT" | "MEDIUM" | "NORMAL" =
      item.risk === "HIGH" ? "URGENT" : item.risk === "MEDIUM" ? "MEDIUM" : "NORMAL";
    return {
      id,
      title: item.title,
      canonicalSubject: item.subject,
      canonicalLocation: item.location,
      eventType: item.eventType,
      category: item.category,
      riskLevel: item.risk,
      riskReason:
        item.risk === "HIGH"
          ? `${item.location}内「${item.subject}」短期集中出现 ${item.count} 起同类客诉，存在合规红线或口碑放大风险。`
          : `${item.location}「${item.subject}」累计聚合 ${item.count} 起同类客诉，建议${item.owner}按标准 SLA 跟进处置。`,
      aiSummary: `围绕${item.location}的「${item.subject}」产生多起「${item.eventType}」客诉，已自动聚合并路由至${item.owner}。`,
      recommendedAction: `1. ${item.owner}核查${item.subject}在${item.location}的履约与品控记录；2. 对受影响消费者按${item.category}标准给予补偿或退换闭环。`,
      patternType: item.count >= 20 ? "HOTSPOT" : "MULTI_FREQ",
      civicMode: "NORMAL_CLUSTER",
      aiConfidence: 84 + (idx % 12),
      handlingStatus: item.status,
      handlingProgress: progress,
      handlingOwner: item.owner,
      trendPct: item.risk === "HIGH" ? 85 + (idx % 60) : 15 + (idx % 45),
      memberTargetCount: item.count,
      hoursSpan: 24 + (idx % 5) * 18,
      startDaysAgo: item.daysAgo,
      urgency,
      slaHours: item.risk === "HIGH" ? 2 : item.risk === "MEDIUM" ? 24 : 120,
      stabilityRisk: item.risk === "HIGH",
      sampleTexts: [
        `在${item.location}购买的 ${item.subject} 出现${item.eventType}，请尽快核实并安排售后处理！`,
        `反馈${item.location}订单涉及 ${item.subject} 的${item.eventType}问题，已等待处理，麻烦加急跟进。`,
      ],
    };
  });
  return [...THEME_BLUEPRINTS, ...extras];
}

const SURNAMES = ["陈", "林", "张", "李", "王", "黄", "周", "吴", "刘", "赵", "郑", "谢"];
const GIVEN_NAMES = ["敏", "静", "伟", "强", "芳", "磊", "婷", "浩", "雪", "杰", "琳", "宇"];
const SAMPLE_CITIES = [
  "广州市天河区珠江新城花城大道",
  "深圳市南山区科技园深南大道",
  "佛山市顺德区大良街道东康路",
  "上海市浦东新区张江路",
  "杭州市余杭区文一西路",
  "北京市朝阳区建国门外大街",
  "成都市高新区天府大道",
];

// 覆盖全天 24 小时（上海时区分布，午间与晚间直播带货高峰更明显，凌晨仍有自然流量）
const HOUR_WEIGHTS = [
  2, 1, 1, 1, 1, 2, 3, 5, 7, 10, 12, 11,
  9, 10, 11, 10, 9, 10, 11, 13, 16, 17, 14, 7,
];
const HOUR_POOL: number[] = HOUR_WEIGHTS.flatMap((w, h) => Array(w).fill(h));
const CHANNEL_POOL: string[] = CHANNELS.flatMap((c) => Array(c.weight).fill(c.name));

function makeShanghaiDate(daysAgo: number, shanghaiHour: number, minuteOffset: number): Date {
  const now = new Date();
  const baseMs = now.getTime() - daysAgo * 24 * 60 * 60 * 1000;
  const d = new Date(baseMs);
  // 设置为当日对应上海小时（UTC = shanghaiHour - 8）
  const utcDayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), -8, 0, 0, 0);
  const ts = utcDayStart + shanghaiHour * 3600 * 1000 + minuteOffset * 60 * 1000;
  return new Date(Math.min(ts, now.getTime() - 60 * 1000));
}

async function main() {
  const { db: rootDb, sql: rootSql, getRegionDb } = await import("../db/client");
  const {
    aliasesTable,
    disposalLogsTable,
    regionsTable,
    reviewQueueTable,
    themesTable,
    ticketThemesTable,
    ticketsTable,
    vocabulariesTable,
  } = await import("../db/schema");
  const { ECOMMERCE_CS_PROFILE } = await import("../lib/domain-profile");
  const { ensurePublicRegionsTable, registerRegion } = await import("../lib/tenant/schema-manager");
  const { ensureDisposalLogsTable } = await import("../lib/disposal");
  const { anonymize } = await import("@civic/anonymizer");

  console.log("🚀 开始幂等初始化电商示范租户 [ecom_demo] (region_ecom_demo)...");

  // 1. 幂等注册租户（绝不触碰 gz_tianhe 与 fs_shunde）
  const profileConfigJson = JSON.stringify({ domainProfile: ECOMMERCE_CS_PROFILE });
  await ensurePublicRegionsTable(rootSql);
  await registerRegion(rootSql, {
    id: "ecom_demo",
    name: "电商售后客诉中心",
    city: "跨行业示范",
    province: "电商领域",
    schemaName: "region_ecom_demo",
    isDefault: false,
    categoryConfigJson: profileConfigJson,
    description: "全渠道电商售后客诉智能研判、可逆PII脱敏、批次质控与合规红线示范租户",
  });
  await rootDb
    .update(regionsTable)
    .set({
      name: "电商售后客诉中心",
      city: "跨行业示范",
      province: "电商领域",
      isDefault: false,
      status: "ACTIVE",
      categoryConfigJson: profileConfigJson,
    })
    .where(eq(regionsTable.id, "ecom_demo"));
  await ensureDisposalLogsTable("ecom_demo");

  const { db: ecomDb } = await getRegionDb("ecom_demo");

  // 2. 幂等写入词汇表与别名库
  const vocabRows = [
    ...CHANNELS.map((ch, idx) => ({
      id: `ECOM-VOC-CH-${String(idx + 1).padStart(2, "0")}`,
      type: "TOWNSHIP",
      name: ch.name,
      fullName: ch.name,
      parentName: "全渠道营销与仓网体系",
      metaJson: JSON.stringify({
        aliases: [...ch.aliases],
        communities: [...ch.communities],
        landmarks: [...ch.landmarks],
      }),
      description: `电商渠道/仓网节点：${ch.name}`,
      isStandard: true,
    })),
    ...CATEGORIES.map((cat, idx) => ({
      id: `ECOM-VOC-CAT-${String(idx + 1).padStart(2, "0")}`,
      type: "CATEGORY",
      name: cat.category,
      fullName: cat.category,
      parentName: "电商售后分类",
      metaJson: JSON.stringify({
        subItems: [...cat.subItems],
        leadDepartment: cat.leadDepartment,
      }),
      description: `电商客诉大类：${cat.category}`,
      isStandard: true,
    })),
    ...DEPARTMENTS.map((dept, idx) => ({
      id: `ECOM-VOC-DEP-${String(idx + 1).padStart(2, "0")}`,
      type: "DEPARTMENT",
      name: dept.name,
      fullName: dept.fullName,
      parentName: dept.code,
      metaJson: JSON.stringify({ category: dept.category }),
      description: `电商处置团队：${dept.fullName}`,
      isStandard: true,
    })),
  ];
  await ecomDb.insert(vocabulariesTable).values(vocabRows).onConflictDoNothing();

  await ecomDb
    .insert(aliasesTable)
    .values(
      ALIAS_SEED.map((a) => ({
        id: a.id,
        alias: a.alias,
        canonical: a.canonical,
        type: a.type,
        source: "SYSTEM",
        usageCount: 12,
      }))
    )
    .onConflictDoNothing();

  // 3. 构造并幂等写入 >= 35 个主题 + >= 3000 条工单
  const allThemes = buildAllThemes(); // 40 个主题
  const TOTAL_TICKETS = 3240;

  interface SeedTicket {
    id: string;
    ticketNo: string;
    title: string;
    summarizeTitle: string;
    content: string;
    maskedContent: string;
    citizenName: string;
    citizenPhone: string;
    province: string;
    city: string;
    district: string;
    subdistrict: string;
    sourceCategory: string;
    urgency: string;
    slaHours: number;
    stabilityRisk: boolean;
    canonicalSubject: string;
    eventType: string;
    address: string;
    confidence: number;
    primaryThemeId: string | null;
    channel: string;
    status: string;
    createTime: Date;
    closedAt: Date | null;
    closureStatus: string | null;
    isFakeClosure: boolean;
  }

  const ticketsToInsert: SeedTicket[] = [];
  const linksToInsert: Array<{ ticketId: string; themeId: string }> = [];
  const themeRows: Array<typeof themesTable.$inferInsert> = [];

  let ticketSeq = 1;
  const themeDates = new Map<string, { firstAt: Date; lastAt: Date; count: number }>();

  // 3.1 写入属于 40 个主题的成员工单（~600 条）
  for (let tIdx = 0; tIdx < allThemes.length; tIdx++) {
    const bp = allThemes[tIdx];
    let firstAt = new Date();
    let lastAt = new Date(0);

    for (let m = 0; m < bp.memberTargetCount; m++) {
      const id = `ECOM-TK-${String(ticketSeq).padStart(4, "0")}`;
      const ticketNo = `EC2026-${String(ticketSeq).padStart(5, "0")}`;
      const surname = SURNAMES[(ticketSeq + m) % SURNAMES.length];
      const given = GIVEN_NAMES[(ticketSeq * 3 + m) % GIVEN_NAMES.length];
      const rawName = `${surname}${given}`;
      const rawPhone = `13${(ticketSeq % 7) + 3}${String(10000000 + ticketSeq * 7919).slice(0, 8)}`;
      const maskedName = `${surname}*`;
      const maskedPhone = `${rawPhone.slice(0, 3)}****${rawPhone.slice(7)}`;
      const cityRoad = `${SAMPLE_CITIES[(ticketSeq + m) % SAMPLE_CITIES.length]}${10 + (ticketSeq % 180)}号`;
      const expressNo = `SF16${String(1000000000 + ticketSeq * 137).slice(0, 10)}`;

      const hourSlot = HOUR_POOL[(ticketSeq * 7 + m) % HOUR_POOL.length];
      const frac = bp.memberTargetCount > 1 ? m / (bp.memberTargetCount - 1) : 0;
      const daysAgo = Math.max(0.05, bp.startDaysAgo - (frac * bp.hoursSpan) / 24);
      const createTime = makeShanghaiDate(daysAgo, hourSlot, (ticketSeq * 11) % 59);
      if (createTime < firstAt) firstAt = createTime;
      if (createTime > lastAt) lastAt = createTime;

      const baseMsg = bp.sampleTexts[m % bp.sampleTexts.length];
      // 确保重点案例及约 30% 工单携带可逆脱敏所需的 PII（手机号/姓名/地址/快递单号）
      const includePii = bp.id === "ECOM-TH-003" || bp.id === "ECOM-TH-001" || bp.id === "ECOM-TH-002" || ticketSeq % 3 === 0;
      const rawContent = includePii
        ? `${baseMsg} 订单联系人：${rawName}，联系电话 ${rawPhone}，收货地址：${cityRoad}，关联运单号 ${expressNo}。`
        : baseMsg;
      const anon = anonymize(rawContent);

      const isFakeMember =
        bp.id === "ECOM-TH-002" && m < (bp.fakeClosureMembers ?? 0);
      let status: "PENDING" | "IN_PROGRESS" | "RESOLVED" = bp.handlingStatus;
      let closedAt: Date | null = null;
      let closureStatus: string | null = null;
      let isFakeClosure = false;

      if (isFakeMember) {
        status = "IN_PROGRESS";
        closureStatus = "REOPENED";
        isFakeClosure = true;
      } else if (bp.handlingStatus === "RESOLVED") {
        status = "RESOLVED";
        closedAt = new Date(createTime.getTime() + 18 * 3600 * 1000);
        closureStatus = "RESOLVED";
      }

      ticketsToInsert.push({
        id,
        ticketNo,
        title: `${bp.canonicalSubject} ${bp.eventType}`.slice(0, 48),
        summarizeTitle: `${bp.canonicalLocation}·${bp.eventType}`.slice(0, 36),
        content: rawContent,
        maskedContent: anon.text,
        citizenName: maskedName,
        citizenPhone: maskedPhone,
        province: "全渠道",
        city: "电商中心",
        district: bp.canonicalLocation,
        subdistrict: bp.canonicalLocation,
        sourceCategory: bp.category,
        urgency: bp.urgency,
        slaHours: bp.slaHours,
        stabilityRisk: bp.stabilityRisk,
        canonicalSubject: bp.canonicalSubject,
        eventType: bp.eventType,
        address: bp.canonicalLocation,
        confidence: bp.aiConfidence,
        primaryThemeId: bp.id,
        channel: bp.canonicalLocation.includes("仓") ? "仓储品控回流" : bp.canonicalLocation,
        status,
        createTime,
        closedAt,
        closureStatus,
        isFakeClosure,
      });
      linksToInsert.push({ ticketId: id, themeId: bp.id });
      ticketSeq++;
    }

    themeDates.set(bp.id, { firstAt, lastAt, count: bp.memberTargetCount });
    themeRows.push({
      id: bp.id,
      title: bp.title,
      canonicalSubject: bp.canonicalSubject,
      canonicalLocation: bp.canonicalLocation,
      eventType: bp.eventType,
      category: bp.category,
      riskLevel: bp.riskLevel,
      riskReason: bp.riskReason,
      ticketCount: bp.memberTargetCount,
      timeSpanHours: Math.max(1, Math.round((lastAt.getTime() - firstAt.getTime()) / 3600_000)),
      aiSummary: bp.aiSummary,
      recommendedAction: bp.recommendedAction,
      patternType: bp.patternType,
      civicMode: bp.civicMode,
      aiConfidence: bp.aiConfidence,
      firstAt,
      lastAt,
      handlingStatus: bp.handlingStatus,
      handlingProgress: bp.handlingProgress,
      handlingOwner: bp.handlingOwner,
      handlingEta:
        bp.handlingStatus === "PENDING"
          ? null
          : new Date(lastAt.getTime() + 48 * 3600 * 1000),
      trendPct: bp.trendPct,
    });
  }

  // 3.2 写入常规长尾工单至总数 3,240 条（均匀覆盖 24 小时×30天×8渠道×7分类）
  const GENERAL_TEMPLATES = [
    {
      catIdx: 0,
      subjectPrefix: "SKU-EC-10",
      eventType: "外包装压瘪与商品轻微瑕疵",
      text: "收到快递外盒挤压变形，商品边角有轻微划痕，要求换新或补偿优惠券。",
      urgency: "NORMAL" as const,
      slaHours: 120,
      risk: false,
    },
    {
      catIdx: 1,
      subjectPrefix: "物流揽收线-",
      eventType: "跨省干线中转停滞超48小时",
      text: "下单后显示已打包出库但中转站 48 小时未更新轨迹，请核查包裹所在位置。",
      urgency: "MEDIUM" as const,
      slaHours: 24,
      risk: false,
    },
    {
      catIdx: 2,
      subjectPrefix: "活动主推款-",
      eventType: "发错尺码颜色及赠品遗漏",
      text: "下单备注黑色款却发成白色，随单承诺的小样赠品也未随箱发出，申请补寄。",
      urgency: "NORMAL" as const,
      slaHours: 120,
      risk: false,
    },
    {
      catIdx: 3,
      subjectPrefix: "大促保价单-",
      eventType: "买后降价申请保价未及时审核",
      text: "确认收货第3天发现同链接降价40元，申请一键保价提示人工审核一直排队中。",
      urgency: "NORMAL" as const,
      slaHours: 120,
      risk: false,
    },
    {
      catIdx: 4,
      subjectPrefix: "批号核验-",
      eventType: "防伪标签印刷模糊引发正品疑虑",
      text: "外盒防伪涂层扫码识别失败，消费者怀疑非正品授权渠道发货，要求提供进货证明。",
      urgency: "URGENT" as const,
      slaHours: 2,
      risk: true,
    },
    {
      catIdx: 5,
      subjectPrefix: "售后工单-",
      eventType: "客服机械回复未解决实际退换诉求",
      text: "连续两天联系在线客服均回复标准化模板话术，未正面回答退货运费由谁承担。",
      urgency: "MEDIUM" as const,
      slaHours: 24,
      risk: false,
    },
    {
      catIdx: 6,
      subjectPrefix: "生鲜批次-",
      eventType: "冷链保鲜异常导致部分水果软烂",
      text: "收到冷链生鲜包装内有冷凝水，底层两颗果子压坏变软，担心食用安全要求退款。",
      urgency: "URGENT" as const,
      slaHours: 2,
      risk: true,
    },
  ];

  while (ticketSeq <= TOTAL_TICKETS) {
    const idx = ticketSeq;
    const id = `ECOM-TK-${String(idx).padStart(4, "0")}`;
    const ticketNo = `EC2026-${String(idx).padStart(5, "0")}`;
    const channelName = CHANNEL_POOL[idx % CHANNEL_POOL.length];
    const tpl = GENERAL_TEMPLATES[idx % GENERAL_TEMPLATES.length];
    const cat = CATEGORIES[tpl.catIdx];

    const surname = SURNAMES[idx % SURNAMES.length];
    const given = GIVEN_NAMES[(idx * 5) % GIVEN_NAMES.length];
    const rawName = `${surname}${given}`;
    const rawPhone = `13${(idx % 7) + 3}${String(10000000 + idx * 4219).slice(0, 8)}`;
    const maskedName = `${surname}*`;
    const maskedPhone = `${rawPhone.slice(0, 3)}****${rawPhone.slice(7)}`;
    const road = `${SAMPLE_CITIES[idx % SAMPLE_CITIES.length]}${(idx % 200) + 1}号`;

    const hourSlot = HOUR_POOL[idx % HOUR_POOL.length];
    // 近期 3 天密度略高，同时覆盖 0..29 天完整时间线
    const daysAgo = idx % 5 === 0 ? (idx % 3) : (idx % 30);
    const createTime = makeShanghaiDate(daysAgo, hourSlot, (idx * 7) % 59);

    const includePii = idx % 4 === 0;
    const rawContent = includePii
      ? `【${channelName}】${tpl.text} 买家${rawName}，电话 ${rawPhone}，地址 ${road}。`
      : `【${channelName}】${tpl.text}`;
    const maskedContent = includePii ? anonymize(rawContent).text : rawContent;

    const statusRoll = idx % 10;
    const isExtraFakeClosure = idx % 240 === 0; // 少量额外假闭环散单
    let status: "PENDING" | "IN_PROGRESS" | "RESOLVED";
    let closedAt: Date | null = null;
    let closureStatus: string | null = null;
    let isFakeClosure = false;

    if (isExtraFakeClosure) {
      status = "IN_PROGRESS";
      closureStatus = "REOPENED";
      isFakeClosure = true;
    } else if (statusRoll < 4) {
      status = "RESOLVED";
      closedAt = new Date(createTime.getTime() + ((idx % 24) + 2) * 3600 * 1000);
      closureStatus = "RESOLVED";
    } else if (statusRoll < 6) {
      status = "IN_PROGRESS";
    } else {
      status = "PENDING";
    }

    ticketsToInsert.push({
      id,
      ticketNo,
      title: `${channelName}·${tpl.eventType}`.slice(0, 48),
      summarizeTitle: `${channelName} ${tpl.eventType}`.slice(0, 36),
      content: rawContent,
      maskedContent,
      citizenName: maskedName,
      citizenPhone: maskedPhone,
      province: "全渠道",
      city: "电商中心",
      district: channelName,
      subdistrict: channelName,
      sourceCategory: cat.category,
      urgency: tpl.urgency,
      slaHours: tpl.slaHours,
      stabilityRisk: tpl.risk,
      canonicalSubject: `${tpl.subjectPrefix}${String((idx % 28) + 1).padStart(2, "0")}`,
      eventType: tpl.eventType,
      address: channelName,
      confidence: 78 + (idx % 18),
      primaryThemeId: null,
      channel: channelName,
      status,
      createTime,
      closedAt,
      closureStatus,
      isFakeClosure,
    });
    ticketSeq++;
  }

  // 分批幂等插入主题、工单与关联关系
  await ecomDb.insert(themesTable).values(themeRows).onConflictDoNothing();

  const BATCH_SIZE = 400;
  for (let i = 0; i < ticketsToInsert.length; i += BATCH_SIZE) {
    await ecomDb
      .insert(ticketsTable)
      .values(ticketsToInsert.slice(i, i + BATCH_SIZE))
      .onConflictDoNothing();
  }

  for (let i = 0; i < linksToInsert.length; i += BATCH_SIZE) {
    await ecomDb
      .insert(ticketThemesTable)
      .values(linksToInsert.slice(i, i + BATCH_SIZE))
      .onConflictDoNothing();
  }

  // 4. 幂等写入处置日志（含亮点案例 2 完整假闭环重开轨迹）
  const now = Date.now();
  const disposalSeeds: Array<typeof disposalLogsTable.$inferInsert> = [
    {
      id: "ECOM-LOG-001",
      targetType: "THEME",
      targetId: "ECOM-TH-001",
      action: "DISPATCH",
      fromStatus: "PENDING",
      toStatus: "IN_PROGRESS",
      owner: "冷链仓储运营组",
      operator: "admin",
      note: "华南冷链仓批次 B2026-11A 触发质量爆发阈值，派发冷链仓储运营组核查干冰配比。",
      createdAt: new Date(now - 36 * 3600 * 1000),
    },
    {
      id: "ECOM-LOG-002",
      targetType: "THEME",
      targetId: "ECOM-TH-001",
      action: "ESCALATE",
      fromStatus: "IN_PROGRESS",
      toStatus: "IN_PROGRESS",
      owner: "冷链仓储运营组",
      operator: "admin",
      note: "新增多起腹泻与 12315 威胁投诉，提级 HIGH 风险并协同法务合规与12315应对组介入。",
      createdAt: new Date(now - 18 * 3600 * 1000),
    },
    {
      id: "ECOM-LOG-003",
      targetType: "THEME",
      targetId: "ECOM-TH-001",
      action: "ADVANCE",
      fromStatus: "IN_PROGRESS",
      toStatus: "IN_PROGRESS",
      owner: "冷链仓储运营组",
      operator: "admin",
      note: "已锁库拦截余下同批次 SKU-GD2026-881 礼盒 1,240 件，开始批量主动赔付回访。",
      createdAt: new Date(now - 6 * 3600 * 1000),
    },
    {
      id: "ECOM-LOG-004",
      targetType: "THEME",
      targetId: "ECOM-TH-002",
      action: "DISPATCH",
      fromStatus: "PENDING",
      toStatus: "IN_PROGRESS",
      owner: "外包坐席二组",
      operator: "admin",
      note: "派单处理抖音直播间 SKU-DY2026-309 售后咨询。",
      createdAt: new Date(now - 72 * 3600 * 1000),
    },
    {
      id: "ECOM-LOG-005",
      targetType: "THEME",
      targetId: "ECOM-TH-002",
      action: "RESOLVE",
      fromStatus: "IN_PROGRESS",
      toStatus: "RESOLVED",
      owner: "外包坐席二组",
      operator: "cs_agent_07",
      note: "已电话/话术安抚消费者，标记办结（未核验实际退款流水）。",
      createdAt: new Date(now - 56 * 3600 * 1000),
    },
    {
      id: "ECOM-LOG-006",
      targetType: "THEME",
      targetId: "ECOM-TH-002",
      action: "REOPEN",
      fromStatus: "RESOLVED",
      toStatus: "IN_PROGRESS",
      owner: "客服督导组",
      operator: "system",
      note: "48小时假闭环窗内再次收到同类复诉且命中 12315/市监监管举报信号，系统自动重开并提级 HIGH 风险。",
      createdAt: new Date(now - 14 * 3600 * 1000),
    },
    {
      id: "ECOM-LOG-007",
      targetType: "THEME",
      targetId: "ECOM-TH-002",
      action: "ESCALATE",
      fromStatus: "IN_PROGRESS",
      toStatus: "IN_PROGRESS",
      owner: "客服督导组",
      operator: "admin",
      note: "升级客服督导组 + 法务合规组联合督办，要求 2 小时内人工电话回访并落实原路退款。",
      createdAt: new Date(now - 10 * 3600 * 1000),
    },
    {
      id: "ECOM-LOG-008",
      targetType: "THEME",
      targetId: "ECOM-TH-003",
      action: "DISPATCH",
      fromStatus: "PENDING",
      toStatus: "IN_PROGRESS",
      owner: "物流履约协同组",
      operator: "admin",
      note: "启动顺丰冷链面单滞留与异常地址脱敏排查。",
      createdAt: new Date(now - 24 * 3600 * 1000),
    },
  ];
  await ecomDb.insert(disposalLogsTable).values(disposalSeeds).onConflictDoNothing();

  // 5. 幂等写入待复核队列（review_queue）
  const reviewSeeds: Array<typeof reviewQueueTable.$inferInsert> = Array.from(
    { length: 24 },
    (_, i) => {
      const ticketIdx = 600 + i * 17;
      const ticketId = `ECOM-TK-${String(ticketIdx).padStart(4, "0")}`;
      const status = i < 14 ? "PENDING" : i < 20 ? "REVIEWED" : "DISMISSED";
      return {
        id: `ECOM-REV-${String(i + 1).padStart(3, "0")}`,
        ticketId,
        reason:
          i % 3 === 0
            ? "渠道别名命中「大促直播间/广州冷链仓」，需确认规范归属渠道"
            : i % 3 === 1
              ? "低置信度实体抽取（涉事SKU编码识别模糊）"
              : "疑似跨类目复合诉求（退款+货不对板），建议人工校准主分类",
        confidence: 52 + (i % 16),
        status,
        operator: status === "PENDING" ? null : "admin",
        note: status === "PENDING" ? null : "已完成电商实体归属复核",
        reviewedAt: status === "PENDING" ? null : new Date(now - (i + 1) * 3600 * 1000),
      };
    }
  );
  await ecomDb.insert(reviewQueueTable).values(reviewSeeds).onConflictDoNothing();

  // 6. 对齐主题成员数（幂等一致）
  await ecomDb.execute(dsql`
    UPDATE region_ecom_demo.themes t
    SET ticket_count = COALESCE((
      SELECT COUNT(*)::int FROM region_ecom_demo.ticket_themes tt WHERE tt.theme_id = t.id
    ), 0)
  `);

  // 7. 输出校验结果并校验基线租户零改动
  const [ecomStats] = await rootSql<
    Array<{ tickets: number; themes: number; links: number; logs: number; reviews: number }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM region_ecom_demo.tickets) AS tickets,
      (SELECT COUNT(*)::int FROM region_ecom_demo.themes) AS themes,
      (SELECT COUNT(*)::int FROM region_ecom_demo.ticket_themes) AS links,
      (SELECT COUNT(*)::int FROM region_ecom_demo.disposal_logs) AS logs,
      (SELECT COUNT(*)::int FROM region_ecom_demo.review_queue) AS reviews
  `;

  const regionsCheck = await rootSql<
    Array<{ id: string; is_default: boolean; schema_name: string }>
  >`
    SELECT id, is_default, schema_name
    FROM public.regions
    WHERE id IN ('gz_tianhe', 'fs_shunde', 'ecom_demo')
    ORDER BY id
  `;

  console.log("✅ [ecom_demo] 初始化完成：", ecomStats);
  console.log("✅ 租户注册状态：", regionsCheck);

  await rootSql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ seed-ecommerce-demo 执行失败:", err);
  process.exit(1);
});
