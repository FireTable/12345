/**
 * 研判流水线工厂（工序 03–05）的阶段判定。
 * 后端写入的是 SYNTHESIZING。主题要等建议生成完才入库，
 * 这段时间 metrics.totalThemes 一直是 0，专题数得用 taskProgress.themeCount。
 */

export type FactoryStageInput = {
  isRunning: boolean;
  stage?: string | null;
  stageText?: string | null;
  totalTickets: number;
  analyzedTickets: number;
  /** 已经写入 themes 表的数量。建议生成过程中为 0。 */
  persistedThemes: number;
  /** summary 节点报的待写主题数。 */
  progressThemeCount: number;
};

export type FactoryStageView = {
  entityRunning: boolean;
  entityCompleted: boolean;
  embedding: boolean;
  /** 边：嵌入或聚合进行时流动。 */
  clusterEdgeActive: boolean;
  clusterRunning: boolean;
  clusterCompleted: boolean;
  clusterStatus: "idle" | "running" | "completed";
  clusterStatusText: string;
  clusterThemeCount: number;
  dossierRunning: boolean;
  dossierCompleted: boolean;
  dossierStatus: "idle" | "running" | "completed";
  dossierStatusText: string;
  /** 生成中显示已写出的建议条数；结束后显示已入库主题数。 */
  dossierCount: number;
};

const ADVICE_STAGES = new Set(["SYNTHESIZING", "SUMMARIZING"]);

function parseCount(raw: string): number {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 从阶段文案里取出「已生成 / 总数」。认不出就返回 null。 */
export function adviceProgress(stageText?: string | null): { done: number; total: number } | null {
  if (!stageText) return null;
  const pair = stageText.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
  if (pair) return { done: parseCount(pair[1]), total: parseCount(pair[2]) };
  const starting = stageText.match(/正在为\s*(\d[\d,]*)/);
  if (starting) return { done: 0, total: parseCount(starting[1]) };
  const writing = stageText.match(/写入数据库[（(]\s*(\d[\d,]*)/);
  if (writing) {
    const n = parseCount(writing[1]);
    return { done: n, total: n };
  }
  return null;
}

export function resolvePipelineFactoryStage(input: FactoryStageInput): FactoryStageView {
  const stage = (input.stage || "EXTRACTING").toUpperCase();
  const advice = ADVICE_STAGES.has(stage);
  const pastExtract =
    advice || stage === "EMBEDDING" || stage === "CLUSTERING" || stage === "COMPLETED";
  const jobSettled =
    input.totalTickets > 0 && input.analyzedTickets >= input.totalTickets && !input.isRunning;

  const entityRunning =
    input.isRunning && stage === "EXTRACTING" && input.analyzedTickets < input.totalTickets;
  const entityCompleted =
    (input.totalTickets > 0 && input.analyzedTickets >= input.totalTickets) || pastExtract || jobSettled;

  const embedding = input.isRunning && stage === "EMBEDDING";
  const clusterRunning = input.isRunning && stage === "CLUSTERING";
  const clusterThemeCount =
    advice || stage === "COMPLETED"
      ? Math.max(input.persistedThemes, input.progressThemeCount)
      : input.persistedThemes;
  const clusterCompleted =
    jobSettled ||
    stage === "COMPLETED" ||
    (advice && input.isRunning) ||
    (clusterThemeCount > 0 && (advice || !input.isRunning));

  const clusterStatus: FactoryStageView["clusterStatus"] =
    embedding || clusterRunning ? "running" : clusterCompleted ? "completed" : "idle";
  const clusterStatusText = embedding
    ? ""
    : clusterRunning
      ? "正在聚合归类"
      : clusterCompleted
        ? `聚合完成 (${clusterThemeCount.toLocaleString()}组)`
        : "等待分析";

  const progress = advice ? adviceProgress(input.stageText) : null;
  const dossierRunning = input.isRunning && advice;
  const dossierCompleted = jobSettled || (input.persistedThemes > 0 && !input.isRunning);
  const dossierStatus: FactoryStageView["dossierStatus"] = dossierRunning
    ? "running"
    : dossierCompleted
      ? "completed"
      : "idle";

  let dossierStatusText = "等待生成";
  if (dossierRunning) {
    if (input.stageText?.includes("写入")) {
      dossierStatusText = "正在写入案卷";
    } else if (progress) {
      dossierStatusText = `生成中 ${progress.done.toLocaleString()}/${progress.total.toLocaleString()}`;
    } else {
      dossierStatusText = "正在生成案卷";
    }
  } else if (dossierCompleted) {
    dossierStatusText = "案卷已就绪";
  }

  const dossierCount = dossierRunning
    ? (progress?.done ?? 0)
    : input.persistedThemes;

  return {
    entityRunning,
    entityCompleted,
    embedding,
    clusterEdgeActive: embedding || clusterRunning,
    clusterRunning,
    clusterCompleted,
    clusterStatus,
    clusterStatusText,
    clusterThemeCount,
    dossierRunning,
    dossierCompleted,
    dossierStatus,
    dossierStatusText,
    dossierCount,
  };
}
