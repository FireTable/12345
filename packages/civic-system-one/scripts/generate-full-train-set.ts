import * as XLSX from "xlsx";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { CivicAnonymizer } from "../../civic-anonymizer/src/index";
import { buildCivicQuestions, buildCivicCriteria } from "../src/presets/criteria";
import type { CivicCategory, CivicIntent } from "../src/types";

async function main() {
  const defaultExcel = path.join(
    os.homedir(),
    "Downloads",
    "政数局资料-顺德区12345热线工单（2025年1月至3月）.xlsx"
  );
  const excelPath = process.env.DATASET_EXCEL_PATH || defaultExcel;

  if (!fs.existsSync(excelPath)) {
    console.error(`❌ 未找到 Excel 文件: ${excelPath}`);
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`🚀 开始处理全量 12.8 万工单，生成 System-One 黄金微调集`);
  console.log(`   源文件路径: ${excelPath}`);
  console.log(`======================================================\n`);

  const t0 = Date.now();
  console.log(`[1/4] 正在加载 Excel 数据表格...`);
  const xlsxModule = (XLSX as any).readFile ? XLSX : ((XLSX as any).default || XLSX);
  const wb = xlsxModule.readFile(excelPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = xlsxModule.utils.sheet_to_json(sheet) as Array<{
    序号?: number;
    工单编号?: string;
    标题?: string;
    内容?: string;
  }>;
  console.log(`   成功读取工单总量: ${rawRows.length} 条 (耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const questions = [
    "What is the citizen's primary intent?",
    "Which civic administrative category does this complaint belong to?",
    "What is the urgency level of this civic request?",
    "Does this ticket involve stability risk or extreme behavior?",
  ];

  const criteria = [
    ["INQUIRY", "COMPLAINT", "SUGGESTION", "REMINDER", "COMMENDATION"],
    [
      "urban_management",
      "traffic",
      "market_reg",
      "environment",
      "labor_social",
      "public_safety",
      "social_governance",
    ],
    ["Level 0", "Level 1", "Level 2", "Level 3"],
    ["YES", "NO"],
  ];

  const categoryStats: Record<string, number> = {
    urban_management: 0,
    traffic: 0,
    market_reg: 0,
    environment: 0,
    labor_social: 0,
    public_safety: 0,
    social_governance: 0,
  };

  const intentStats: Record<string, number> = {
    INQUIRY: 0,
    COMPLAINT: 0,
    SUGGESTION: 0,
    REMINDER: 0,
    COMMENDATION: 0,
  };

  const urgencyStats: Record<string, number> = {
    "Level 0": 0,
    "Level 1": 0,
    "Level 2": 0,
    "Level 3": 0,
  };

  let stabilityCount = 0;
  const processedRecords: any[] = [];

  console.log(`[2/4] 正在执行全量高精度脱敏、六维研判与标注...`);
  const stepTime = Date.now();

  for (let idx = 0; idx < rawRows.length; idx++) {
    const row = rawRows[idx];
    const rawTitle = (row.标题 || "").trim();
    const rawContent = (row.内容 || "").trim();

    if (!rawContent || rawContent.length < 8) continue;

    // 1. 安全气隙脱敏
    const anonymized = CivicAnonymizer.anonymize(rawContent);
    const cleanContent = anonymized.text;
    const fullText = `${rawTitle} ${cleanContent}`.toLowerCase();

    // 2. 意图判定 (CivicIntent)
    let intent: CivicIntent = "COMPLAINT";
    if (
      rawTitle.includes("表扬") ||
      rawTitle.includes("感谢") ||
      rawTitle.includes("致谢") ||
      fullText.includes("特来电表扬") ||
      fullText.includes("特致电表扬") ||
      fullText.includes("特来电感谢") ||
      fullText.includes("态度极佳表扬") ||
      fullText.includes("深表感谢") ||
      fullText.includes("为民办实事") ||
      fullText.includes("工作态度好") ||
      fullText.includes("给予表扬") ||
      fullText.includes("值得点赞")
    ) {
      intent = "COMMENDATION";
    } else if (
      rawTitle.includes("重办") ||
      rawTitle.includes("再办") ||
      rawTitle.includes("催办") ||
      rawTitle.includes("督办") ||
      rawTitle.includes("回访") ||
      rawTitle.includes("再次反映") ||
      fullText.includes("再次反映") ||
      fullText.includes("多次反映未果") ||
      fullText.includes("多次反映无果") ||
      fullText.includes("多次投诉未果") ||
      fullText.includes("多次投诉无果") ||
      fullText.includes("为何一直未处理") ||
      fullText.includes("请求加快进度催促") ||
      fullText.includes("加急催办") ||
      fullText.includes("对处理结果表示不满意") ||
      fullText.includes("问题没有解决") ||
      fullText.includes("问题未解决") ||
      fullText.includes("一直未解决") ||
      fullText.includes("至今未解决") ||
      fullText.includes("至今未处理") ||
      fullText.includes("仍未处理") ||
      fullText.includes("仍未解决")
    ) {
      intent = "REMINDER";
    } else if (
      rawTitle.includes("建议") ||
      rawTitle.includes("建言") ||
      rawTitle.includes("献策") ||
      fullText.includes("合理化建议") ||
      fullText.includes("建言献策") ||
      fullText.includes("建议增设") ||
      fullText.includes("建议将") ||
      fullText.includes("希望能优化") ||
      fullText.includes("希望可以延长") ||
      fullText.includes("希望能延长") ||
      fullText.includes("希望相关部门可以调整") ||
      fullText.includes("能否考虑增加") ||
      fullText.includes("能否增设")
    ) {
      intent = "SUGGESTION";
    } else if (
      (rawTitle.includes("咨询") ||
        rawTitle.includes("预约") ||
        fullText.includes("仅作一般咨询") ||
        fullText.includes("仅做一般咨询") ||
        fullText.includes("仅做一般政策咨询") ||
        fullText.includes("市民咨询") ||
        fullText.includes("现咨询") ||
        fullText.includes("打听一下") ||
        fullText.includes("办理流程") ||
        fullText.includes("所需材料") ||
        fullText.includes("需要什么材料") ||
        fullText.includes("需要什么资料") ||
        fullText.includes("申领条件") ||
        fullText.includes("缴费基数") ||
        fullText.includes("办事网点") ||
        fullText.includes("是否对外开放") ||
        fullText.includes("开放时间") ||
        fullText.includes("请相关部门给予指引") ||
        fullText.includes("希望部门给予指引") ||
        fullText.includes("希望相关部门指引") ||
        fullText.includes("希望部门能给予指引") ||
        fullText.includes("希望部门告知") ||
        fullText.includes("咨询民法典") ||
        fullText.includes("咨询要件") ||
        fullText.includes("咨询流程") ||
        /希望了解[：:，,\s]*(为何|为什么|如何|怎么|何时|办理流程|申领条件|需要什么|是否有调整|最新政策)/.test(fullText) ||
        /请问.*(如何|怎么|何时|是否|哪里|具体流程|什么资料)/.test(fullText)) &&
      !/(要求查处|依法查处|限期整改|要求退款|要求退费|要求赔偿|退一赔三|虚假宣传|货不对板|拖欠工资|欠薪|违章建筑|偷排|偷倒|噪音扰民|占道经营|立案调查|强拆|协助处理系统异常)/.test(fullText)
    ) {
      intent = "INQUIRY";
    } else {
      intent = "COMPLAINT";
    }

    // 3. 业务大类判定 (CivicCategory)
    let category: CivicCategory = "social_governance";

    // (1) 公共安全 (public_safety) - 最高优先级
    if (
      rawTitle.includes("消防") ||
      fullText.includes("消防通道") ||
      fullText.includes("消防车道") ||
      fullText.includes("疏散通道") ||
      fullText.includes("逃生通道") ||
      fullText.includes("消防栓") ||
      fullText.includes("消火栓") ||
      fullText.includes("灭火器材") ||
      fullText.includes("灭火器") ||
      fullText.includes("喷淋设施") ||
      fullText.includes("电动车入户") ||
      fullText.includes("电动自行车在此处充电") ||
      fullText.includes("飞线充电") ||
      fullText.includes("火灾隐患") ||
      fullText.includes("着火隐患") ||
      fullText.includes("烟花爆竹") ||
      fullText.includes("燃气泄漏") ||
      fullText.includes("煤气泄漏") ||
      fullText.includes("黑气瓶") ||
      fullText.includes("液化气瓶") ||
      fullText.includes("危化品") ||
      fullText.includes("易燃易爆") ||
      fullText.includes("随时倒塌") ||
      fullText.includes("房屋倾斜") ||
      fullText.includes("坍塌险情") ||
      fullText.includes("山体滑坡") ||
      fullText.includes("挡土墙开裂") ||
      fullText.includes("高空坠物") ||
      fullText.includes("高空抛物") ||
      fullText.includes("井盖缺失") ||
      fullText.includes("窨井盖") ||
      fullText.includes("深坑无护栏") ||
      fullText.includes("电梯困人") ||
      fullText.includes("电梯急坠") ||
      fullText.includes("涉黄") ||
      fullText.includes("卖淫") ||
      fullText.includes("嫖娼") ||
      fullText.includes("聚众赌博") ||
      fullText.includes("涉赌") ||
      fullText.includes("吸毒") ||
      fullText.includes("贩毒") ||
      fullText.includes("打架斗殴") ||
      fullText.includes("寻衅滋事") ||
      fullText.includes("非法拘禁")
    ) {
      category = "public_safety";
    }
    // (2) 劳资维权与社会保障 (labor_social)
    else if (
      rawTitle.includes("欠薪") ||
      rawTitle.includes("工资") ||
      rawTitle.includes("劳资") ||
      rawTitle.includes("社保") ||
      rawTitle.includes("医保") ||
      rawTitle.includes("工伤") ||
      rawTitle.includes("失业金") ||
      rawTitle.includes("失业保险") ||
      rawTitle.includes("就业") ||
      fullText.includes("拖欠工资") ||
      fullText.includes("不发工资") ||
      fullText.includes("克扣工资") ||
      fullText.includes("追讨工资") ||
      fullText.includes("追回工资") ||
      fullText.includes("加班费") ||
      fullText.includes("劳动合同") ||
      fullText.includes("签合同") ||
      fullText.includes("没签合同") ||
      fullText.includes("补签合同") ||
      fullText.includes("工伤") ||
      fullText.includes("工伤认定") ||
      fullText.includes("工伤赔偿") ||
      fullText.includes("工伤待遇") ||
      fullText.includes("重点群体就业") ||
      fullText.includes("就业认定") ||
      fullText.includes("就业补贴") ||
      fullText.includes("摔伤") ||
      fullText.includes("产假") ||
      fullText.includes("陪产假") ||
      fullText.includes("育儿假") ||
      fullText.includes("奖励假") ||
      fullText.includes("带薪年假") ||
      fullText.includes("带薪休假") ||
      fullText.includes("休假") ||
      fullText.includes("社保断缴") ||
      fullText.includes("未买社保") ||
      fullText.includes("补缴社保") ||
      fullText.includes("清缴社保") ||
      fullText.includes("参保") ||
      fullText.includes("医疗保险") ||
      fullText.includes("失业保险") ||
      fullText.includes("失业金") ||
      fullText.includes("养老保险") ||
      fullText.includes("养老金") ||
      fullText.includes("生育津贴") ||
      fullText.includes("生育保险") ||
      fullText.includes("住房公积金") ||
      fullText.includes("公积金") ||
      fullText.includes("劳动仲裁") ||
      fullText.includes("恶意辞退") ||
      fullText.includes("被辞退") ||
      fullText.includes("解除劳动关系") ||
      fullText.includes("无故开除") ||
      fullText.includes("离职证明") ||
      fullText.includes("办理退休") ||
      fullText.includes("退休证") ||
      fullText.includes("企业职工退休") ||
      fullText.includes("异地就医备案") ||
      fullText.includes("医保报销") ||
      fullText.includes("门诊限额") ||
      fullText.includes("灵活就业社保") ||
      fullText.includes("城乡居民医保") ||
      fullText.includes("跨省转移社保") ||
      fullText.includes("社保卡制卡") ||
      fullText.includes("社保卡激活") ||
      fullText.includes("社保卡") ||
      fullText.includes("失业待遇") ||
      fullText.includes("劳务中介扣款") ||
      fullText.includes("人社局") ||
      fullText.includes("医保局")
    ) {
      category = "labor_social";
    }
    // (3) 市场监管与消费维权 (market_reg) - 优先于普通环境判定，以防"抽油烟机维修/售后"被误当排污
    else if (
      rawTitle.includes("消费") ||
      rawTitle.includes("市监") ||
      rawTitle.includes("工商") ||
      rawTitle.includes("退费") ||
      rawTitle.includes("退款") ||
      rawTitle.includes("发票") ||
      rawTitle.includes("售后") ||
      rawTitle.includes("质保") ||
      rawTitle.includes("保修") ||
      rawTitle.includes("公司注册") ||
      rawTitle.includes("变更登记") ||
      rawTitle.includes("购买") ||
      rawTitle.includes("网购") ||
      rawTitle.includes("餐饮") ||
      rawTitle.includes("饭店") ||
      fullText.includes("退款") ||
      fullText.includes("退费") ||
      fullText.includes("退货") ||
      fullText.includes("换货") ||
      fullText.includes("退定金") ||
      fullText.includes("退押金") ||
      fullText.includes("拒绝退款") ||
      fullText.includes("拒绝退货") ||
      fullText.includes("拒绝退费") ||
      fullText.includes("不予退费") ||
      fullText.includes("不予退款") ||
      fullText.includes("不退款") ||
      fullText.includes("不退费") ||
      fullText.includes("不给退款") ||
      fullText.includes("不给退费") ||
      fullText.includes("不退定金") ||
      fullText.includes("不退押金") ||
      fullText.includes("虚假宣传") ||
      fullText.includes("假冒伪劣") ||
      fullText.includes("假货") ||
      fullText.includes("过期食品") ||
      fullText.includes("发霉变质") ||
      fullText.includes("吃出异物") ||
      fullText.includes("蟑螂") ||
      fullText.includes("苍蝇") ||
      fullText.includes("食品安全") ||
      fullText.includes("食品卫生") ||
      fullText.includes("餐饮店") ||
      fullText.includes("餐馆") ||
      fullText.includes("价格欺诈") ||
      fullText.includes("价格过高") ||
      fullText.includes("乱收费") ||
      fullText.includes("加收费用") ||
      fullText.includes("霸王条款") ||
      fullText.includes("预付卡") ||
      fullText.includes("商家跑路") ||
      fullText.includes("闭店") ||
      fullText.includes("货不对板") ||
      fullText.includes("作弊秤") ||
      fullText.includes("鬼秤") ||
      fullText.includes("缺斤短两") ||
      fullText.includes("短斤少两") ||
      fullText.includes("营业执照") ||
      fullText.includes("一照通行") ||
      fullText.includes("企业核名") ||
      fullText.includes("个体户") ||
      fullText.includes("个体工商户") ||
      fullText.includes("注销公司") ||
      fullText.includes("公司注册") ||
      fullText.includes("外资公司") ||
      fullText.includes("变更登记") ||
      fullText.includes("企业准入") ||
      fullText.includes("市场监督管理") ||
      fullText.includes("市监局") ||
      fullText.includes("市监所") ||
      fullText.includes("消委会") ||
      fullText.includes("消协") ||
      fullText.includes("驾校退款") ||
      fullText.includes("退还科目") ||
      fullText.includes("垄断") ||
      fullText.includes("反垄断") ||
      fullText.includes("不正当竞争") ||
      fullText.includes("拒开发票") ||
      fullText.includes("不开发票") ||
      fullText.includes("不给发票") ||
      fullText.includes("美容院") ||
      fullText.includes("美容针") ||
      fullText.includes("培训机构退费") ||
      fullText.includes("早教退学费") ||
      fullText.includes("健身房退卡") ||
      fullText.includes("开发商虚假宣传") ||
      fullText.includes("购房退定金") ||
      fullText.includes("拼多多") ||
      fullText.includes("京东") ||
      fullText.includes("淘宝") ||
      fullText.includes("天猫") ||
      fullText.includes("抖音平台") ||
      fullText.includes("小红书") ||
      fullText.includes("美团") ||
      fullText.includes("饿了么") ||
      fullText.includes("保修") ||
      fullText.includes("质保") ||
      fullText.includes("售后服务") ||
      fullText.includes("售后") ||
      fullText.includes("商家") ||
      fullText.includes("网购") ||
      fullText.includes("净水器") ||
      fullText.includes("洗碗机") ||
      fullText.includes("热水器") ||
      fullText.includes("燃气灶") ||
      fullText.includes("抽油烟机") ||
      fullText.includes("抽油烟机维修")
    ) {
      category = "market_reg";
    }
    // (4) 生态环境与污染防治 (environment)
    else if (
      rawTitle.includes("环保") ||
      rawTitle.includes("环境") ||
      rawTitle.includes("排污") ||
      rawTitle.includes("异味") ||
      rawTitle.includes("恶臭") ||
      fullText.includes("噪音") ||
      fullText.includes("扰民") ||
      fullText.includes("油烟") ||
      fullText.includes("恶臭") ||
      fullText.includes("废气") ||
      fullText.includes("刺鼻气味") ||
      fullText.includes("刺激性气味") ||
      fullText.includes("异味") ||
      fullText.includes("排污管") ||
      fullText.includes("偷排") ||
      fullText.includes("污水直排") ||
      fullText.includes("黑臭水体") ||
      fullText.includes("河水污染") ||
      fullText.includes("河段污染") ||
      fullText.includes("毒河水") ||
      fullText.includes("死鱼") ||
      fullText.includes("水污染") ||
      fullText.includes("工地扬尘") ||
      fullText.includes("建筑扬尘") ||
      fullText.includes("扬尘") ||
      fullText.includes("粉尘") ||
      fullText.includes("施工打桩") ||
      fullText.includes("酒吧音响") ||
      fullText.includes("商业经营噪声") ||
      fullText.includes("焚烧垃圾") ||
      fullText.includes("光污染")
    ) {
      category = "environment";
    }
    // (5) 交通管控与出行秩序 (traffic)
    else if (
      rawTitle.includes("交警") ||
      rawTitle.includes("停车") ||
      rawTitle.includes("交通") ||
      rawTitle.includes("车管所") ||
      rawTitle.includes("机动车") ||
      rawTitle.includes("车辆") ||
      rawTitle.includes("上牌") ||
      rawTitle.includes("行车") ||
      fullText.includes("车管所") ||
      fullText.includes("机动车注册登记") ||
      fullText.includes("机动车登记") ||
      fullText.includes("新车上牌") ||
      fullText.includes("车辆选号") ||
      fullText.includes("红绿灯") ||
      fullText.includes("交通信号灯") ||
      fullText.includes("绿灯时间") ||
      fullText.includes("黄灯") ||
      fullText.includes("车道") ||
      fullText.includes("违停") ||
      fullText.includes("乱停车") ||
      fullText.includes("机动车乱停放") ||
      fullText.includes("车辆乱停放") ||
      fullText.includes("占道停车") ||
      fullText.includes("占用车位") ||
      fullText.includes("私占停车位") ||
      fullText.includes("霸占车位") ||
      fullText.includes("霸占停车位") ||
      fullText.includes("公共停车位") ||
      fullText.includes("公共车位") ||
      fullText.includes("车位锁") ||
      fullText.includes("地锁") ||
      fullText.includes("违章车辆") ||
      fullText.includes("违章抓拍") ||
      fullText.includes("电子警察") ||
      fullText.includes("泥头车") ||
      fullText.includes("货车超重") ||
      fullText.includes("超载") ||
      fullText.includes("公路治超") ||
      fullText.includes("逆行") ||
      fullText.includes("闯红灯") ||
      fullText.includes("斑马线") ||
      fullText.includes("拥堵") ||
      fullText.includes("堵塞交通") ||
      fullText.includes("阻碍行车") ||
      fullText.includes("阻碍通行") ||
      fullText.includes("公交车") ||
      fullText.includes("路口占道停放") ||
      fullText.includes("调头路口") ||
      fullText.includes("掉头路口") ||
      fullText.includes("减速带") ||
      fullText.includes("驾照") ||
      fullText.includes("扣分") ||
      fullText.includes("年审")
    ) {
      category = "traffic";
    }
    // (6) 城市管理与市容市政 (urban_management)
    else if (
      rawTitle.includes("城管") ||
      rawTitle.includes("市容") ||
      rawTitle.includes("市政") ||
      rawTitle.includes("违建") ||
      rawTitle.includes("占道") ||
      rawTitle.includes("乱摆卖") ||
      rawTitle.includes("摆摊") ||
      fullText.includes("违章建筑") ||
      fullText.includes("违建") ||
      fullText.includes("违法建设") ||
      fullText.includes("彩钢板房") ||
      fullText.includes("大棚") ||
      fullText.includes("占道经营") ||
      fullText.includes("流动摊贩") ||
      fullText.includes("游商") ||
      fullText.includes("走鬼档") ||
      fullText.includes("乱摆卖") ||
      fullText.includes("摆摊") ||
      fullText.includes("店外经营") ||
      fullText.includes("占道堆放") ||
      fullText.includes("堆放杂物") ||
      fullText.includes("生活垃圾未清理") ||
      fullText.includes("垃圾堆积") ||
      fullText.includes("垃圾桶满溢") ||
      fullText.includes("环卫保洁") ||
      fullText.includes("绿化养护") ||
      fullText.includes("树木遮挡") ||
      fullText.includes("下水道堵塞") ||
      fullText.includes("水管爆裂") ||
      fullText.includes("严重漏水") ||
      fullText.includes("停水") ||
      fullText.includes("路面破损") ||
      fullText.includes("人行道破损") ||
      fullText.includes("地砖破损") ||
      fullText.includes("物业管理") ||
      fullText.includes("物业纠纷") ||
      fullText.includes("物业公司")
    ) {
      category = "urban_management";
    }
    // (7) 综合社会治理与公共服务 (social_governance)
    else {
      category = "social_governance";
    }

    // 4. 紧迫度评级 (Urgency)
    let urgency: "Level 0" | "Level 1" | "Level 2" | "Level 3" = "Level 1";
    if (intent === "INQUIRY" || intent === "COMMENDATION" || intent === "SUGGESTION") {
      urgency = "Level 0";
    } else if (
      fullText.includes("电梯困人") ||
      fullText.includes("燃气严重泄漏") ||
      fullText.includes("煤气大量泄漏") ||
      (fullText.includes("路面塌陷") && !/(地砖破损|人行道|路面损坏).*(塌陷)/.test(fullText)) ||
      fullText.includes("突发地陷") ||
      fullText.includes("随时倒塌") ||
      fullText.includes("主干管爆裂") ||
      fullText.includes("水浸入户") ||
      fullText.includes("跳楼") ||
      fullText.includes("自杀") ||
      fullText.includes("自焚")
    ) {
      urgency = "Level 3";
    } else if (
      rawTitle.includes("急") ||
      fullText.includes("消防通道") ||
      fullText.includes("交通瘫痪") ||
      fullText.includes("严重堵塞") ||
      fullText.includes("大面积停水") ||
      fullText.includes("大面积停电") ||
      fullText.includes("夜间施工扰民") ||
      fullText.includes("酒吧音响") ||
      fullText.includes("深夜烧烤") ||
      fullText.includes("大面积恶臭") ||
      fullText.includes("毒河水") ||
      fullText.includes("突发爆裂") ||
      fullText.includes("漏水严重") ||
      fullText.includes("矛盾激化")
    ) {
      urgency = "Level 2";
    }

    // 5. 涉稳极端红线 (Stability Risk)
    const isStability =
      // 极端人身自残/自杀危机
      /(想?跳楼|想?跳桥|想?跳河|想?自杀|寻短见|生无可恋|自残|自焚|割腕|服毒|一起死)/.test(fullText) ||
      // 极端恶性社会威胁
      (/(报复社会|同归于尽|鱼死网破)/.test(fullText) && !/(担心|害怕).*报复社会/.test(fullText)) ||
      // 极端暴力纵火爆炸
      /(点火自焚|泼汽油|带汽油|携带炸药|安放炸弹|放火焚烧)/.test(fullText) ||
      // 群体性非法集会抗议
      /(拉横幅|抬棺|静坐抗议|绝食|下跪维权)/.test(fullText) ||
      // 群体性越级进京上访
      /(集体上访|越级上访|赴省进京|进京上访|组织上访|串联聚集|煽动罢工|号召罢工)/.test(fullText) ||
      // 群体封堵维权
      /((聚众|集体|群体|工人们|业主们).*(堵路|堵门|封堵|围堵))/.test(fullText) ||
      /(围堵(政府|管委会|信访局|街道办))/.test(fullText) ||
      // 明确扬言极端行为
      /((扬言|威胁|声称).*(杀人|拼命|同归于尽|放火|砍人|报复社会|堵路|堵门))/.test(fullText) ||
      /(与人拼命)/.test(fullText) ||
      /(逼得.*(自杀|跳楼|没法活|拼命))/.test(fullText);

    const stabilityRisk = isStability ? "YES" : "NO";

    if (isStability) stabilityCount++;

    categoryStats[category]++;
    intentStats[intent]++;
    urgencyStats[urgency]++;

    processedRecords.push({
      title: rawTitle,
      content: cleanContent,
      state: rawTitle ? `${rawTitle}。${cleanContent}` : cleanContent,
      questions,
      criteria,
      answers: [intent, category, urgency, stabilityRisk],
    });

    if (idx % 20000 === 0 && idx > 0) {
      console.log(`   已高精处理 ${idx} / ${rawRows.length} 条...`);
    }
  }

  console.log(`   全量处理完毕 (耗时: ${((Date.now() - stepTime) / 1000).toFixed(1)}s)`);

  console.log(`\n[3/4] 正在划分训练集 (90%) 与盲测验证集 (10%)...`);
  // 随机乱序打散
  processedRecords.sort(() => Math.random() - 0.5);

  const trainCount = Math.floor(processedRecords.length * 0.9);
  const trainSet = processedRecords.slice(0, trainCount);
  const valSet = processedRecords.slice(trainCount);

  const outDir = path.join(process.cwd(), "packages/civic-system-one/data");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const trainFile = path.join(outDir, "civic_train.jsonl");
  const valFile = path.join(outDir, "civic_val.jsonl");

  fs.writeFileSync(trainFile, trainSet.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  fs.writeFileSync(valFile, valSet.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");

  console.log(`\n======================================================`);
  console.log(`🎉 顺德 12.8 万全量工单高精度微调集生成完毕！`);
  console.log(`   - 训练集 (civic_train.jsonl): ${trainSet.length} 条`);
  console.log(`   - 验证集 (civic_val.jsonl):   ${valSet.length} 条`);
  console.log(`   - 涉稳极端工单识别总量:       ${stabilityCount} 条`);
  console.log(`------------------------------------------------------`);
  console.log(`📊 法定大类覆盖分布:`);
  for (const [k, v] of Object.entries(categoryStats)) {
    console.log(`   - ${k.padEnd(20)}: ${v} 条 (${((v / processedRecords.length) * 100).toFixed(1)}%)`);
  }
  console.log(`------------------------------------------------------`);
  console.log(`🧭 行为性质分布:`);
  for (const [k, v] of Object.entries(intentStats)) {
    console.log(`   - ${k.padEnd(16)}: ${v} 条 (${((v / processedRecords.length) * 100).toFixed(1)}%)`);
  }
  console.log(`------------------------------------------------------`);
  console.log(`⚡ 紧迫度等级分布:`);
  for (const [k, v] of Object.entries(urgencyStats)) {
    console.log(`   - ${k.padEnd(16)}: ${v} 条 (${((v / processedRecords.length) * 100).toFixed(1)}%)`);
  }
  console.log(`======================================================\n`);
}

main().catch(console.error);
