import { CivicChatCompletion, CivicChatCompletionParams } from '../types';

export interface ISystemTwoAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  chatCompletions(params: CivicChatCompletionParams): Promise<CivicChatCompletion>;
}
