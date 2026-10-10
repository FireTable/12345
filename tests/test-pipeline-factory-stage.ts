/**
 * 工厂画布在生成主题建议时要认 SYNTHESIZING，并用任务上的主题数，而不是还没入库的 0。
 */
import { adviceProgress, resolvePipelineFactoryStage } from "../app/workbench/_components/pipeline-factory-stage";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

const tianhe = resolvePipelineFactoryStage({
  isRunning: true,
  stage: "SYNTHESIZING",
  stageText: "正在生成处置建议 (5110 / 5623 主题)...",
  totalTickets: 96019,
  analyzedTickets: 96019,
  persistedThemes: 0,
  progressThemeCount: 5623,
});

assert(tianhe.entityCompleted && !tianhe.entityRunning, "建议生成时提取工序保持完成");
assert(tianhe.clusterStatus === "completed", "聚合已经做完，不再显示等待分析");
assert(
  tianhe.clusterThemeCount === 5623 &&
    tianhe.clusterStatusText === `聚合完成 (${(5623).toLocaleString()}组)`,
  "专题数用任务上报的主题数，不看还没落库的 0",
);
assert(tianhe.dossierStatus === "running", "案卷工序在生成建议时是进行中");
assert(
  tianhe.dossierStatusText === `生成中 ${(5110).toLocaleString()}/${(5623).toLocaleString()}`,
  "案卷角标带上已生成和总数",
);
assert(tianhe.dossierCount === 5110, "案卷数字跟着已生成条数走");
assert(tianhe.dossierRunning && !tianhe.clusterEdgeActive, "流动光点停在生成案卷这条边上");

const starting = resolvePipelineFactoryStage({
  isRunning: true,
  stage: "SYNTHESIZING",
  stageText: "正在为 5623 个主题生成各自的摘要和处置建议...",
  totalTickets: 96019,
  analyzedTickets: 96019,
  persistedThemes: 0,
  progressThemeCount: 5623,
});
assert(starting.dossierCount === 0 && starting.dossierStatus === "running", "刚开始生成时案卷数是 0，状态仍是进行中");
assert(
  starting.dossierStatusText === `生成中 ${(0).toLocaleString()}/${(5623).toLocaleString()}`,
  "开场文案也能读出总数",
);

const writing = adviceProgress("主题已生成，正在写入数据库（5623 个）...");
assert(writing?.done === 5623 && writing.total === 5623, "写入数据库的文案算全部完成");

const flushing = resolvePipelineFactoryStage({
  isRunning: true,
  stage: "SYNTHESIZING",
  stageText: "主题已生成，正在写入数据库（5623 个）...",
  totalTickets: 96019,
  analyzedTickets: 96019,
  persistedThemes: 0,
  progressThemeCount: 5623,
});
assert(flushing.dossierStatusText === "正在写入案卷" && flushing.dossierCount === 5623, "落库阶段角标改成正在写入");

const alias = resolvePipelineFactoryStage({
  isRunning: true,
  stage: "SUMMARIZING",
  stageText: "正在生成处置建议 (1 / 2 主题)...",
  totalTickets: 10,
  analyzedTickets: 10,
  persistedThemes: 0,
  progressThemeCount: 2,
});
assert(alias.dossierRunning && alias.clusterCompleted, "旧阶段名 SUMMARIZING 同样点亮案卷工序");

const embedding = resolvePipelineFactoryStage({
  isRunning: true,
  stage: "EMBEDDING",
  stageText: "嵌入中",
  totalTickets: 100,
  analyzedTickets: 100,
  persistedThemes: 0,
  progressThemeCount: 0,
});
assert(embedding.embedding && embedding.clusterEdgeActive && embedding.clusterStatus === "running", "嵌入中工序 04 仍在跑");
assert(embedding.dossierStatus === "idle", "嵌入时案卷工序继续等待");

const settled = resolvePipelineFactoryStage({
  isRunning: false,
  stage: "COMPLETED",
  stageText: "研判完成",
  totalTickets: 100,
  analyzedTickets: 100,
  persistedThemes: 45,
  progressThemeCount: 45,
});
assert(settled.dossierStatus === "completed" && settled.dossierCount === 45, "结束后案卷数改用已入库主题");
assert(settled.clusterThemeCount === 45, "结束后专题数与库一致");
