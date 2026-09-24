import { NextRequest, NextResponse } from "next/server";
import { getChatModel } from "@/backend/model";

/**
 * POST /api/admin/regions/ai-scout
 * 🤖 SuperAgent AI 政务区划与权责清单智能生成专家
 * 给定省、市、区县名称，自动梳理出：
 * 1. 该区县所有法定镇街/街道全称、简称、常见别称、知名社区与核心地标
 * 2. 属地 12345 重点协同承办部门权责清单（城管执法、交警、市监、环保、住建等）
 * 3. 适应该地区的 7 大法定民生诉求分类
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { province = "广东省", city = "广州市", district = "海珠区" } = body;

    if (!district || !city) {
      return NextResponse.json(
        { success: false, error: "请提供城市与区县名称，例如：广州市 天河区" },
        { status: 400 }
      );
    }

    const prompt = `你是中国民政政务区划、城市网格化管理与 12345 政务服务热线体系专家。
请为【${province} ${city} ${district}】生成一套权威、精准、无幻觉的 12345 智能化运行标准字典底座。

【严格输出要求】：
请只输出一个合法的 JSON 对象，严禁任何 Markdown 标记、思考过程或多余解释。格式如下：
{
  "townships": [
    {
      "name": "简写（如: 琶洲、猎德、大良）",
      "fullName": "法定全称（如: 琶洲街道、猎德街道）",
      "aliases": ["常见口语简称", "旧称", "知名商圈片区名"],
      "communities": ["该街道下辖真实知名社区/居委会1", "社区2"],
      "landmarks": ["辖区内知名地标、地铁站、重要商圈或核心园区1", "地标2"]
    }
  ],
  "departments": [
    {
      "code": "部门代号（如: GZ-TH-CG）",
      "name": "口语简称（如: 综合行政执法队）",
      "fullName": "法定全称（如: 广州市天河区城市管理和综合执法局 / 街道综合行政执法队）",
      "category": "主要对接民生分类（城市管理/市场监管/交通出行/生态环境/劳动社保/社会治理/公共安全）"
    }
  ],
  "categories": [
    {
      "category": "城市管理",
      "subItems": ["市容环卫", "流动摊贩占道", "违建违章", "市政设施破损"],
      "leadDepartment": "区综合行政执法局 / 住房建设局"
    },
    {
      "category": "市场监管",
      "subItems": ["商品消费维权", "食品安全", "价格欺诈", "预付卡纠纷"],
      "leadDepartment": "区市场监督管理局 / 消费者委员会"
    },
    {
      "category": "交通出行",
      "subItems": ["机动车违停", "交通拥堵", "共享单车乱堆放", "公交出租服务"],
      "leadDepartment": "交警大队 / 交通运输分局"
    },
    {
      "category": "生态环境",
      "subItems": ["商业噪音扰民", "餐饮油烟", "工地施工噪声", "河道水污染"],
      "leadDepartment": "生态环境分局"
    },
    {
      "category": "劳动社保",
      "subItems": ["拖欠工资欠薪", "未缴社保", "劳动合同争议", "工伤认定"],
      "leadDepartment": "区人力资源和社会保障局"
    },
    {
      "category": "社会治理",
      "subItems": ["邻里矛盾", "租房租赁纠纷", "信访调解", "便民服务"],
      "leadDepartment": "街道平安法治办 / 社区居委会 / 辖区派出所"
    },
    {
      "category": "公共安全",
      "subItems": ["消防通道堵塞", "电动车违规充电", "燃气与危化品安全", "高空坠物"],
      "leadDepartment": "应急管理局 / 消防救援大队 / 派出所"
    }
  ]
}

请全面列出【${province} ${city} ${district}】所有的法定街道/镇（例如广州天河区包含 21 条街道，海珠区包含 18 条街道，越秀区包含 18 条街道，必须全量、真实准确！）。`;

    const chat = getChatModel(0.1);
    const res = await chat.invoke(prompt);
    const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);

    let parsed: any = null;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (err: any) {
        console.warn("[ai-scout] JSON.parse error:", err.message);
      }
    }

    if (!parsed || !Array.isArray(parsed.townships)) {
      return NextResponse.json(
        {
          success: false,
          error: "AI 生成内容格式解析失败，请重试",
          rawText: text.slice(0, 500),
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      meta: {
        province,
        city,
        district,
        townshipCount: parsed.townships.length,
        departmentCount: parsed.departments?.length || 0,
      },
      data: parsed,
    });
  } catch (error: any) {
    console.error("[api/admin/regions/ai-scout] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "AI 智能提取政务区划失败" },
      { status: 500 }
    );
  }
}
