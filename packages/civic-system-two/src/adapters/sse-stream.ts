import { CivicChatStreamChunk, CivicTimings, CivicUsage } from '../types';
import { ThinkStreamSplitter } from '../parser';
import { createAbortError } from './abort-utils';

export interface SseStreamOptions {
  res: Response;
  endpoint: string | null;
  externalSignal?: AbortSignal;
  abortCombined: (reason?: unknown) => void;
  cleanup: () => void;
  onComplete?: (summary: {
    usage?: CivicUsage;
    timings?: CivicTimings;
    approxCompletionChunks: number;
  }) => void;
}

export async function* readOpenAISseStream(
  options: SseStreamOptions
): AsyncGenerator<CivicChatStreamChunk> {
  const { res, endpoint, externalSignal, abortCombined, cleanup, onComplete } = options;
  if (!res.body) {
    cleanup();
    throw new Error('Streaming response body is empty');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const splitter = new ThinkStreamSplitter();
  let lineBuffer = '';
  let sawDone = false;
  let lastUsage: CivicUsage | undefined;
  let lastTimings: CivicTimings | undefined;
  let approxCompletionChunks = 0;

  const processLine = (rawLine: string): { done: boolean; chunk?: CivicChatStreamChunk } => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) return { done: false };
    if (!line.startsWith('data:')) return { done: false };

    const dataStr = line.slice(5).trim();
    if (!dataStr) return { done: false };
    if (dataStr === '[DONE]') return { done: true };

    let parsed: any;
    try {
      parsed = JSON.parse(dataStr);
    } catch {
      return { done: false };
    }

    if (parsed?.error?.message) {
      throw new Error(String(parsed.error.message));
    }

    if (parsed?.usage) lastUsage = parsed.usage as CivicUsage;
    if (parsed?.timings) lastTimings = parsed.timings as CivicTimings;

    const choice = parsed?.choices?.[0];
    const delta = choice?.delta || {};
    const rawContent = typeof delta.content === 'string' ? delta.content : '';
    const rawReasoning =
      typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string'
          ? delta.reasoning
          : '';
    const finishReason: string | null = choice?.finish_reason ?? null;

    const split = rawContent ? splitter.push(rawContent) : { content: '', reasoning: '' };
    const deltaContent = split.content;
    const deltaReasoning = `${rawReasoning}${split.reasoning}`;

    if (deltaContent || deltaReasoning) {
      approxCompletionChunks += 1;
    }

    if (!deltaContent && !deltaReasoning && finishReason === null && !parsed?.usage && !parsed?.timings) {
      return { done: false };
    }

    const chunk: CivicChatStreamChunk = { endpoint };
    if (deltaContent) chunk.deltaContent = deltaContent;
    if (deltaReasoning) chunk.deltaReasoning = deltaReasoning;
    if (finishReason !== null) chunk.finishReason = finishReason;
    if (parsed?.usage) chunk.usage = parsed.usage as CivicUsage;
    if (parsed?.timings) chunk.timings = parsed.timings as CivicTimings;
    return { done: false, chunk };
  };

  try {
    while (!sawDone) {
      if (externalSignal?.aborted) {
        throw createAbortError(externalSignal);
      }

      const { value, done } = await reader.read();
      if (externalSignal?.aborted) {
        throw createAbortError(externalSignal);
      }

      if (done) {
        lineBuffer += decoder.decode();
        if (lineBuffer) {
          const lines = lineBuffer.split(/\r?\n/);
          lineBuffer = '';
          for (const line of lines) {
            const outcome = processLine(line);
            if (outcome.chunk) yield outcome.chunk;
            if (outcome.done) {
              sawDone = true;
              break;
            }
          }
        }
        break;
      }

      lineBuffer += decoder.decode(value, { stream: true });
      const parts = lineBuffer.split(/\r?\n/);
      lineBuffer = parts.pop() ?? '';

      for (const line of parts) {
        const outcome = processLine(line);
        if (outcome.chunk) yield outcome.chunk;
        if (outcome.done) {
          sawDone = true;
          break;
        }
      }
    }

    if (externalSignal?.aborted) {
      throw createAbortError(externalSignal);
    }

    const flushed = splitter.flush();
    if (flushed.content || flushed.reasoning) {
      const chunk: CivicChatStreamChunk = { endpoint };
      if (flushed.content) chunk.deltaContent = flushed.content;
      if (flushed.reasoning) chunk.deltaReasoning = flushed.reasoning;
      if (lastUsage) chunk.usage = lastUsage;
      if (lastTimings) chunk.timings = lastTimings;
      yield chunk;
    }

    onComplete?.({ usage: lastUsage, timings: lastTimings, approxCompletionChunks });
  } catch (err) {
    if (externalSignal?.aborted) {
      throw createAbortError(externalSignal);
    }
    throw err;
  } finally {
    cleanup();
    await reader.cancel().catch(() => {});
    abortCombined();
  }
}
