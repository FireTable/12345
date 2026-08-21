import { db } from "../db/client";
import { sql, eq } from "drizzle-orm";
import { ticketsTable, themesTable, ticketThemesTable } from "../db/schema";
import { SHUNDE_TOWNSHIPS } from "../lib/vocabulary";

// 常见停用词与行政区划纯前缀（严禁单独作为微观地点或主体）
const STRIP_PREFIX_REGEX = /^(?:广东省|佛山市|顺德区|顺德|佛山|大良街道|容桂街道|伦教街道|勒流街道|北滘镇|乐从镇|陈村镇|龙江镇|杏坛镇|均安镇|大良街|容桂街|伦教街|勒流街|北滘|乐从|陈村|龙江|杏坛|均安|街道|镇)+/g;

/**
 * 清理提取出干净的微观地点（去除冗余的前缀行政区划及口语废话）
 */
function cleanMicroLocation(rawText: string, town: string): string | null {
  if (!rawText) return null;
  
  // 1. 去除【】、() 等符号、行政区划前缀及口语词
  let text = rawText
    .replace(/【[^】]*】/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^\)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/^.*?致电[：:]\s*/g, " ")
    .replace(/^.*?反映[：:]\s*/g, " ")
    .replace(/^.*?投诉[：:]\s*/g, " ")
    .replace(/^.*?求助[：:]\s*/g, " ")
    .replace(/^.*?咨询[：:]\s*/g, " ")
    .replace(/市民[^\s，。,；;：:]{1,10}[：:]\s*/g, " ")
    .replace(/市民[^\s，。,；;]{1,6}(?:致电|反映|投诉|求助|举报|称)/g, " ")
    .replace(/电表示其是居住在/g, " ")
    .replace(/居民委员会/g, "")
    .replace(/(?:再次反映|反映|投诉|咨询|举报|求助|建议|关于|问题|其在|位于|停放在|开设在|地址[：:]|地点[：:])/g, " ")
    .replace(/广东省/g, "")
    .replace(/佛山市/g, "")
    .replace(/顺德区/g, "")
    .replace(new RegExp(town, "g"), "")
    .replace(new RegExp(town.replace(/街道|镇/, ""), "g"), "")
    .trim();

  // 2. 匹配具体的小区/花园/大厦/广场/工业区/路/街/大道/社区
  const match = text.match(/([^\s，。,；;（()）<>《》【】"'\d：:]{2,10}(?:花园|小区|家园|半岛|名苑|华府|新村|大厦|广场|商场|工业区|工业园|大道|路|街|巷|桥|站|市场|社区|居委|村))/);
  if (match && match[1]) {
    let loc = match[1].replace(/^[在从到于在街号]/, "").trim();
    if (
      loc.length >= 3 &&
      !loc.endsWith("街道") &&
      !loc.endsWith("街道办") &&
      !loc.endsWith("区") &&
      !loc.includes("城管") &&
      !loc.includes("未标明") &&
      !loc.includes("热线") &&
      !loc.includes("根据") &&
      !loc.includes("市场监督") &&
      !loc.includes("房产")
    ) {
      return loc;
    }
  }

  return null;
}

/**
 * 清理提取出干净的企业主体名称
 */
function cleanCompanySubject(rawText: string): string | null {
  if (!rawText) return null;

  // 清洗掉口语前缀
  const cleanedText = rawText
    .replace(/(?:企业名称|商家名称|单位名称|公司名称|预设立企业名称)[：:]\s*/g, "")
    .replace(/[“’”"']/g, "");

  const match = cleanedText.match(/([^\s，。,；;（()）<>《》【】"']{3,25}(?:有限公司|有限责任公司|股份有限公司|塑料厂|五金厂|家具厂|电器厂|门市部|经营部|专卖店|旗舰店|家居|电器|实业|科技|贸易))/);
  if (match && match[1]) {
    let co = match[1]
      .replace(/^.*?[：:号在到于]/, "")
      .replace(/^[0-9一二三四五六七八九十月日\-至到于]+/, "")
      .replace(/^(?:大良|容桂|伦教|勒流|北滘|乐从|陈村|龙江|杏坛|均安)(?:街道|镇)?/, "")
      .replace(/^[，。,；;（(【\[]/, "")
      .replace(/[）)】\]]$/, "")
      .trim();

    // 严谨校验
    if (
      co.length >= 4 &&
      (co.endsWith("有限公司") || co.endsWith("有限责任公司") || co.endsWith("股份有限公司") || co.endsWith("厂") || co.endsWith("门市部") || co.endsWith("经营部") || co.endsWith("旗舰店") || co.endsWith("专卖店")) &&
      !co.includes("购买") &&
      !co.includes("举报") &&
      !co.includes("投诉") &&
      !co.includes("反映") &&
      !co.includes("属于") &&
      !co.includes("水厂") &&
      !co.includes("物业") &&
      !co.startsWith("顺德区") &&
      !co.startsWith("佛山市顺德区")
    ) {
      return co;
    }
  }

  return null;
}

/**
 * 根据类别与工单内容生成极具公文质感的标题
 */
function generateOfficialTitle(
  town: string,
  entityName: string,
  type: "PLATE" | "SUBJECT" | "LOCATION",
  category: string,
  sampleContent: string
): string {
  // 1. 车牌违停
  if (type === "PLATE") {
    return `${town} ${entityName} 车辆多次违规停放影响通行治理`;
  }

  // 2. 企业主体
  if (type === "SUBJECT") {
    if (category === "劳资社保") {
      return `${town} 【${entityName}】 劳动用工报酬与工时争议协调`;
    }
    if (category === "市场监管") {
      return `${town} 【${entityName}】 消费纠纷与售后维权诉求协同督办`;
    }
    if (category === "环保水务") {
      return `${town} 【${entityName}】 工业排污与环境异味核查整治`;
    }
    return `${town} 【${entityName}】 相关诉求协同处置督办`;
  }

  // 3. 微观地点
  const sample = sampleContent || "";
  if (category === "交通出行") {
    if (sample.includes("拥堵") || sample.includes("红绿灯") || sample.includes("信号灯")) {
      return `${town}${entityName}周边交通组织与信号灯配时优化`;
    }
    return `${town}${entityName}周边机动车违停与交通秩序治理`;
  }

  if (category === "环保水务") {
    if (sample.includes("噪音") || sample.includes("喧哗") || sample.includes("音响")) {
      return `${town}${entityName}夜间商业噪音与音响喧哗扰民整治`;
    }
    if (sample.includes("油烟") || sample.includes("异味") || sample.includes("废气")) {
      return `${town}${entityName}餐饮油烟与恶臭异味排放核查`;
    }
    if (sample.includes("积水") || sample.includes("排水") || sample.includes("管网")) {
      return `${town}${entityName}市政排水管网疏通与积水内涝整治`;
    }
    return `${town}${entityName}生态环境保洁与水务管网维护`;
  }

  if (category === "市容城管") {
    if (sample.includes("小贩") || sample.includes("摆摊") || sample.includes("占道")) {
      return `${town}${entityName}周边流动摊贩占道经营与市容秩序整治`;
    }
    if (sample.includes("违建") || sample.includes("加盖")) {
      return `${town}${entityName}违法建设与违章加盖核查整治`;
    }
    if (sample.includes("垃圾")) {
      return `${town}${entityName}生活垃圾清运与环境卫生保洁`;
    }
    return `${town}${entityName}市容环境与市政设施综合整治`;
  }

  if (category === "劳资社保") {
    return `${town}${entityName}用人单位劳动报酬与工时争议调解`;
  }

  if (category === "市场监管") {
    if (sample.includes("退款") || sample.includes("退费")) {
      return `${town}${entityName}商户预付消费退费纠纷调解`;
    }
    return `${town}${entityName}商品质量与商户售后纠纷维权`;
  }

  if (category === "社区物业") {
    if (sample.includes("电梯")) {
      return `${town}${entityName}住宅电梯故障频发与特种设备维保`;
    }
    if (sample.includes("漏水") || sample.includes("渗水")) {
      return `${town}${entityName}楼栋渗水维修与物业管理责任协调`;
    }
    return `${town}${entityName}小区物业服务质量与设施维保协调`;
  }

  if (category === "公共安全") {
    if (sample.includes("消防") || sample.includes("通道")) {
      return `${town}${entityName}消防疏散通道占用与安全隐患排查`;
    }
    return `${town}${entityName}公共安全隐患协同排查整治`;
  }

  return `${town}${entityName}民生诉求集中治理`;
}

async function retitleAndClean() {
  console.log("==================================================");
  console.log("🚀 开始全量 Themes 主题标题公文级重构与文案净化");
  console.log("==================================================");

  const allThemes = await db.select().from(themesTable);
  console.log(`📥 读取到 ${allThemes.length} 个主题`);

  let updatedCount = 0;

  for (const th of allThemes) {
    const linkedTickets = await db.select({
      id: ticketsTable.id,
      ticketNo: ticketsTable.ticketNo,
      title: ticketsTable.title,
      content: ticketsTable.content,
      address: ticketsTable.address,
      town: ticketsTable.subdistrict,
      cat: ticketsTable.sourceCategory
    })
    .from(ticketThemesTable)
    .innerJoin(ticketsTable, eq(ticketThemesTable.ticketId, ticketsTable.id))
    .where(eq(ticketThemesTable.themeId, th.id));

    if (linkedTickets.length === 0) continue;

    const dominantTown = th.canonicalLocation || linkedTickets[0].town || "大良街道";
    const dominantCat = th.category || linkedTickets[0].cat || "市容城管";

    // 尝试提取真正的微观地点或公司主体
    let cleanLoc: string | null = null;
    let cleanCo: string | null = null;
    let plate: string | null = null;

    for (const tk of linkedTickets) {
      const fullText = `${tk.title || ""} ${tk.address || ""} ${tk.content || ""}`;
      
      const pMatch = fullText.match(/粤[A-HJ-NP-Z][0-9A-HJ-NP-Z]{5,6}/);
      if (pMatch && !plate) plate = pMatch[0];

      if (!cleanCo) cleanCo = cleanCompanySubject(fullText);
      if (!cleanLoc) cleanLoc = cleanMicroLocation(fullText, dominantTown);
    }

    let type: "PLATE" | "SUBJECT" | "LOCATION" = "LOCATION";
    let entityName = cleanLoc || "重点片区";

    if (plate) {
      type = "PLATE";
      entityName = plate;
    } else if (cleanCo) {
      type = "SUBJECT";
      entityName = cleanCo;
    } else if (cleanLoc) {
      type = "LOCATION";
      entityName = cleanLoc;
    } else {
      type = "LOCATION";
      entityName = th.canonicalSubject && !th.canonicalSubject.includes("顺德区") ? th.canonicalSubject : "重点片区";
    }

    const sampleContent = linkedTickets.map(t => `${t.title} ${t.content}`).join(" ");
    const elegantTitle = generateOfficialTitle(dominantTown, entityName, type, dominantCat, sampleContent);

    // 牵头与协办部门
    let leadDept = "顺德区城市管理和综合执法局";
    let coDepts = `属地${dominantTown}综合行政执法办, 社区居委会`;
    let handlingPath = "现场核实取证 → 联合约谈协调 → 限期责令整改 → 结果复核闭环";

    if (dominantCat === "交通出行") {
      leadDept = "佛山市顺德区公安局交通警察大队";
      coDepts = `属地${dominantTown}交警中队, 交通运输分局`;
      handlingPath = "电子警察抓拍 → 现场巡逻抄牌 → 违停清障拖移 → 道路交通组织优化";
    } else if (dominantCat === "市场监管") {
      leadDept = "顺德区市场监督管理局";
      coDepts = `属地${dominantTown}市场监督管理所, 消委会`;
      handlingPath = "消费纠纷台账核实 → 约谈商户负责人 → 组织行政调解 → 涉嫌违规立案查处";
    } else if (dominantCat === "劳资社保") {
      leadDept = "顺德区人力资源和社会保障局";
      coDepts = `属地${dominantTown}劳动监察中队, 劳动争议仲裁院`;
      handlingPath = "劳资纠纷应急排查 → 调取用工考勤与工资流水 → 下达限期整改指令书 → 司法仲裁衔接";
    } else if (dominantCat === "环保水务") {
      leadDept = "佛山市生态环境局顺德分局";
      coDepts = `属地${dominantTown}城建和水务办, 综合执法办`;
      handlingPath = "便携设备现场测噪/测气 → 排查排污管网与油烟净化设施 → 责令限期整改 → 定期复测闭环";
    } else if (dominantCat === "社区物业") {
      leadDept = "顺德区住房和城乡建设局";
      coDepts = `属地${dominantTown}城建办, 社区居委会, 物业管理协会`;
      handlingPath = "三方现场协调会 → 督促物业企业落实维保义务 → 动用物业维修基金 → 行业信用评价扣分";
    } else if (dominantCat === "公共安全") {
      leadDept = "佛山市顺德区公安局";
      coDepts = `顺德区消防救援大队, 属地${dominantTown}派出所`;
      handlingPath = "突击安全排查 → 现场清除通道堵塞与火灾隐患 → 责令隐患单位立行立改 → 跟踪回访闭环";
    }

    const actionSuggestion = `建议由【${leadDept}】牵头，联合【${coDepts}】于24小时内赶赴${dominantTown}${entityName}开展专项核查处置；督促相关责任主体严格落实整改措施，72小时内反馈阶段性办理成效并做好诉求人解释答复。`;

    await db.update(themesTable)
      .set({
        title: elegantTitle.slice(0, 250),
        canonicalSubject: entityName.slice(0, 250),
        canonicalLocation: dominantTown,
        handlingOwner: leadDept,
        aiSummary: actionSuggestion,
        recommendedAction: actionSuggestion
      })
      .where(eq(themesTable.id, th.id));

    updatedCount++;
  }

  console.log(`✅ 全量 Themes 标题重构完毕！共精修 ${updatedCount} 个主题`);

  // 查看前 10 个效果
  console.log("\n📋 精修后主题标题前 10 样例展示：");
  const samples = await db.select({
    id: themesTable.id,
    town: themesTable.canonicalLocation,
    cat: themesTable.category,
    title: themesTable.title,
    count: themesTable.ticketCount
  }).from(themesTable).orderBy(sql`ticket_count DESC`).limit(10);
  console.table(samples);
}

retitleAndClean().catch(console.error).finally(() => process.exit(0));
