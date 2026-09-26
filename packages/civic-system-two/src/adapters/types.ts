import { CivicChatCompletion, CivicChatCompletionParams } from '../types.js';

export interface ISystemTwoAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  chatCompletions(params: CivicChatCompletionParams): Promise<CivicChatCompletion>;
}
