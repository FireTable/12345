/**
 * 出站脱敏与安全网关适配层
 * 统一代理并桥接自 @civic/anonymizer 引擎包
 */

import {
  anonymize,
  deanonymize,
  type CivicPiiCategory,
  type AnonymizeOptions,
  type AnonymizeResult,
} from "@civic/anonymizer";

export * from "@civic/anonymizer";

export interface DesensitizeOptions {
  maskPhone?: boolean;
  maskIdCard?: boolean;
  maskEmail?: boolean;
  maskName?: boolean;
  seedKeymap?: Record<string, string>;
}

/**
 * 兼容旧版调用的同步轻量脱敏（直接返回占位符脱敏文本）
 */
export function desensitizeContent(
  content: string,
  options?: DesensitizeOptions
): string {
  if (!content || typeof content !== "string") return "";
  const result = anonymize(
    content,
    options?.seedKeymap ? { seedKeymap: options.seedKeymap } : undefined
  );
  return result.text;
}

/**
 * 模型出站正文生成器：
 * 优先读取已落库的脱敏正文 (maskedContent)，若无则现场执行可逆安全脱敏
 */
export function ticketBodyForAI(
  ticket: {
    content?: string | null;
    maskedContent?: string | null;
  },
  seedKeymap?: Record<string, string>
): string {
  if (typeof ticket.maskedContent === "string" && ticket.maskedContent.length > 0) {
    return ticket.maskedContent;
  }
  return desensitizeContent(
    ticket.content || "",
    seedKeymap ? { seedKeymap } : undefined
  );
}

/**
 * 模型出站标题生成器：
 * 优先读取同批共享 Keymap 预脱敏的 maskedTitle，若无则继承 seedKeymap 现场脱敏 title
 */
export function ticketTitleForAI(
  ticket: {
    title?: string | null;
    maskedTitle?: string | null;
  },
  seedKeymap?: Record<string, string>
): string {
  if (typeof ticket.maskedTitle === "string" && ticket.maskedTitle.length > 0) {
    return ticket.maskedTitle;
  }
  return desensitizeContent(
    ticket.title || "无",
    seedKeymap ? { seedKeymap } : undefined
  );
}
