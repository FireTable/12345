import { z } from 'zod';

export interface SplitContentResult {
  content: string;
  reasoning_content?: string;
}

/**
 * 从原始模型输出文本中提取 <think>...</think> 思维链，
 * 并将其与纯正文分离。
 */
export function extractReasoningAndContent(
  rawContent: string,
  existingReasoning?: string
): SplitContentResult {
  if (existingReasoning && existingReasoning.trim().length > 0) {
    return {
      content: rawContent.trim(),
      reasoning_content: existingReasoning.trim(),
    };
  }

  if (!rawContent) {
    return { content: '' };
  }

  const thinkRegex = /<think>([\s\S]*?)<\/think>/i;
  const match = rawContent.match(thinkRegex);

  if (match) {
    const reasoning = match[1].trim();
    const content = rawContent.replace(thinkRegex, '').trim();
    return {
      content,
      reasoning_content: reasoning.length > 0 ? reasoning : undefined,
    };
  }

  // 极端边界情况：模型输出了 <think> 但被截断没有闭合 </think>
  const unclosedThinkRegex = /<think>([\s\S]*)$/i;
  const unclosedMatch = rawContent.match(unclosedThinkRegex);
  if (unclosedMatch) {
    return {
      content: '',
      reasoning_content: unclosedMatch[1].trim(),
    };
  }

  return {
    content: rawContent.trim(),
  };
}

/**
 * 从可能包裹了 Markdown 语法块的代码中提取干净的 JSON 字符串
 */
export function cleanJsonFences(text: string): string {
  let cleaned = text.trim();

  // 匹配 ```json ... ``` 或 ``` ... ```
  const codeBlockRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;
  const match = cleaned.match(codeBlockRegex);
  if (match) {
    cleaned = match[1].trim();
  }

  // 如果依然不是以 { 或 [ 开头，尝试抓取第一个 { / [ 到最后一个 } / ]
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');

  let startIdx = -1;
  let endIdx = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    endIdx = cleaned.lastIndexOf('}');
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    endIdx = cleaned.lastIndexOf(']');
  }

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleaned = cleaned.slice(startIdx, endIdx + 1).trim();
  }

  return cleaned;
}

/**
 * 健壮地解析 JSON 并支持可选的 Zod 校验
 */
export function parseStructuredJson<T = unknown>(
  rawText: string,
  schema?: z.ZodType<T>
): T {
  if (!rawText || rawText.trim().length === 0) {
    throw new Error(
      `[SystemTwo:EmptyJsonOutput] 模型生成的正文为空（可能是 max_tokens 预算不足被思维链提前耗尽）。建议增大 max_tokens 或在结构化抽取任务中设置 enable_thinking: false。`
    );
  }

  const jsonStr = cleanJsonFences(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonStr);
  } catch (err: any) {
    throw new Error(
      `[SystemTwo:JsonParserError] 无法解析模型生成的 JSON: ${err.message}\n原始输入:\n${rawText}`
    );
  }

  if (schema) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
      if (parsed && typeof parsed === 'object' && (parsed as any).fallback === true) {
        throw new Error(
          `[SystemTwo:OfflineFailsafe] 系统当前处于离线兜底模式，无法满足调用方 Schema 要求: ${(parsed as any).message}`
        );
      }
      throw new Error(
        `[SystemTwo:JsonValidationError] JSON 结果未通过 Schema 校验: ${result.error.message}\n解析对象: ${JSON.stringify(
          parsed
        )}`
      );
    }
    return result.data;
  }

  return parsed as T;
}
