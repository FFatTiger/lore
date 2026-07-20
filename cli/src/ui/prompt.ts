import type { ChannelId } from '../core/types.js';

export type PromptService = {
  selectMode(): Promise<'external' | 'docker'>;
  askBaseUrl(defaultValue?: string): Promise<string>;
  askToken(): Promise<string>;
  pickChannels(detected: ChannelId[]): Promise<ChannelId[]>;
  pickRelease(): Promise<'stable' | 'pre' | 'dev'>;
  confirm(summary: string): Promise<boolean>;
};

/** Minimal non-interactive stub used when prompts are not wired. */
export function createNullPrompt(): PromptService {
  return {
    async selectMode() {
      return 'external';
    },
    async askBaseUrl(defaultValue = 'http://127.0.0.1:18901') {
      return defaultValue;
    },
    async askToken() {
      return '';
    },
    async pickChannels(detected) {
      return detected;
    },
    async pickRelease() {
      return 'stable';
    },
    async confirm() {
      return true;
    },
  };
}
