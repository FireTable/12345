/**
 * 完整原文模式（关闭隐私打码，保留 100% 原始数据回填）
 *
 * 工作人员与模型均读 100% 完整真实原文。
 */

export interface DesensitizeOptions {
  maskPhone?: boolean;
  maskIdCard?: boolean;
  maskEmail?: boolean;
  maskName?: boolean;
}

export function desensitizeContent(
  content: string,
  _options?: DesensitizeOptions
): string {
  if (!content || typeof content !== "string") return "";
  return content;
}

/** 模型出站正文：直接使用完整真实原文 */
export function ticketBodyForAI(ticket: {
  content?: string | null;
  maskedContent?: string | null;
}): string {
  return ticket.content || ticket.maskedContent || "";
}
