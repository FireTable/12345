/**
 * 前后端通用的标准业务状态码与统一响应规范 (Standard Business API Codes & Responses)
 * 供后端 Route Handlers 与前端组件/Hook 统一引用，避免在各处硬编码中文提示，预留 i18n 多语言能力。
 * 全同构设计：不依赖任何 node/server 特有包，可在浏览器与服务端自由无痛导入。
 */

export enum ApiCode {
  // 通用操作状态
  OK = "OK",
  BAD_REQUEST = "BAD_REQUEST",
  INVALID_PARAMS = "INVALID_PARAMS",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  INTERNAL_ERROR = "INTERNAL_ERROR",

  // 租户与地区站点相关
  REGION_NOT_FOUND = "REGION_NOT_FOUND",
  REGION_ALREADY_EXISTS = "REGION_ALREADY_EXISTS",
  REGION_INIT_FAILED = "REGION_INIT_FAILED",
  REGION_DROP_FAILED = "REGION_DROP_FAILED",

  // 研判任务与流式进度相关
  TASK_RUNNING = "TASK_RUNNING",
  TASK_NOT_FOUND = "TASK_NOT_FOUND",
  TASK_EMPTY_DATA = "TASK_EMPTY_DATA",
  TASK_EXECUTION_FAILED = "TASK_EXECUTION_FAILED",

  // 实体与词典相关
  VOCAB_SEED_FAILED = "VOCAB_SEED_FAILED",
  ALIAS_DUPLICATE = "ALIAS_DUPLICATE",
  ALIAS_NOT_FOUND = "ALIAS_NOT_FOUND",

  // 上传与文件相关
  FILE_EMPTY = "FILE_EMPTY",
  FILE_INVALID_FORMAT = "FILE_INVALID_FORMAT",
  FILE_SIZE_EXCEEDED = "FILE_SIZE_EXCEEDED",
  FILE_UPLOAD_FAILED = "FILE_UPLOAD_FAILED",

  // AI 服务与大模型网关相关
  AI_SCOUT_FAILED = "AI_SCOUT_FAILED",
  AI_SERVICE_UNAVAILABLE = "AI_SERVICE_UNAVAILABLE",
  AI_PARSE_FAILED = "AI_PARSE_FAILED",
}

/**
 * 标准业务状态码对应的友好提示文案（默认中文，预留多语言字典）
 */
export const API_MESSAGES: Record<string, Record<ApiCode, string>> = {
  zh: {
    [ApiCode.OK]: "操作成功",
    [ApiCode.BAD_REQUEST]: "无效的请求参数",
    [ApiCode.INVALID_PARAMS]: "参数缺失或格式不正确",
    [ApiCode.UNAUTHORIZED]: "当前操作需要登录认证",
    [ApiCode.FORBIDDEN]: "暂无权限执行此操作",
    [ApiCode.NOT_FOUND]: "请求的资源不存在",
    [ApiCode.INTERNAL_ERROR]: "系统处理异常，请稍后重试",

    [ApiCode.REGION_NOT_FOUND]: "未找到指定的地区服务站点",
    [ApiCode.REGION_ALREADY_EXISTS]: "该地区站点标识已存在，请更换标识",
    [ApiCode.REGION_INIT_FAILED]: "地区站点及数据库初始化失败",
    [ApiCode.REGION_DROP_FAILED]: "地区站点销毁失败",

    [ApiCode.TASK_RUNNING]: "当前已有研判任务正在运行中，请等待完成",
    [ApiCode.TASK_NOT_FOUND]: "未找到对应的任务进度记录",
    [ApiCode.TASK_EMPTY_DATA]: "当前站点暂无未研判的工单数据，请先导入工单",
    [ApiCode.TASK_EXECUTION_FAILED]: "研判流水线执行异常",

    [ApiCode.VOCAB_SEED_FAILED]: "标准词典导入失败",
    [ApiCode.ALIAS_DUPLICATE]: "别名映射规则已存在",
    [ApiCode.ALIAS_NOT_FOUND]: "未找到指定别名规则",

    [ApiCode.FILE_EMPTY]: "上传文件不能为空",
    [ApiCode.FILE_INVALID_FORMAT]: "文件格式不受支持",
    [ApiCode.FILE_SIZE_EXCEEDED]: "文件大小超出限制",
    [ApiCode.FILE_UPLOAD_FAILED]: "文件上传保存失败",

    [ApiCode.AI_SCOUT_FAILED]: "AI 智能提取政务区划失败，请检查网络或重试",
    [ApiCode.AI_SERVICE_UNAVAILABLE]: "AI 大模型服务暂时不可用",
    [ApiCode.AI_PARSE_FAILED]: "大模型返回数据格式解析异常",
  },
  en: {
    [ApiCode.OK]: "Success",
    [ApiCode.BAD_REQUEST]: "Bad Request",
    [ApiCode.INVALID_PARAMS]: "Invalid Parameters",
    [ApiCode.UNAUTHORIZED]: "Unauthorized",
    [ApiCode.FORBIDDEN]: "Forbidden",
    [ApiCode.NOT_FOUND]: "Not Found",
    [ApiCode.INTERNAL_ERROR]: "Internal Server Error",

    [ApiCode.REGION_NOT_FOUND]: "Region not found",
    [ApiCode.REGION_ALREADY_EXISTS]: "Region already exists",
    [ApiCode.REGION_INIT_FAILED]: "Failed to initialize region",
    [ApiCode.REGION_DROP_FAILED]: "Failed to drop region",

    [ApiCode.TASK_RUNNING]: "A task is already running",
    [ApiCode.TASK_NOT_FOUND]: "Task not found",
    [ApiCode.TASK_EMPTY_DATA]: "No pending tickets in current region",
    [ApiCode.TASK_EXECUTION_FAILED]: "Task execution failed",

    [ApiCode.VOCAB_SEED_FAILED]: "Failed to seed vocabulary",
    [ApiCode.ALIAS_DUPLICATE]: "Alias mapping already exists",
    [ApiCode.ALIAS_NOT_FOUND]: "Alias not found",

    [ApiCode.FILE_EMPTY]: "File cannot be empty",
    [ApiCode.FILE_INVALID_FORMAT]: "Unsupported file format",
    [ApiCode.FILE_SIZE_EXCEEDED]: "File size exceeded limit",
    [ApiCode.FILE_UPLOAD_FAILED]: "Failed to upload file",

    [ApiCode.AI_SCOUT_FAILED]: "AI Scout failed to retrieve administrative divisions",
    [ApiCode.AI_SERVICE_UNAVAILABLE]: "AI Service unavailable",
    [ApiCode.AI_PARSE_FAILED]: "Failed to parse AI output",
  },
};

/**
 * 根据状态码获取多语言消息文本
 */
export function getApiMessage(code: ApiCode | string, lang: "zh" | "en" = "zh"): string {
  const dict = API_MESSAGES[lang] || API_MESSAGES.zh;
  return dict[code as ApiCode] || dict[ApiCode.INTERNAL_ERROR];
}

export interface ApiResponseBody<T = any> {
  success: boolean;
  code: ApiCode | string;
  message: string;
  data?: T;
  error?: string;
}

/**
 * 后端辅助构造标准成功响应
 */
export function apiSuccess<T>(data?: T, message?: string, code: ApiCode = ApiCode.OK) {
  const finalMsg = message || getApiMessage(code);
  return Response.json({
    success: true,
    code,
    message: finalMsg,
    data,
  } as ApiResponseBody<T>);
}

/**
 * 后端辅助构造标准错误响应
 */
export function apiError(
  code: ApiCode = ApiCode.BAD_REQUEST,
  overrideMessage?: string,
  status = 400
) {
  const finalMsg = overrideMessage || getApiMessage(code);
  return Response.json(
    {
      success: false,
      code,
      message: finalMsg,
      error: finalMsg,
    } as ApiResponseBody,
    { status }
  );
}

/**
 * 前端辅助解析 API 报错文案
 */
export function resolveApiError(resData: any, fallback = "操作失败，请重试"): string {
  if (!resData) return fallback;
  if (resData.code && API_MESSAGES.zh[resData.code as ApiCode]) {
    return API_MESSAGES.zh[resData.code as ApiCode];
  }
  return resData.message || resData.error || fallback;
}

/**
 * 研判流水线各阶段标准枚举与多语言说明
 */
export enum PipelineStage {
  PARSING = "PARSING",
  EXTRACTING = "EXTRACTING",
  CLUSTERING = "CLUSTERING",
  SYNTHESIZING = "SYNTHESIZING",
  COMPLETED = "COMPLETED",
}

export const STAGE_MESSAGES: Record<"zh" | "en", Record<PipelineStage, string>> = {
  zh: {
    [PipelineStage.PARSING]: "正在解析待研判工单数据...",
    [PipelineStage.EXTRACTING]: "AI 正在提取工单微观地点、涉事主体与核心诉求要素...",
    [PipelineStage.CLUSTERING]: "正在执行多频特征匹配与知识图谱连通子图聚类...",
    [PipelineStage.SYNTHESIZING]: "正在生成公文级处置建议与深层成因分析...",
    [PipelineStage.COMPLETED]: "研判流水线执行完毕",
  },
  en: {
    [PipelineStage.PARSING]: "Parsing ticket dataset...",
    [PipelineStage.EXTRACTING]: "Extracting ticket entities, micro-locations and event types...",
    [PipelineStage.CLUSTERING]: "Building multi-frequency knowledge graph and clustering...",
    [PipelineStage.SYNTHESIZING]: "Generating official action recommendations...",
    [PipelineStage.COMPLETED]: "Analysis pipeline completed",
  },
};

export function getStageMessage(stage: PipelineStage, lang: "zh" | "en" = "zh"): string {
  const dict = STAGE_MESSAGES[lang] || STAGE_MESSAGES.zh;
  return dict[stage] || "";
}

