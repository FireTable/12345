import { NextRequest } from "next/server";
import { getChatModel } from "@/backend/model";
import { buildAiScoutPrompt } from "@/backend/prompt";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

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
      return apiError(ApiCode.INVALID_PARAMS, undefined, 400);
    }

    const prompt = buildAiScoutPrompt({ province, city, district });

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
      return apiError(ApiCode.AI_PARSE_FAILED, undefined, 500);
    }

    return apiSuccess({
      meta: {
        province,
        city,
        district,
        townshipCount: parsed.townships.length,
        departmentCount: parsed.departments?.length || 0,
      },
      ...parsed,
    });
  } catch (error: any) {
    console.error("[api/admin/regions/ai-scout] Error:", error);
    return apiError(ApiCode.AI_SCOUT_FAILED, error.message, 500);
  }
}
