import { NextResponse } from "next/server";
import { runTicketRadarPipeline } from "@/backend/agent";
import { MOCK_RAW_TICKETS } from "@/lib/mock-data";

export async function POST(req: Request) {
  try {
    const { prompt, threadId } = await req.json();
    const result = await runTicketRadarPipeline(MOCK_RAW_TICKETS, threadId || "copilot-session");
    const { themes, stats } = result;

    const text = prompt || "";
    let reply = "";

    if (text.includes("紧急") || text.includes("风险")) {
      const highRisk = themes.filter((t) => t.riskLevel === "HIGH");
      reply = `经过 GraphRAG 拓扑与突发密度分析，当前有 **${highRisk.length} 项高危警报** 需立即协同督办：\n\n1. **${highRisk[0]?.title}**（${highRisk[0]?.ticketCount}单）：${highRisk[0]?.riskReason}\n2. **${highRisk[1]?.title}**（${highRisk[1]?.ticketCount}单）：${highRisk[1]?.riskReason}\n3. **${highRisk[2]?.title}**（${highRisk[2]?.ticketCount}单）：${highRisk[2]?.riskReason}\n\n建议优先启动跨部门应急联席办理机制。`;
    } else if (text.includes("大良") || text.includes("主体")) {
      reply = `统计分析显示，**大良街道** 是多频工单最为集中的区域，主要高频主体为：\n- 🏗️ **金科博翠天下施工项目部** (14单 - 夜间施工噪音)\n- 🏢 **保利中汇物业服务中心** (7单 - 4栋电梯下坠故障)\n- 🍢 **顺峰山南门流动摊区** (8单 - 占道经营油烟)\n- 🏬 **顺德万达广场餐饮区** (6单 - 油烟直排扰民)\n\n建议大良综合执法队重点排查逢沙社区与南国东路商圈。`;
    } else if (text.includes("占道") || text.includes("摊贩")) {
      reply = `当前系统识别出 2 处典型的流动摊贩多频占道事件：\n1. **顺峰山公园南门广场**（8单）：晚间油烟弥漫，三轮车堵塞非机动车道\n2. **逢沙大道夜市无证烧烤**（5单）：深夜喧哗，地面油污致小学生滑倒\n\n**建议举措**：由于存在巡查后回潮规律，建议城管部门划定规范便民疏导点并加装高点智慧抓拍球机。`;
    } else if (text.includes("简报") || text.includes("总结")) {
      reply = `📋 **今日热线多频工单研判日报**：\n- **总受理量**：${stats.totalTickets} 件（多频占比 ${stats.multiFrequencyRate}%）\n- **压缩提效**：由 ${stats.totalTickets} 单压缩为 ${stats.themeCount} 个治理主题（决策负荷降低 ${stats.compressionRatio}%）\n- **重点聚焦**：突发供水管网爆裂（9单）已联动水务抢修；工地超时施工（14单）已建议停工整顿。\n- **预期成效**：预计缩短处置流转耗时 4.8 小时。`;
    } else {
      reply = `收到关于「${text}」的研判需求。基于当前工单图谱，系统已关联到【${themes[0]?.canonicalSubject}】等 ${stats.themeCount} 个多频主题。您可以在左侧看板点击任意卡片查看详细工单明细与市民表述对照。`;
    }

    return NextResponse.json({
      success: true,
      data: {
        reply,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to process Copilot query" },
      { status: 500 }
    );
  }
}
