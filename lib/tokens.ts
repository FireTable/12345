/**
 * 统一大模型与慢思考引擎 Token 预算管理中枢 (LLM Token Budget Manager)
 * 
 * 核心设计原则：
 * 1. 预算必须充足：确保深度思维链 (reasoning_content) 与正式公文报告均不被中途腰斩截断；
 * 2. 区分业务场景：结构化抽取与慢思考研判分配不同的充裕安全上限；
 * 3. 拦截失控死循环：防止模型异常退化时无限消耗算力。
 */

function parseEnvInt(key: string, fallback: number): number {
  if (typeof process === "undefined" || !process.env) return fallback;
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

export const LLM_TOKENS = {
  /** 模型总物理上下文窗口 (对应 Bonsai 2 27B / llama-server --ctx-size 8192) */
  CONTEXT_WINDOW: parseEnvInt("LLM_CONTEXT_WINDOW", 8192),

  /**
   * 结构化要素抽取 (ExtractNode)
   * 适用：关闭思维链 (enableThinking: false) 的单次极速结构化直出
   * 预算：2048 Tokens (每批 1~4 条工单仅需 300~500 Tokens，2048 极其充裕且彻底杜绝截断)
   */
  EXTRACTION: parseEnvInt("LLM_EXTRACTION_MAX_TOKENS", 2048),

  /**
   * 主题建议 (SummaryNode)
   * 只要 JSON 正文，不开思考。一批 10 个主题。模型实际写成公文，3072 会在第 10 条半截切断。
   * 5120 能写完并留下闭合括号。提示词大约 2000 token，加上这段仍在 ctx 8192 里面。
   */
  THEME_ADVICE: parseEnvInt("LLM_THEME_ADVICE_MAX_TOKENS", 5120),

  /**
   * 慢思考深度公文研判 (SummaryNode)
   * 适用：开启思维链 (enableThinking: true) 的复杂多频民生热点根因与权责推演
   * 预算：4096 Tokens (容纳 1500~2500 Tokens 深度思维链 + 完整结构化通报公文)
   */
  THINKING_SUMMARY: parseEnvInt("LLM_THINKING_SUMMARY_MAX_TOKENS", 4096),

  /**
   * Copilot 人机协同座席对话与督办生成 (阶段 10)
   * 适用：座席交互问答、政策库相似案由穿透检索与长篇督办函生成
   * 预算：3072 Tokens
   */
  COPILOT: parseEnvInt("LLM_COPILOT_MAX_TOKENS", 3072),

  /**
   * 极简单行判定与轻量决策 (如安全护栏、单字段补全)
   * 预算：1024 Tokens
   */
  LIGHTWEIGHT: parseEnvInt("LLM_LIGHTWEIGHT_MAX_TOKENS", 1024),
} as const;

export const LLM_TIMEOUTS = {
  /**
   * 慢思考深度公文研判超时 (SummaryNode / 复杂思维链)
   * 充裕预算：10 分钟 (600,000 ms)，充分考虑 27B 大模型在本地深入推演思维链的时间，绝不提前掐断
   */
  THINKING: parseEnvInt("LLM_THINKING_TIMEOUT_MS", 600_000),

  /**
   * 结构化要素抽取超时 (ExtractNode)
   * 充裕预算：5 分钟 (300,000 ms)，完全容纳并发批次多工单抽取
   */
  EXTRACTION: parseEnvInt("LLM_EXTRACTION_TIMEOUT_MS", 300_000),

  /**
   * 引擎通用兜底超时
   * 预算：10 分钟 (600,000 ms)
   */
  DEFAULT: parseEnvInt("LLM_DEFAULT_TIMEOUT_MS", 600_000),
} as const;

/**
 * 根据是否开启慢思考获取自适应安全默认 Token 预算
 */
export function getDefaultMaxTokens(enableThinking?: boolean): number {
  return enableThinking ? LLM_TOKENS.THINKING_SUMMARY : LLM_TOKENS.EXTRACTION;
}

/**
 * 根据是否开启慢思考获取充足的超时时间 (毫秒)
 */
export function getRecommendedTimeout(enableThinking?: boolean): number {
  return enableThinking ? LLM_TIMEOUTS.THINKING : LLM_TIMEOUTS.EXTRACTION;
}
