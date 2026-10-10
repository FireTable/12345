import type { AnonymizeOptions, AnonymizeResult } from "./types";
import { scanSpans } from "./detectors";
import { resolveConflicts } from "./conflict-resolver";
import { Tokenizer } from "./tokenizer";

/**
 * 12345 工单全要素脱敏主函数 (Anonymize)
 *
 * 将原始工单中包含的敏感个人信息（车牌、身份证、电话、私密房号、人名）
 * 安全替换为结构化占位符（如 {{LICENSE_PLATE_1}}），并输出反向映射字典。
 *
 * @param text 原始待脱敏诉求文本
 * @param options 脱敏配置项（指定分类、继承 seedKeymap、占位符风格）
 */
export function anonymize(
  text: string,
  options?: AnonymizeOptions
): AnonymizeResult {
  if (!text || typeof text !== "string") {
    return { text: "", keymap: {}, spans: [] };
  }

  // 1. 扫描所有候选敏感 Span
  const rawSpans = scanSpans(text, options?.categories);
  if (rawSpans.length === 0) {
    return { text, keymap: {}, spans: [] };
  }

  // 2. 仲裁解决重叠与区间嵌套
  const validSpans = resolveConflicts(rawSpans);

  // 3. 初始化双向状态映射机（支持跨节点历史 Keymap 继承）
  const tokenizer = new Tokenizer(options?.seedKeymap);

  // 4. 关键：自右向左（倒序）安全切片替换，严防字符替换后的 index 偏移
  const sortedDesc = [...validSpans].sort((a, b) => b.start - a.start);
  let maskedText = text;

  for (const span of sortedDesc) {
    const token = tokenizer.tokenize(
      span.value,
      span.category,
      options?.bracketStyle
    );
    maskedText =
      maskedText.slice(0, span.start) + token + maskedText.slice(span.end);
  }

  return {
    text: maskedText,
    keymap: tokenizer.getKeymap(),
    spans: validSpans,
  };
}

/**
 * 深度多态反向还原函数 (Deanonymize)
 *
 * 大模型推理完成后，将返回结果中包含的占位符 100% 确定性、无损还原为真实业务实体。
 * 支持字符串（String）、任意复杂对象（Object）及数组（Array）。
 *
 * @param data 待还原的数据（可以是大模型返回的结构化抽取 JSON 对象、公文研判通报或字符串）
 * @param keymap 本次会话由 anonymize 产出的反向映射表
 */
export function deanonymize<T>(data: T, keymap: Record<string, string>): T {
  if (!data || !keymap || Object.keys(keymap).length === 0) {
    return data;
  }

  // 场景 1：普通纯文本字符串快速还原
  if (typeof data === "string") {
    let result: string = data;
    for (const [token, realVal] of Object.entries(keymap)) {
      result = result.replaceAll(token, realVal);
    }
    return result as unknown as T;
  }

  // 场景 2：复杂深度嵌套对象 / 数组（利用底层高效 JSON 序列化单次批量全量替换）
  try {
    let jsonStr = JSON.stringify(data);
    for (const [token, realVal] of Object.entries(keymap)) {
      jsonStr = jsonStr.replaceAll(token, realVal);
    }
    return JSON.parse(jsonStr) as T;
  } catch {
    return data;
  }
}

/**
 * 批量工单脱敏批处理器
 */
export function batchAnonymize(
  texts: string[],
  options?: AnonymizeOptions
): AnonymizeResult[] {
  return texts.map((t) => anonymize(t, options));
}
