import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ALL_CHANNELS, type ChannelId, type Lang } from '../core/types.js';

export type PromptService = {
  selectMode(): Promise<'external' | 'docker'>;
  askBaseUrl(defaultValue?: string): Promise<string>;
  askToken(): Promise<string>;
  pickChannels(detected: ChannelId[]): Promise<ChannelId[]>;
  pickRelease(): Promise<'stable' | 'pre' | 'dev'>;
  confirm(summary: string): Promise<boolean>;
};

export type CreateTTYPromptOptions = {
  lang?: Lang;
  /** Injectable IO for tests. */
  io?: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream };
};

function q(lang: Lang, en: string, zh: string): string {
  return lang === 'zh' ? zh : en;
}

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
      return detected.length ? detected : [...ALL_CHANNELS];
    },
    async pickRelease() {
      return 'stable';
    },
    async confirm() {
      return true;
    },
  };
}

/**
 * Interactive prompt service for TTY install flows.
 * Uses plain readline (no extra dependency) so `npx @loremem/cli` asks before installing.
 */
export function createTTYPrompt(opts: CreateTTYPromptOptions = {}): PromptService {
  const lang: Lang = opts.lang ?? 'en';
  const io = opts.io ?? { input, output };

  async function withRl<T>(fn: (rl: readline.Interface) => Promise<T>): Promise<T> {
    const rl = readline.createInterface({
      input: io.input as typeof input,
      output: io.output as typeof output,
      terminal: true,
    });
    try {
      return await fn(rl);
    } finally {
      rl.close();
    }
  }

  async function ask(rl: readline.Interface, prompt: string, defaultValue = ''): Promise<string> {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const answer = await rl.question(`${prompt}${suffix}: `);
    const trimmed = answer.trim();
    return trimmed || defaultValue;
  }

  return {
    async selectMode() {
      return withRl(async (rl) => {
        output.write(
          q(
            lang,
            '\nInstall mode:\n  1) Connect to an existing Lore server (SaaS / external)\n  2) Start or update local Docker Lore\n',
            '\n安装模式：\n  1) 连接已有 Lore 服务（SaaS / 外部）\n  2) 启动或更新本机 Docker Lore\n',
          ),
        );
        const answer = await ask(
          rl,
          q(lang, 'Choose 1 or 2', '选择 1 或 2'),
          '1',
        );
        return answer.startsWith('2') ? 'docker' : 'external';
      });
    },

    async askBaseUrl(defaultValue = 'http://127.0.0.1:18901') {
      return withRl(async (rl) => {
        const value = await ask(
          rl,
          q(lang, 'Lore base URL', 'Lore 服务地址'),
          defaultValue,
        );
        return value.replace(/\/$/, '');
      });
    },

    async askToken() {
      return withRl(async (rl) => {
        // Do not echo is hard with readline promises; ask clearly that it will be stored locally.
        const value = await ask(
          rl,
          q(
            lang,
            'API token (stored in ~/.lore/config.json, leave empty to keep existing)',
            'API Token（写入 ~/.lore/config.json，回车保留已有）',
          ),
          '',
        );
        return value;
      });
    },

    async pickChannels(detected: ChannelId[]) {
      return withRl(async (rl) => {
        const defaults = detected.length ? detected : [...ALL_CHANNELS];
        output.write(
          q(
            lang,
            `\nChannels (comma-separated):\n  ${ALL_CHANNELS.join(', ')}\nDetected CLIs default: ${defaults.join(', ') || '(none)'}\n`,
            `\n安装渠道（逗号分隔）：\n  ${ALL_CHANNELS.join(', ')}\n已检测到 CLI，默认：${defaults.join(', ') || '（无）'}\n`,
          ),
        );
        const answer = await ask(
          rl,
          q(lang, 'Channels', '渠道'),
          defaults.join(','),
        );
        const parts = answer
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean) as ChannelId[];
        const valid = parts.filter((p) => ALL_CHANNELS.includes(p));
        if (!valid.length) return defaults;
        return valid;
      });
    },

    async pickRelease() {
      return withRl(async (rl) => {
        output.write(
          q(
            lang,
            '\nRelease channel:\n  1) stable\n  2) pre\n  3) dev\n',
            '\n发布通道：\n  1) stable\n  2) pre\n  3) dev\n',
          ),
        );
        const answer = await ask(rl, q(lang, 'Choose 1/2/3', '选择 1/2/3'), '1');
        if (answer.startsWith('3') || answer === 'dev') return 'dev';
        if (answer.startsWith('2') || answer === 'pre') return 'pre';
        return 'stable';
      });
    },

    async confirm(summary: string) {
      return withRl(async (rl) => {
        output.write(`\n${summary}\n`);
        const answer = await ask(
          rl,
          q(lang, 'Proceed? [Y/n]', '确认开始？[Y/n]'),
          'Y',
        );
        return !/^n(o)?$/i.test(answer.trim());
      });
    },
  };
}
