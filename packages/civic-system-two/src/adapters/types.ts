import { CivicChatCompletion, CivicChatCompletionParams, CivicChatStreamChunk } from '../types';

export interface ISystemTwoAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  chatCompletions(params: CivicChatCompletionParams): Promise<CivicChatCompletion>;
  chatCompletionsStream?(params: CivicChatCompletionParams): AsyncGenerator<CivicChatStreamChunk>;
}
