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
  const seededKeymap = options?.seedKeymap ? { ...options.seedKeymap } : {};
  if (!text || typeof text !== "string") {
    return { text: "", keymap: seededKeymap, spans: [] };
  }

  // 1. 扫描所有候选敏感 Span
  const rawSpans = scanSpans(text, options?.categories);
  if (rawSpans.length === 0) {
    return { text, keymap: seededKeymap, spans: [] };
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

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 深度多态反向还原函数 (Deanonymize)
 *
 * 大模型推理完成后，将返回结果中包含的占位符 100% 确定性、无损还原为真实业务实体。
 * 支持字符串（String）、任意复杂对象（Object）及数组（Array），采用递归深拷贝 + 单次正则回调替换，
 * 免疫 JSON 引号/反斜杠/换行破坏、$&/$1 二次解释、Date 丢失与循环引用，且不修改输入对象。
 *
 * @param data 待还原的数据（可以是大模型返回的结构化抽取 JSON 对象、公文研判通报或字符串）
 * @param keymap 本次会话由 anonymize 产出的反向映射表
 */
export function deanonymize<T>(data: T, keymap: Record<string, string>): T {
  if (data === null || data === undefined || !keymap) {
    return data;
  }

  const keys = Object.keys(keymap)
    .filter((k) => k.length > 0)
    .sort((a, b) => b.length - a.length);
  if (keys.length === 0) {
    return data;
  }

  const tokenRe = new RegExp(keys.map(escapeRegExp).join("|"), "g");
  const replaceTokens = (str: string): string =>
    str.replace(tokenRe, (matched) => keymap[matched] ?? matched);

  if (typeof data === "string") {
    return replaceTokens(data) as unknown as T;
  }

  if (typeof data !== "object") {
    return data;
  }

  const visited = new WeakMap<object, unknown>();

  const cloneAndRestore = (val: unknown): unknown => {
    if (val === null || val === undefined) {
      return val;
    }
    if (typeof val === "string") {
      return replaceTokens(val);
    }
    if (typeof val !== "object") {
      return val;
    }
    if (val instanceof Date) {
      return new Date(val.getTime());
    }
    if (val instanceof RegExp) {
      return new RegExp(val.source, val.flags);
    }
    if (ArrayBuffer.isView(val)) {
      return val;
    }

    const obj = val as object;
    if (visited.has(obj)) {
      return visited.get(obj);
    }

    if (Array.isArray(val)) {
      const arr: unknown[] = [];
      visited.set(obj, arr);
      for (const item of val) {
        arr.push(cloneAndRestore(item));
      }
      return arr;
    }

    const proto = Object.getPrototypeOf(obj);
    const out: Record<string, unknown> = proto === null ? Object.create(null) : {};
    visited.set(obj, out);
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      Object.defineProperty(out, k, {
        value: cloneAndRestore(v),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  };

  return cloneAndRestore(data) as T;
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
