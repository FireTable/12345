import { db } from "../db/client";
import { sql, eq } from "drizzle-orm";
import { ticketsTable, themesTable, ticketThemesTable } from "../db/schema";
import { CIVIC_CATEGORIES } from "../lib/vocabulary";

/**
 * 权威政务 7 大诉求分类规则判定器
 */
function classifyAccurately(title: string, content: string, currentCat: string): { category: string; reason: string } {
  const text = `${title} ${content}`;

  // 1. 劳资社保 (工资、欠薪、社保、医保、公积金、辞退、工伤、劳动合同、经济补偿)
  if (
    /欠薪|拖欠工资|克扣工资|未发工资|追讨工资|发放工资|劳动报酬|加班费|离职补偿|经济补偿金|辞退员工|解除劳动关系|劳动仲裁|工伤认定|社保缴费|医保报销|公积金提取|养老金|生育津贴/.test(text)
  ) {
    return { category: "劳资社保", reason: "命中劳动报酬/社保权益关键词" };
  }

  // 2. 交通出行 (违停、乱停放、堵塞交通、抄牌、红绿灯、交通信号、减速带、公交、收费站、拥堵)
  if (
    /违停|乱停放|违规停放|占道停车|占用车位|堵塞交通|影响车辆通行|交警抄牌|拖车|红绿灯故障|信号灯配时|交通拥堵|加塞|公交线路|公交车不按站|斑马线|减速带|逆行|电子警察|车牌号/.test(text)
  ) {
    return { category: "交通出行", reason: "命中机动车违停/交通组织关键词" };
  }

  // 3. 环保水务 (噪音、油烟、废气、异味、恶臭、排污、黑臭水体、积水内涝、管网堵塞、河涌污染)
  if (
    /噪音扰民|音响喧哗|商业噪音|施工噪音|夜间施工|油烟排放|异味刺鼻|刺激性气味|废气排放|排污口|污水横流|黑臭水体|暴雨积水|内涝排水|下水道堵塞|河涌垃圾|水质发黑/.test(text)
  ) {
    return { category: "环保水务", reason: "命中噪音/排污/水务管网关键词" };
  }

  // 4. 市场监管 (退费、退款、虚假宣传、诱导消费、霸王条款、假冒伪劣、食品安全、过期变质、乱收费、价格欺诈)
  if (
    /退费难|拒绝退款|充值退款|预付卡维权|虚假宣传|货不对板|以次充好|三无产品|假冒伪劣|食品过期|发霉变质|吃出异物|价格欺诈|乱收费|霸王条款|强制消费|预付金|网购纠纷/.test(text)
  ) {
    return { category: "市场监管", reason: "命中消费维权/食品安全/价格监管关键词" };
  }

  // 5. 社区物业 (小区物业、物业管理费、电梯故障、困人、门禁损坏、外墙脱落、顶楼漏水、地下车库、业委会)
  if (
    /小区物业|物业服务差|物业擅自收费|电梯故障|电梯困人|特种设备维保|门禁系统|楼道堆积|外墙渗水|楼顶漏水|地下车库渗水|业委会选举|公共收益|房屋开裂|房屋损坏/.test(text)
  ) {
    return { category: "社区物业", reason: "命中小区物业/电梯维保/建筑渗漏关键词" };
  }

  // 6. 公共安全 (消防通道、安全出口堵塞、消火栓无水、飞线充电、易燃易爆、烟花爆竹、打架斗殴、赌博、电信诈骗)
  if (
    /消防通道占用|安全出口锁闭|消火栓无水|灭火器过期|电动车进楼入户|飞线充电|易燃易爆物品|非法储存烟花|打架斗殴|聚众赌博|网络赌博|电信诈骗|非法传销|治安隐患/.test(text)
  ) {
    return { category: "公共安全", reason: "命中消防安全/治安防范关键词" };
  }

  // 7. 市容城管 (占道经营、流动摊贩、乱摆卖、违章建筑、无证加盖、广告招牌破损、生活垃圾未清运、绿化破坏、路灯不亮、井盖破损)
  if (
    /占道经营|乱摆卖|流动小贩|夜市摆摊|违章建筑|违法建设|无证搭棚|广告招牌隐患|垃圾堆积|垃圾未及时清运|绿化带破坏|市政路灯不亮|井盖破损缺失|市容乱象/.test(text)
  ) {
    return { category: "市容城管", reason: "命中市容秩序/市政设施/违法建设关键词" };
  }

  return { category: currentCat || "市容城管", reason: "沿用原分类" };
}

async function auditAndRefine() {
  console.log("==================================================");
  console.log("🔍 全量工单与 Themes 主题分类深度审查与二次校验");
  console.log("==================================================");

  const allTickets = await db.select().from(ticketsTable);
  console.log(`📥 正在审查 ${allTickets.length} 件工单的分类合理性...`);

  let correctedCount = 0;
  const BATCH = 100;

  for (let i = 0; i < allTickets.length; i += BATCH) {
    const batch = allTickets.slice(i, i + BATCH);

    await Promise.all(batch.map(async (tk) => {
      const { category: accurateCat } = classifyAccurately(tk.title || "", tk.content || "", tk.sourceCategory || "");
      
      if (accurateCat !== tk.sourceCategory) {
        await db.update(ticketsTable)
          .set({ sourceCategory: accurateCat })
          .where(eq(ticketsTable.id, tk.id));
        correctedCount++;
      }
    }));
  }

  console.log(`✅ 工单分类审查完毕：共校正 ${correctedCount} 件存在分类偏差的工单`);

  // 重新对齐所有 Themes 的分类与部门
  console.log("\n🔄 重新对齐所有 Themes 的诉求分类、牵头部门与公文建议...");
  const allThemes = await db.select().from(themesTable);
  let updatedThemes = 0;

  for (const th of allThemes) {
    const linkedTickets = await db.select({
      cat: ticketsTable.sourceCategory,
      town: ticketsTable.subdistrict
    })
    .from(ticketThemesTable)
    .innerJoin(ticketsTable, eq(ticketThemesTable.ticketId, ticketsTable.id))
    .where(eq(ticketThemesTable.themeId, th.id));

    if (linkedTickets.length === 0) continue;

    // 重新统计主导分类
    const catFreq: Record<string, number> = {};
    linkedTickets.forEach(tk => {
      const c = tk.cat || "市容城管";
      catFreq[c] = (catFreq[c] || 0) + 1;
    });

    const dominantCat = Object.entries(catFreq).sort((a, b) => b[1] - a[1])[0][0];
    const dominantTown = th.canonicalLocation || "顺德区";

    // 重新校准部门与处置建议
    let leadDept = "顺德区城市管理和综合执法局";
    let coDepts = `属地${dominantTown}综合行政执法办, 社区居委会`;
    let handlingPath = "现场核实取证 → 联合约谈协调 → 限期责令整改 → 结果复核闭环";

    if (dominantCat === "交通出行") {
      leadDept = "佛山市顺德区公安局交通警察大队";
      coDepts = `属地${dominantTown}交警中队, 交通运输分局`;
      handlingPath = "电子警察抓拍 → 现场巡逻抄牌 → 违停清障拖移 → 道路交通组织优化";
    } else if (dominantCat === "市场监管") {
      leadDept = "顺德区市场监督管理局";
      coDepts = `属地${dominantTown}市场监督管理所, 消费者权益保护委员会`;
      handlingPath = "消费纠纷台账核实 → 约谈商户负责人 → 组织行政调解 → 涉嫌违规依法立案查处";
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

    const actionSuggestion = `建议由【${leadDept}】牵头，联合【${coDepts}】于24小时内赶赴${dominantTown}涉事现场开展实地排查；督促相关责任主体严格落实整改措施，72小时内反馈阶段性办理成效并做好诉求人解释答复。`;

    await db.update(themesTable)
      .set({
        category: dominantCat,
        eventType: dominantCat,
        handlingOwner: leadDept,
        aiSummary: actionSuggestion,
        recommendedAction: actionSuggestion
      })
      .where(eq(themesTable.id, th.id));

    updatedThemes++;
  }

  console.log(`✅ Themes 分类与责任部门对齐完毕：共优化 ${updatedThemes} 个主题`);

  // 打印校正后的 7 大分类分布
  console.log("\n📊 校正后全库 7 大诉求分类统计：");
  const finalCatStats = await db.select({
    category: ticketsTable.sourceCategory,
    count: sql<number>`count(*)::int`,
    pct: sql<string>`round(count(*)::numeric / 13659 * 100, 1) || '%'`
  }).from(ticketsTable).groupBy(ticketsTable.sourceCategory).orderBy(sql`count(*) DESC`);
  console.table(finalCatStats);
}

auditAndRefine().catch(console.error).finally(() => process.exit(0));
