/**
 * 广州市天河区 12345 热线工单真实仿真生成引擎 (10万条)
 * 严格对齐 sample_300.xlsx 结构: [index, ticketNo, title, content]
 * 涵盖天河区全部 21 个街道、真实地标、典型高频城管/交通/市监/环保/劳资/维稳诉求
 *
 * 运行方式: npx tsx scripts/generate-gz-tianhe-tickets.ts
 */

import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

interface SubdistrictDef {
  name: string;
  fullName: string;
  communities: string[];
  roads: string[];
  landmarks: string[];
  commercial: string[];
  issues: string[];
}

const SUBDISTRICTS: SubdistrictDef[] = [
  {
    name: "猎德",
    fullName: "广州市天河区猎德街道",
    communities: ["猎德社区", "华林社区", "利民社区", "广利社区", "誉峰社区", "南雅社区"],
    roads: ["临江大道", "冼村路", "花城大道", "兴盛路", "兴国路", "海风路"],
    landmarks: ["花城广场", "广州大剧院", "广东省博物馆", "周大福金融中心（东塔）", "猎德大桥", "天德广场"],
    commercial: ["兴盛路酒吧街", "天德汇", "IGC天汇广场", "K11周边商圈"],
    issues: ["酒吧夜间外摆噪音扰民", "外卖电动车花城广场步行区违规穿行", "写字楼深夜装修施工噪音", "网约车临江大道违规占道下客"],
  },
  {
    name: "冼村",
    fullName: "广州市天河区冼村街道",
    communities: ["冼村社区", "金城社区", "金园社区", "潭骏社区"],
    roads: ["金穗路", "华夏路", "黄埔大道西", "华强路", "冼村路"],
    landmarks: ["广州国际金融中心（西塔）", "K11购物艺术中心", "高德置地广场", "保利克洛维", "富力盈凯广场"],
    commercial: ["高德置地春广场", "K11地下商街", "冬广场餐饮区"],
    issues: ["CBD高档写字楼中央空调机组低频噪音", "商场地下车库指引不清导致严重拥堵", "餐饮油烟净化器未正常开启异味", "共享单车早高峰堆塞地铁口通道"],
  },
  {
    name: "天河南",
    fullName: "广州市天河区天河南街道",
    communities: ["体育西社区", "天河村社区", "育蕾社区", "广和社区", "天荣社区", "天河南社区"],
    roads: ["体育西路", "天河南一路", "天河南二路", "体育东路", "天荣路", "六运一街", "六运二街", "六运三街"],
    landmarks: ["天河城", "正佳广场", "天环广场", "天河体育中心", "时尚天河地下商场"],
    commercial: ["天河城百货", "正佳极地海洋世界周边商户", "六运小区网红咖啡烘焙街", "天河南步行街"],
    issues: ["六运小区网红餐饮外卖小哥车辆乱停塞道", "天河路商圈共享单车潮汐式严重淤积阻断人行道", "沿街店铺高音喇叭揽客促销扰民", "商场快消品牌退换货消费维权拒绝退款"],
  },
  {
    name: "林和",
    fullName: "广州市天河区林和街道",
    communities: ["林和社区", "德荣社区", "紫荆社区", "润和社区", "雅景社区", "恒安社区"],
    roads: ["天河北路", "林和西路", "林和中路", "林和东路", "广州东站站前路"],
    landmarks: ["广州东站枢纽", "中信广场", "东方宝泰购物广场", "广州市市长大厦", "时代广场"],
    commercial: ["东方宝泰地下永旺商超", "中信广场商铺", "天河北餐饮一条街"],
    issues: ["广州东站出租车候客区黑车拉客揽客", "火车站周边流动摊贩占道售卖劣质充电宝和快餐", "老旧小区加装电梯相邻采光纠纷", "天河北路早晚高峰车辆加塞严重拥堵"],
  },
  {
    name: "石牌",
    fullName: "广州市天河区石牌街道",
    communities: ["石牌村社区", "绿荷社区", "逢源社区", "南大社区", "暨大社区", "华师社区", "金田社区"],
    roads: ["天河路", "中山大道西", "龙口西路", "龙口东路", "石牌西路", "绿荷大街", "朝阳大街"],
    landmarks: ["岗顶百脑汇电脑城", "太平洋数码城", "太古汇", "暨南大学石牌校区", "华南师范大学石牌校区"],
    commercial: ["太古汇精品超市", "百脑汇数码维修店", "石牌村商业步行街"],
    issues: ["岗顶数码城二手电脑手机虚假宣传宰客欺诈", "石牌村城中村出租屋飞线充电及通道违停电动车", "城中村握手楼下水道油污堵塞反水", "高校周边无证烧烤大排档营业至凌晨四点扰民"],
  },
  {
    name: "兴华",
    fullName: "广州市天河区兴华街道",
    communities: ["燕塘社区", "兴华社区", "金燕社区", "苏园社区", "伍仙桥社区"],
    roads: ["广州大道北", "兴华路", "沙太南路", "燕岭路", "牛利岗南街"],
    landmarks: ["燕塘地铁站", "银河烈士陵园", "金燕大厦", "广东有线电视大楼"],
    commercial: ["燕塘农贸综合市场", "广汕路汽配汽修街", "燕岭便民商圈"],
    issues: ["燕塘地铁口早晚高峰流动早餐摊占道油烟熏人", "沙太南路大型物流货车夜间鸣笛噪音严重", "老旧小区排水管网老化雨水倒灌", "汽修厂露天喷漆刺鼻油漆异味扰民"],
  },
  {
    name: "沙河",
    fullName: "广州市天河区沙河街道",
    communities: ["沙河顶社区", "左街社区", "西街社区", "水荫四横路社区"],
    roads: ["先烈东路", "濂泉路", "沙河大街", "水荫路", "水荫四横路"],
    landmarks: ["沙河万佳服装批发市场", "金马服装交易城", "沙河顶地铁站", "广东工业大学沙河校区"],
    commercial: ["濂泉路服装商圈", "万佳二期物流打包站", "沙河大街布匹成衣批发市场"],
    issues: ["濂泉路服装批发市场货车和三轮车占道装卸货交通瘫痪", "服装档口私拉电线大功率熨斗违规用电消防隐患", "批发市场物流拉包工拖车撞击路人纠纷", "快递包装纸箱编织袋随地丢弃破坏市容"],
  },
  {
    name: "五山",
    fullName: "广州市天河区五山街道",
    communities: ["华工社区", "华农社区", "农科院社区", "岳洲社区", "茶山社区"],
    roads: ["五山路", "岳洲路", "茶山路", "瘦狗岭路", "广园快速路五山段"],
    landmarks: ["华南理工大学（五山校区）", "华南农业大学", "广东省农业科学院", "五山地铁站"],
    commercial: ["岳洲路高校学生美食街", "五山便民菜市场", "农科院茶叶研究所门市部"],
    issues: ["岳洲路学生街宵夜档油烟直排居民楼窗户", "广园快速路隔音屏破损车辆轮胎噪音超标", "高校外卖柜爆满外卖餐品随地乱放卫生差", "校园周边流动水果捞和炸串无食品安全经营许可"],
  },
  {
    name: "员村",
    fullName: "广州市天河区员村街道",
    communities: ["新街社区", "二横路社区", "三横路社区", "四横路社区", "娟麻社区"],
    roads: ["黄埔大道中", "员村二横路", "员村三横路", "员村南街", "临江大道东延段"],
    landmarks: ["美林M·LIVE天地（山姆会员店）", "员村工人文化宫", "红专厂创意园旧址", "天河区中医医院"],
    commercial: ["美林天地商圈", "员村二横路美食街", "娟麻老厂区便利市场"],
    issues: ["美林天地周末山姆会员店进库车队严重回堵黄埔大道", "老旧绢麻纺织厂宿舍区自来水水压偏低影响做饭", "沿街大排档占用盲道摆放桌椅营业", "黄埔大道辅道夜间渣土泥头车超速行驶扬尘"],
  },
  {
    name: "车陂",
    fullName: "广州市天河区车陂街道",
    communities: ["车陂北社区", "车陂南社区", "东岸社区", "西华社区", "广氮社区"],
    roads: ["中山大道中", "车陂路", "黄埔大道东", "广氮北环路", "车陂大马路"],
    landmarks: ["车陂大厦", "车陂南地铁站", "车陂公园", "广氮花园", "天河城东圃店周边"],
    commercial: ["车陂大马路商业街", "广氮新村便民肉菜市场", "车陂生活广场"],
    issues: ["车陂涌河道周边散发轻微黑臭异味", "车陂北街握手楼群快递三轮车违规充电入户", "城中村私人房东随意加收电费水费超出公摊标准", "广氮花园高空抛物烟头及垃圾袋威胁行人安全"],
  },
  {
    name: "棠下",
    fullName: "广州市天河区棠下街道",
    communities: ["棠下村第一社区", "棠下村第二社区", "棠东社区", "祥龙社区", "丰乐社区"],
    roads: ["中山大道西", "科韵路", "科韵北路", "棠德南路", "棠下涌边路", "棠东丰乐路"],
    landmarks: ["天河软件园棠下园区", "科韵路信息港", "棠东地铁站", "棠下涌生态景观带", "天河区人民法院"],
    commercial: ["科韵路IT白领快餐商圈", "棠东便民商业街", "棠下广式宵夜夜市"],
    issues: ["科韵路信息港某中小型互联网游戏公司拖欠技术研发人员年终奖与离职补偿", "棠下村城中村早高峰BRT过街天桥拥堵挤压", "棠下涌沿线餐饮商户私设暗管排放含油污水", "出租屋二房东擅自克扣租客退租押金不退"],
  },
  {
    name: "天园",
    fullName: "广州市天河区天园街道",
    communities: ["东方社区", "翠湖社区", "文华社区", "穗东社区", "东城社区"],
    roads: ["天府路", "黄埔大道中", "东方一路", "东方二路", "中山大道西天园段"],
    landmarks: ["天河公园", "天河区人民政府", "天河区政务服务中心", "翠湖山庄", "华港商务大厦"],
    commercial: ["华景新城商业中心", "东方一路生活便利街", "天河公园西门餐饮街"],
    issues: ["天河公园早晨六点广场舞音响音量过大干扰高三考生", "翠湖社区地下车库水管老化渗水滴蚀私家车漆面", "天府路天河区政务中心办事停车位紧张引发乱停堵路", "小区物业擅自将公共绿地改建为收费停车位"],
  },
  {
    name: "元岗",
    fullName: "广州市天河区元岗街道",
    communities: ["元岗社区", "南兴社区", "天河客运站社区"],
    roads: ["元岗路", "元岗横路", "下元岗东街", "天源路", "沙太路元岗段"],
    landmarks: ["天河客运站枢纽", "元岗汽配城", "智汇PARK创意园", "远洋天骄广场"],
    commercial: ["天河客运站地下商街", "元岗汽配城五金机电街", "智汇PARK青年餐饮街区"],
    issues: ["天河客运站出站口非法拉客非法营运黑车聚集", "元岗汽配城商户占用消防通道堆放轮胎废旧钢材", "智汇PARK创意园夜间民谣餐吧低音炮震动扰民", "天源路主干道路面因重型工程车碾压出现大面积坑洼"],
  },
  {
    name: "长兴",
    fullName: "广州市天河区长兴街道",
    communities: ["长湴社区", "长兴社区", "兴科社区", "科艺社区"],
    roads: ["长兴路", "天源路长兴段", "兴科路", "长湴西大街", "长湴工业区路"],
    landmarks: ["华南国家植物园", "长湴公园", "天河儿童公园", "植物园地铁站"],
    commercial: ["长湴商业步行街", "华南植物园正门旅游特产超市", "长兴优品生活广场"],
    issues: ["华南国家植物园周末客流高峰长兴路社会车辆占道违停导致交通大瘫痪", "长湴工业区某制衣加工小作坊未按规定与工人签订劳动合同", "长湴村城中村自建房外立面空调外机冷凝水滴水扰民", "天源路夜间大型土方车未覆盖篷布遗撒泥土污染路面"],
  },
  {
    name: "龙洞",
    fullName: "广州市天河区龙洞街道",
    communities: ["龙洞第一社区", "龙洞第二社区", "龙洞第三社区", "中南社区"],
    roads: ["龙洞东街", "迎龙路", "富民路", "天源路龙洞段", "广汕一路"],
    landmarks: ["龙眼洞森林公园", "龙洞商业步行街", "广东工业大学（龙洞校区）", "广东金融学院"],
    commercial: ["龙洞步行街学生夜市", "龙洞新一派购物广场", "迎龙路高校文具数码街"],
    issues: ["龙洞商业步行街夜间大排档烧烤油烟直排及高声划拳至凌晨两点", "广东金融学院北门外共享电动单车违规扎堆乱放阻碍人行道", "龙眼洞森林公园入口周边小商贩无证销售假劣香纸烟花", "城中村小巷道夜间路灯长期故障昏暗存在治安死角"],
  },
  {
    name: "凤凰",
    fullName: "广州市天河区凤凰街道",
    communities: ["柯木塱社区", "渔沙坦社区", "凤凰社区"],
    roads: ["广汕二路", "华美路", "柯木塱南路", "渔沙坦凤凰大街", "蓝宝路"],
    landmarks: ["天河湿地公园", "凤凰山森林公园", "柯木塱地铁站", "华美英语实验学校"],
    commercial: ["柯木塱农贸市场", "渔沙坦生活广场", "广汕路花卉苗木基地"],
    issues: ["广汕二路货运主通道渣土车车速过快扬尘噪音严重", "柯木塱村内多处私搭乱建简易铁皮棚占用公共通道", "天河湿地公园周末露营游客遗留大量塑料快餐盒垃圾", "渔沙坦村个别农庄私自屠宰活禽污水直排农渠"],
  },
  {
    name: "新塘",
    fullName: "广州市天河区新塘街道",
    communities: ["新塘社区", "迎新社区", "沐陂社区", "凌塘社区"],
    roads: ["高唐路", "新科路", "沐陂东路", "凌塘新村大街", "华观路"],
    landmarks: ["天河智慧城核心区", "网易广州总部大楼", "小鹏汽车全球总部", "万科广场（天河智慧城店）"],
    commercial: ["万科广场餐饮中心", "智慧城员工生活街区", "沐陂便利街"],
    issues: ["天河智慧城高唐路某科技外包公司拖欠劳务派遣人员薪资并拒绝支付加班费", "华观路市政道路施工围蔽已超期半年仍未完工导致堵车", "凌塘村城中村出租屋聚居区宽带网络被黑中介垄断强行高价收费", "小鹏汽车总部周边园区晚高峰网约车违停候客阻碍班车通行"],
  },
  {
    name: "珠吉",
    fullName: "广州市天河区珠吉街道",
    communities: ["吉山社区", "珠村南社区", "珠村北社区", "安厦社区"],
    roads: ["珠吉路", "吉山大马路", "广园快速路吉山段", "珠村大马路", "橄榄公园路"],
    landmarks: ["珠村乞巧文化苑", "吉山汽车城", "天河儿童公园东区", "珠吉商业街"],
    commercial: ["吉山汽配市场", "珠村商业广场", "安厦花园便民市场"],
    issues: ["广园快速路吉山立交匝道破损大坑洞导致过往车辆爆胎受损", "吉山汽车城二手车商违规占用公共市政人行道泊车展示", "珠村城中村传统龙舟训练基地周边夜间垃圾清理不及时恶臭", "老旧安厦安居房小区电梯频繁关人下坠安全隐患"],
  },
  {
    name: "黄村",
    fullName: "广州市天河区黄村街道",
    communities: ["黄村社区", "大观社区", "天雅社区", "庙元社区"],
    roads: ["奥体南路", "大观南路", "黄村西路", "环场路", "广园快速路黄村段"],
    landmarks: ["广东奥林匹克体育中心", "黄村地铁站", "高德汇（奥体店）", "优托邦奥体旗舰店"],
    commercial: ["高德汇购物中心", "优托邦儿童游乐城", "奥体美食广场"],
    issues: ["奥体中心举办大型演唱会期间黄牛兜售假票扰乱秩序", "演唱会散场时周边网约车不打表漫天要价一口价宰客", "大观南路人行过街天桥无障碍电梯长期断电损坏停运", "奥体南路家具城商铺商品存在甲醛超标退货维权纠纷"],
  },
  {
    name: "前进",
    fullName: "广州市天河区前进街道",
    communities: ["石溪社区", "前隆社区", "羊城社区", "桃园社区"],
    roads: ["东圃大马路", "中山大道中前进段", "汇彩路", "桃园西路", "临江大道东延前进段"],
    landmarks: ["东圃大马路商业街", "天河城百货（东圃店）", "东圃地铁站", "广州国际金融城东区二期工地"],
    commercial: ["东圃天河城", "四季时尚荟", "汇彩便民生活城"],
    issues: ["东圃大马路商业街步行街人车混行三轮车横冲直撞险象环生", "国际金融城东区建筑施工工地夜间打桩浇筑泥浆连续施工扰民", "东圃地铁口早高峰黑摩的非法载客聚集招揽乘客阻挡出站口", "天河城百货某连锁健身会所突然闭店失联数百会员储值卡无法退款"],
  },
  {
    name: "沙东",
    fullName: "广州市天河区沙东街道",
    communities: ["天平架社区", "陶庄社区", "范岭社区"],
    roads: ["广州大道北沙东段", "沙东大街", "陶庄路", "天平架横街", "先烈东横路"],
    landmarks: ["天平架地铁站", "沙东有利服装批发市场", "天平架装饰材料城", "陶庄科技园"],
    commercial: ["沙东有利南塔服装城", "天平架建材家居博览中心", "陶庄餐饮生活街"],
    issues: ["天平架装饰材料城货运大货车白天高峰期违规占道装卸瓷砖水泥", "沙东有利服装市场快递收发点大量包装垃圾废弃物阻断盲道", "广州大道北沙东段早高峰天桥下大量流动电动车贩卖早点热油烫伤隐患", "陶庄老旧工业改建公寓隔音极差且私改排污管道反涌恶臭"],
  },
];

// 核心诉求情境与模版模板库 (覆盖7大业务领域与维稳风险)
const TEMPLATES = [
  // 1. 城市管理 (市容、违建、占道、垃圾、单车)
  {
    category: "城市管理",
    titlePrefix: "（城管）",
    urgentChance: 0.15,
    stabilityChance: 0.02,
    titles: [
      "商业噪音扰民",
      "流动摊贩违规占道经营",
      "共享单车堆积阻断人行道",
      "生活垃圾堆放恶臭不及时清运",
      "私搭乱建违章建筑投诉",
      "市政路面破损井盖下陷异响",
      "商铺广告牌违规悬挂存在脱落隐患",
      "占道堆放建筑废料阻碍交通",
    ],
    generate: (sub: SubdistrictDef, dateStr: string, timeStr: string, rng: () => number) => {
      const road = pick(sub.roads, rng);
      const landmark = pick(sub.landmarks, rng);
      const community = pick(sub.communities, rng);
      const comm = pick(sub.commercial, rng);
      const variants = [
        `市民致电反映天河区${sub.name}街道${community}${road}附近（靠近${landmark}），在${dateStr} ${timeStr}，有多家沿街商铺使用大功率音响高分贝循环播放促销广告，声音刺耳极其扰民，严重影响周边居民及老人小孩正常起居休息。市民曾向商家交涉无果，现希望城管综合行政执法队尽快到场介入核实，责令商户立即调低音量或停止使用扬声设备。（市民方便接听部门电话）`,
        `诉求人反映天河区${sub.name}街道${road}与${comm}交汇路口，近期每晚21:00至次日凌晨02:30，长期存在多达二十余档无证流动流动摊贩（主要经营铁板烧、烧烤炸串、热卤），不仅油烟弥漫呛人，而且餐桌板凳直接霸占整条人行盲道和非机动车道，导致下班归家行人被逼走机动车道，险象环生。诉求人要求城管执法部门重拳整治，建立常态化巡查机制，还路于民。`,
        `市民致电反映天河区${sub.name}街道${landmark}周边及${road}地铁站出入口处，在${dateStr}早高峰期间，各品牌共享单车（美团、哈啰、青桔）无序严重过量投放，堆积如山甚至蔓延至行车道与盲道，造成市民进出地铁极为不便，存在严重踩踏和交通拥堵隐患。市民要求相关主管部门约谈各单车运营企业，迅速派员清运现场淤积单车，规范运维调度调度。`,
        `市民来电反映位于天河区${sub.name}街道${community}${road}某号楼下公共绿化带旁，有大堆建筑拆旧废料和生活厨余垃圾堆积近一周时间无人清运，烈日暴晒下污水横流散发刺鼻恶臭，滋生大量蚊虫苍蝇。现市民希望街道环卫站或市政部门尽快安排环卫垃圾清运车彻底清理现场，并对周边路面进行消杀保洁。`,
        `市民举报天河区${sub.name}街道${community}内部某栋自建房楼顶，近期业主未经规划国土部门审批许可，正在私自搭建两层加层钢结构铁皮棚违章建筑，施工过程中不仅坠落水泥碎石存在严重高空坠物砸人安全隐患，且严重破坏楼体承重结构。市民要求规划与综合行政执法部门立即叫停非法施工，依法下达违建拆除决定书并拆除到位。`,
      ];
      return pick(variants, rng);
    },
  },

  // 2. 交通出行 (违停、拥堵、出租黑车、公交)
  {
    category: "交通出行",
    titlePrefix: "（交通）",
    urgentChance: 0.2,
    stabilityChance: 0.01,
    titles: [
      "机动车违规乱停放阻碍交通",
      "早晚高峰主干道信号灯设置不合理",
      "出租车拒载及议价不打表投诉",
      "非机动车道被施工占道无安全护栏",
      "公交线路班次间隔过长候车难",
      "大货车夜间超速违章鸣笛扰民",
    ],
    generate: (sub: SubdistrictDef, dateStr: string, timeStr: string, rng: () => number) => {
      const road = pick(sub.roads, rng);
      const landmark = pick(sub.landmarks, rng);
      const community = pick(sub.communities, rng);
      const variants = [
        `市民反映位于天河区${sub.name}街道${road}（紧邻${landmark}段），每日夜间18:00至23:00有大量私家车和网约车双排甚至三排违规停放，原本双向四车道直接被挤占缩窄为单车道通行，极易引发交通瘫痪及剐蹭事故。市民表示此问题存在已久未见交警常态化抄牌，现希望天河交警大队增派警力加强违停巡查执法，依法予以劝离并电子抓拍开具罚单。`,
        `市民反映天河区${sub.name}街道${road}与周边主干道交叉路口处，交通信号灯东西方向绿灯时长仅设定为18秒，但早晚上下班高峰期车流量巨大，往往排队五个红绿灯周期都无法通过路口，导致后方车辆严重倒灌滞留在路口中心形成打结。市民建议交警交管科技部门实地评估高峰车流，智能优化延长该相位绿灯通行配时。`,
        `市民反映在${dateStr} ${timeStr}其于天河区${sub.name}街道${landmark}出租车候车点打车前往天河客运站，连续两辆巡游出租车（车牌：粤A·****）在得知目的地距离较近后均直接摆手拒载，第三辆车则直接要求一口价50元不打表。市民认为涉事出租车存在严重拒载和非法议价行为，损害广州文明城市形象，要求市交通运输局依法核实调取车载GPS及监控，严格处理违规司机。`,
        `市民反映天河区${sub.name}街道${community}${road}非机动车道被某水务电力工程施工围蔽，但施工方并未按照规范在围蔽两端设置醒目反光防撞警示锥桶及夜间LED警示灯，导致多名骑行电动车的市民在夜间视线不佳时撞上围挡受伤摔倒。市民要求交警及住房建设局督促施工方立即增设完善安全警示隔离设施，保障群众出行生命安全。`,
      ];
      return pick(variants, rng);
    },
  },

  // 3. 市场监管 (退费、食品安全、预付卡、价格)
  {
    category: "市场监管",
    titlePrefix: "（市监）",
    urgentChance: 0.1,
    stabilityChance: 0.12,
    titles: [
      "单用途预付卡商家失联闭店退款维权",
      "餐饮店食品内发现异物及变质问题",
      "商场专柜诱导老年人高价消费保健品",
      "电商平台商户虚假宣传拒绝七天无理由退货",
      "酒店客房节假日临时单方面毁单涨价",
      "餐饮收费未明码标价隐形消费纠纷",
    ],
    generate: (sub: SubdistrictDef, dateStr: string, timeStr: string, rng: () => number) => {
      const comm = pick(sub.commercial, rng);
      const landmark = pick(sub.landmarks, rng);
      const brand = pick(["某连锁轻食健身中心", "某少儿体适能培训俱乐部", "某美容美发SPA私享馆", "某国际舞蹈瑜伽中心", "某高端烘焙烘培会所"], rng);
      const variants = [
        `市民反映其于2024年11月在天河区${sub.name}街道${comm}（近${landmark}）的${brand}充值办理年卡会员及私教课程，共计支付储值卡金8,800元（未签订书面纸质合同）。在${dateStr}市民前往消费时发现该店大门紧锁人去楼空，物业张贴欠租断电公告，涉事法人及销售人员微信拉黑手机关机无法联系，涉及被坑会员数百人。市民要求天河区市场监管局立即立案调查，冻结该机构账户并责令原路退还剩余充值余额款项。`,
        `市民致电反映在天河区${sub.name}街道${comm}某网红餐饮店堂食就餐时，在端上的主菜牛肉汤及凉拌菜中先后发现两只死苍蝇以及一截明显头发，且闻到肉质有严重酸臭变质异味。市民当场向服务员反映，店方态度极其蛮横恶劣仅同意赠送饮料拒不道歉赔偿。市民现向市场监管部门投诉该店食品卫生不达标，要求执法人员对后厨卫生条件进行突击检查，并依法依《食品安全法》支持十倍赔偿诉求。`,
        `市民来电求助称其年逾七旬的母亲在天河区${sub.name}街道${landmark}周边某养生会所体验免费理疗时，被店员洗脑虚假夸大宣传某种“富硒活磁量子太空舱”可包治高血压糖尿病痛风等慢性病，诱导老人背着家人刷卡28,000元购买毫无药用价值的固体饮料和仪器。市民现要求市场监督管理所介入查处该店针对银发群体的虚假宣传及涉老欺诈行为，协助全额退还老人养老钱。`,
      ];
      return pick(variants, rng);
    },
  },

  // 4. 生态环境 (工地噪音、餐饮油烟、水体污染)
  {
    category: "生态环境",
    titlePrefix: "（环保）",
    urgentChance: 0.25,
    stabilityChance: 0.01,
    titles: [
      "建筑工地夜间超时违法施工噪声扰民",
      "临街餐饮饭馆油烟直排呛人异味",
      "工业园区排污管道异味刺鼻扰民",
      "居民楼下商业排风机组低频震动噪音",
      "河道水质发黑发臭漂浮生活垃圾",
    ],
    generate: (sub: SubdistrictDef, dateStr: string, timeStr: string, rng: () => number) => {
      const road = pick(sub.roads, rng);
      const landmark = pick(sub.landmarks, rng);
      const community = pick(sub.communities, rng);
      const variants = [
        `市民反映位于天河区${sub.name}街道${community}${road}附近某在建地产及市政项目工地（靠近${landmark}），在${dateStr}深夜23:45至次日凌晨03:20期间，大型打桩机、混凝土搅拌浇筑车仍在轰鸣作业，现场塔吊警报响个不停，强光探照灯直射居民卧室窗户，造成整个小区业主严重失眠神经衰弱。市民表示该工地并未张贴夜间连续施工作业批文，涉嫌严重违法夜间超时施工，要求天河生态环境分局执法人员立即现场叫停并从重顶格罚款处罚。`,
        `市民反映天河区${sub.name}街道${road}某号一楼临街重餐饮烧烤湘菜馆，其私自将油烟排气烟囱直接架设在二楼居民阳台下方，不仅未按规范安装符合国标的静电式油烟净化装置，而且每天下午17:00至深夜油烟滚滚直冲楼上住宅，居民常年无法开窗通风换气。市民多次向物业反映无果，现希望环保执法部门上门检测油烟排放浓度并责令加装油烟净化器及高空达标排放通道。`,
        `市民反映天河区${sub.name}街道${community}旁河涌水域，近期水体颜色呈现浑浊黑褐色，水面漂浮着大量油花死鱼及塑料袋垃圾，并持续散发刺鼻恶臭熏天。市民怀疑有周边汽修洗车作坊或餐饮违规私设排污暗管直排生活污水，希望水务局与生态环境分局联合排查污染源头，彻底清淤截污还周边居民清澈水质。`,
      ];
      return pick(variants, rng);
    },
  },

  // 5. 劳动社保 (欠薪、社保补缴、工伤、劳动纠纷)
  {
    category: "劳动社保",
    titlePrefix: "（劳监）",
    urgentChance: 0.35,
    stabilityChance: 0.65, // 欠薪容易引发群体涉稳风险
    titles: [
      "拖欠劳动者工资薪酬投诉",
      "用人单位无故拖欠裁员N+1经济补偿金",
      "用工企业未按实际工资基数足额缴纳社保",
      "工地拖欠农民工劳务工程款涉稳风险",
      "违法辞退孕期女职工劳动争议",
      "超时严重加班且不依法支付加班费",
    ],
    generate: (sub: SubdistrictDef, dateStr: string, timeStr: string, rng: () => number) => {
      const landmark = pick(sub.landmarks, rng);
      const road = pick(sub.roads, rng);
      const techCompany = pick([
        "某网络科技有限公司",
        "某智能信息技术服务有限公司",
        "某跨境电子商务有限公司",
        "某数字传媒广告有限公司",
        "某软件外包开发工程部",
      ], rng);
      const amount = Math.floor(rng() * 40000 + 12000);
      const workerCount = Math.floor(rng() * 35 + 8);
      const variants = [
        `市民反映其是位于天河区${sub.name}街道${landmark}大厦B座（${road}）的${techCompany}在职研发员工。市民表示公司自2024年10月起无故停发全员工资，截至目前已累计拖欠其个人劳动报酬${amount}元，涉及同部门研发与测试员工共计${workerCount}人，拖欠总金额超数百万元。公司负责人多次以资金链紧张融资未到位为由恶意推诿拖延，现诉求人生活极度困难难以为继，要求天河区人力资源和社会保障局劳动保障监察大队火速立案，责令涉案用人单位限期足额发放劳动报酬并加付赔偿金。`,
        `诉求人致电反映天河区${sub.name}街道${road}某建设工程工地，总承包方与劳务分包公司产生工程结算纠纷，导致现场${workerCount}名农民工兄弟自2024年底至今未收到一分钱生活费及工钱。诉求人表示临近年关大家急需拿钱回家赡养老人抚养子女，目前工人群情激愤情绪极不稳定，极易引发前往相关信访部门群体性聚集等涉稳极端行为。诉求人请求街道综治维稳办与劳动监察大队第一时间介入成立专班，启动工资保证金应急代偿机制，坚决保障劳务人员合法权益。`,
        `市民反映其在天河区${sub.name}街道${landmark}某餐饮管理公司入职工作已有三年时间，公司在合同期内始终按照广州市最低工资标准为员工缴纳社会保险，与其实际月薪扣税基数存在极大差距，严重损害其退休金和医疗保障权益。市民现已离职，特向天河区社保基金管理中心及劳动仲裁部门提起维权申请，要求涉事单位依法补缴在职三年期间漏缴少缴的养老与医疗社保差额。`,
      ];
      return pick(variants, rng);
    },
  },

  // 6. 社会治理 (租房纠纷、邻里漏水、物业纠纷)
  {
    category: "社会治理",
    titlePrefix: "（综治）",
    urgentChance: 0.1,
    stabilityChance: 0.05,
    titles: [
      "房屋租赁退房押金克扣纠纷",
      "楼上邻居卫生间长期漏水导致天花板霉烂",
      "小区物业服务质价不符擅自上涨物业费",
      "群租房私设多间胶囊隔断安全隐患投诉",
      "小区业委会换届选举程序违规争议",
    ],
    generate: (sub: SubdistrictDef, dateStr: string, timeStr: string, rng: () => number) => {
      const road = pick(sub.roads, rng);
      const community = pick(sub.communities, rng);
      const variants = [
        `市民反映其租住在天河区${sub.name}街道${community}${road}某花园小区出租屋，租赁合同于${dateStr}到期依约正常退租，现场验房确认房屋设施完好且无任何水电气欠费。但二房东中介以墙面存在微小划痕和自然折旧污渍为由，强行扣留市民押金3,500元拒不退还，市民多次拨打其电话均遭粗暴辱骂威胁。市民现希望街道司法所、社区居委会调解中心介入组织面对面公道调解，依法追回被恶意克扣的租房押金。`,
        `市民来电反映天河区${sub.name}街道${community}某单元602室业主，其主卧卫生间暗管长期持续向楼下502室渗水漏水，导致502室天花板大面积石膏吊顶霉烂脱落发黑，电路跳闸存在严重触电危险。市民多次携物业上门沟通，楼上业主拒不开门且态度极其冷漠推脱不予维修。市民请求社区网格员及街道平安法治办上门联合做思想协调工作，督促楼上尽快闭水测试彻底维修好漏水点。`,
        `市民反映天河区${sub.name}街道${community}某住宅小区物业管理服务极其低劣，保洁保安严重缩编，门禁闸机常年瘫痪，非业主人员随意进出盗窃频发。在未召开业主大会表决通过的情况下，该物业公司擅自下发通知单方面将物业费由2.8元/平米上调至3.5元/平米。业主代表要求天河区住房建设和园林局物业科责令撤销非法调价决定，监督启动规范的业主大会招标程序。`,
      ];
      return pick(variants, rng);
    },
  },

  // 7. 公共安全 (电动车入户、消防通道、燃气电梯)
  {
    category: "公共安全",
    titlePrefix: "（急）",
    urgentChance: 0.65, // 公共安全大部分是加急件
    stabilityChance: 0.08,
    titles: [
      "违规停放电动自行车及飞线充电安全隐患",
      "住宅小区消防应急通道被锁闭占用",
      "居民楼住宅电梯频繁故障下坠困人",
      "高空坠物隐患及外墙瓷砖空鼓脱落",
      "老旧小区私接乱拉燃气管道安全排查",
    ],
    generate: (sub: SubdistrictDef, dateStr: string, timeStr: string, rng: () => number) => {
      const road = pick(sub.roads, rng);
      const community = pick(sub.communities, rng);
      const variants = [
        `市民紧急致电反映天河区${sub.name}街道${community}${road}某栋高层住宅楼，有多名租客每天夜间将大功率锂电池电动车直接推入客梯运至12楼走廊停放并入户私拉电线彻夜充电，楼道内弥漫电瓶刺鼻发热异味，严重违反消防安全管理条例，万一爆燃将彻底封死整栋楼居民生命逃生通道。市民多次劝阻遭租客威胁，要求天河消防救援大队与派出所民警立即上门开展联合消防执法清查，依法依规强制搬离并顶格处罚涉案责任人。`,
        `市民反映天河区${sub.name}街道${community}消防逃生安全通道常年被一楼商户及物业用大铁锁违规锁闭，并在楼梯口内大量堆积硬纸板包装箱等易燃物品，消火栓甚至无水带水枪。近期国内高层建筑火灾教训深刻，市民极度恐惧担忧，现要求街道应急管理办与消防部门立即下达限期整改指令书，强制打通救命生命通道。`,
        `市民反映天河区${sub.name}街道${community}${road}某单元客梯，在${dateStr} ${timeStr}发生突发下坠并卡在7楼与8楼之间，电梯内困有包括一位孕妇和两名儿童在内的共5名居民，困梯长达近40分钟，报警紧急呼叫按钮无人应答。市民反映该电梯今年以来已累计困人下坠十余次，安全检测贴纸已过期，要求市场监管局特种设备安全监察科立即责令电梯维保单位停梯大修并追究维保责任。`,
      ];
      return pick(variants, rng);
    },
  },
];

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

// 可复现高质量 PRNG (Mulberry32)
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const TOTAL_RECORDS = 100000;
  console.log(`🚀 开始生成广州市天河区 12345 热线仿真工单数据 (共计 ${TOTAL_RECORDS.toLocaleString()} 条)...`);
  const startTime = Date.now();

  const rng = mulberry32(20250101);

  // 设定时间跨度: 2025年1月1日至2025年3月31日 (2025年第一季度，共90天)
  const baseEpoch = new Date("2025-01-01T08:00:00+08:00").getTime();
  const ninetyDaysMs = 90 * 24 * 3600 * 1000;

  // 预备 Excel 行数据
  // 严格参照 sample_300.xlsx: headers = ["index", "ticketNo", "title", "content"]
  const rows: any[][] = [];
  rows.push(["index", "ticketNo", "title", "content"]);

  // 街道分布权重：天河南、棠下、石牌、猎德、车陂等核心商圈/人口稠密街道工单略多
  const subWeights: { sub: SubdistrictDef; weight: number }[] = SUBDISTRICTS.map((s) => {
    let w = 1.0;
    if (["天河南", "石牌", "棠下", "猎德", "冼村", "车陂"].includes(s.name)) w = 1.6;
    if (["林和", "沙河", "员村", "元岗", "新塘"].includes(s.name)) w = 1.2;
    if (["凤凰", "珠吉", "龙洞"].includes(s.name)) w = 0.8;
    return { sub: s, weight: w };
  });
  const totalWeight = subWeights.reduce((acc, cur) => acc + cur.weight, 0);

  function pickWeightedSubdistrict(): SubdistrictDef {
    let r = rng() * totalWeight;
    for (const item of subWeights) {
      if (r <= item.weight) return item.sub;
      r -= item.weight;
    }
    return subWeights[0].sub;
  }

  // 事项代码映射池 (如 0109, 0102, 0105, 0407, 0110 等)
  const matterCodes = ["0109", "0102", "0105", "0407", "0110", "0208", "0304", "0501", "0602"];

  // 批量生成
  const printStep = 20000;
  for (let i = 1; i <= TOTAL_RECORDS; i++) {
    // 1. 产生仿真时间 (分布在 2025-01-01 ~ 2025-03-31)
    const tMs = baseEpoch + Math.floor((i / TOTAL_RECORDS) * ninetyDaysMs + (rng() - 0.5) * 86400000);
    const dateObj = new Date(Math.max(baseEpoch, tMs));
    const yearStr = String(dateObj.getFullYear()).slice(-2); // "25"
    const monthStr = String(dateObj.getMonth() + 1).padStart(2, "0");
    const dayStr = String(dateObj.getDate()).padStart(2, "0");
    const hourStr = String(dateObj.getHours()).padStart(2, "0");
    const minuteStr = String(dateObj.getMinutes()).padStart(2, "0");
    const secondStr = String(dateObj.getSeconds()).padStart(2, "0");

    const yymmdd = `${yearStr}${monthStr}${dayStr}`;
    const seqStr = String((i % 999999) + 1).padStart(6, "0");
    const matterCode = pick(matterCodes, rng);
    // ticketNo 标准格式: 250101000020109-01
    const ticketNo = `${yymmdd}${seqStr.slice(0, 5)}${matterCode}-01`;

    const dateStr = `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
    const timeStr = `${hourStr}:${minuteStr}:${secondStr}`;

    // 2. 选择街道及场景模板
    const sub = pickWeightedSubdistrict();
    const tpl = pick(TEMPLATES, rng);

    // 3. 构造标题
    const rawTitle = pick(tpl.titles, rng);
    let titlePrefix = tpl.titlePrefix;
    if (rng() < 0.2) {
      titlePrefix = "【小程序自助】" + titlePrefix;
    }
    const title = `${titlePrefix}${rawTitle}`;

    // 4. 生成高仿真脱敏内容
    const content = tpl.generate(sub, dateStr, timeStr, rng);

    rows.push([i, ticketNo, title, content]);

    if (i % printStep === 0) {
      console.log(`⚡ 已生成 ${i.toLocaleString()} / ${TOTAL_RECORDS.toLocaleString()} 条 (${Math.round((i / TOTAL_RECORDS) * 100)}%)...`);
    }
  }

  console.log(`📦 生成完毕，正在将 ${TOTAL_RECORDS.toLocaleString()} 条数据写入 Excel 工作簿...`);
  const sheetStartTime = Date.now();

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "天河区12345工单_10万条");

  // 输出路径: 用户 Downloads 目录下
  const outDir = "/Users/FireTable/Downloads";
  const outPath = path.join(outDir, "guangzhou_tianhe_12345_10w.xlsx");

  XLSX.writeFile(wb, outPath, { compression: true });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const fileSizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);

  console.log(`\n🎉 成功输出 10 万条天河区测试工单!`);
  console.log(`📁 文件绝对路径: ${outPath}`);
  console.log(`📊 文件大小: ${fileSizeMb} MB`);
  console.log(`⏱️ 总耗时: ${durationSec} 秒`);

  // 输出抽样检验前 3 条
  console.log("\n📋 抽样检验 (前 3 条):");
  for (let j = 1; j <= 3; j++) {
    console.log(`\n--- 第 ${j} 条 ---`);
    console.log(`序号: ${rows[j][0]}`);
    console.log(`工单编号: ${rows[j][1]}`);
    console.log(`工单标题: ${rows[j][2]}`);
    console.log(`工单正文: ${rows[j][3]}`);
  }
}

main().catch((err) => {
  console.error("生成失败:", err);
  process.exit(1);
});
