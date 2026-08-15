import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { sql, desc } from "drizzle-orm";
import { getChatModel } from "@/backend/model";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    const query = String(prompt || "").trim();

    // 1. Fetch current macro context from DB
    const countRes = await db.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const totalCount = Number(countRes[0]?.count || 0);

    const currentThemes = await db
      .select()
      .from(themesTable)
      .orderBy(desc(themesTable.ticketCount))
      .limit(10);

    const highRiskCount = currentThemes.filter((t) => t.riskLevel === "HIGH").length;
    const mediumRiskCount = currentThemes.filter((t) => t.riskLevel === "MEDIUM").length;

    // 2. Call real LLM (gpt-5.6-terra) for intelligent governance Copilot
    const chat = getChatModel(0.3);

    const systemPrompt = `你是由 LangGraph JS 图工作流驱动的 12345 政务热线智能研判副驾驶（LightCopilot）。
当前大盘运行数据底座如下：
- 工单总接入量：${totalCount} 件
- 识别多频主题总数：${currentThemes.length} 个
- 高危紧急事件：${highRiskCount} 项，重点跟进事件：${mediumRiskCount} 项
- 重点多频主题摘要：
${currentThemes
  .map(
    (t, idx) =>
      `${idx + 1}. 【${t.riskLevel}】${t.title}（${t.ticketCount}件工单，位于${t.canonicalLocation}，处置科室建议：${t.recommendedAction}）`
  )
  .join("\n")}

用户提问：「${query}」

请作为资深政务大数据研判专家，给出专业、严谨、有公文逻辑的回答：
1. 观点明确，条理清晰，善用 Markdown 加粗和列表；
2. 如果涉及具体主题或风险，请引用真实数据与建议；
3. 如果用户要求生成交办单或督办公文，请提供标准政务公文格式（包含单号、发文单位、主送单位、案情摘要、处置时限与督办要求）；
4. 语言精炼有力，体现高效政务治理水准。`;

    const res = await chat.invoke(systemPrompt);
    const reply = String(res.content);

    return NextResponse.json({
      success: true,
      data: {
        reply,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error("Copilot error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to process Copilot query" },
      { status: 500 }
    );
  }
}
