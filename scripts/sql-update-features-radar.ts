import { db } from "../db/client";
import { sql } from "drizzle-orm";

async function main() {
  console.log("==================================================");
  console.log("🚀 执行 SQL 批量落库：Features、Radar 与工单评分");
  console.log("==================================================");

  // 1. 更新 Themes 的 features_json 与 radar_json
  await db.execute(sql`
    UPDATE themes
    SET 
      features_json = json_build_array(
        json_build_object('name', '语义相关度', 'pct', 93, 'desc', '诉求事项与核心矛盾高度同源'),
        json_build_object('name', '空间聚集度', 'pct', CASE WHEN pattern_type = 'DIVERGE' THEN 84 ELSE 95 END, 'desc', '同属属地辖区且微观物理半径收敛'),
        json_build_object('name', '时序密度', 'pct', 86, 'desc', '相近时段内呈高频突发态势'),
        json_build_object('name', '情绪敏感度', 'pct', CASE WHEN risk_level = 'HIGH' THEN 90 ELSE 75 END, 'desc', '涉及群众切身民生利益诉求'),
        json_build_object('name', '主体一致性', 'pct', CASE WHEN pattern_type = 'DIVERGE' THEN 98 ELSE 92 END, 'desc', '指向相同涉事主体或处置责任单位')
      )::text,
      radar_json = (
        CASE 
          WHEN risk_level = 'HIGH' THEN '[95, 92, 88, 90, 96]'
          WHEN pattern_type = 'DIVERGE' THEN '[94, 84, 86, 75, 98]'
          ELSE '[93, 95, 86, 75, 92]'
        END
      );
  `);
  console.log("✅ 全量 Themes 的 features_json 与 radar_json 已 100% 写入数据库");

  // 2. 更新全量 Tickets 的 AI 研判置信度评分
  await db.execute(sql`
    UPDATE tickets
    SET confidence = 88
    WHERE confidence IS NULL OR confidence = 0;
  `);
  console.log("✅ 全量 Tickets 智能评分已 100% 写入数据库 (评分: 88%)");

  console.log("==================================================");
  console.log("🎉 全部研判特征、五维雷达与评分数据已就绪！");
  console.log("==================================================");
}

main().catch(console.error).finally(() => process.exit(0));
