import * as p from '@clack/prompts';
import { ALL_CHANNELS, type ChannelId, type Lang } from '../core/types.js';
import type { InstallSnapshot } from '../core/snapshot.js';

export type ConnectionMode = 'saas' | 'external' | 'docker';
export type ExistingAction = 'update' | 'reconfigure' | 'manage' | 'uninstall' | 'status' | 'exit';
export type FirstRunAction = ConnectionMode;
export type ReleaseChannel = 'stable' | 'pre' | 'dev';

export type PromptService = {
  pickLanguage(defaultLang: Lang): Promise<Lang>;
  showStatus(text: string): void;
  pickFirstRunAction(): Promise<FirstRunAction>;
  pickExistingAction(): Promise<ExistingAction>;
  askBaseUrl(defaultValue?: string): Promise<string>;
  askToken(opts?: { required?: boolean; hasExisting?: boolean }): Promise<string>;
  pickChannels(opts: {
    defaults: ChannelId[];
    snapshot: InstallSnapshot;
    purpose: 'install' | 'uninstall';
  }): Promise<ChannelId[]>;
  pickRelease(defaultRelease?: ReleaseChannel): Promise<ReleaseChannel>;
  confirm(summary: string): Promise<boolean>;
  askYesNo(question: string, defaultYes?: boolean): Promise<boolean>;
};

export type CreateTTYPromptOptions = {
  lang?: Lang;
  /**
   * Test doubles — when provided, skip @clack and return these results.
   * Production path uses @clack/prompts (arrow keys / space / enter).
   */
  selectOne?: <T>(opts: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValue?: T;
  }) => Promise<T>;
  multiSelect?: <T>(opts: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValues?: T[];
  }) => Promise<T[]>;
  text?: (opts: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    validate?: (value: string) => string | undefined;
  }) => Promise<string>;
  confirmFn?: (opts: { message: string; initialValue?: boolean }) => Promise<boolean>;
};

function q(lang: Lang, en: string, zh: string): string {
  return lang === 'zh' ? zh : en;
}

/** Keybinding hints shown on every interactive step. */
function keysSelect(lang: Lang): string {
  return q(lang, '↑/↓ move · enter confirm', '↑/↓ 选择 · enter 确认');
}

function keysMulti(lang: Lang): string {
  return q(
    lang,
    '↑/↓ move · space toggle · a all · n none · enter confirm',
    '↑/↓ 移动 · space 勾选 · a 全选 · n 清空 · enter 确认',
  );
}

function keysConfirm(lang: Lang): string {
  return q(lang, '←/→ or ↑/↓ toggle · enter confirm', '←/→ 或 ↑/↓ 切换 · enter 确认');
}

function keysText(lang: Lang): string {
  return q(lang, 'type value · enter confirm',
    '输入内容 · enter 确认');
}

function withKeys(message: string, keys: string): string {
  return `${message}
${keys}`;
}

function isCancel(value: unknown): boolean {
  return p.isCancel(value);
}

function abortOnCancel(value: unknown, lang: Lang): asserts value is Exclude<typeof value, symbol> {
  if (isCancel(value)) {
    p.cancel(lang === 'zh' ? '已取消。' : 'Aborted.');
    throw new Error('Aborted');
  }
}

export function createNullPrompt(): PromptService {
  return {
    async pickLanguage(defaultLang) {
      return defaultLang;
    },
    showStatus() {},
    async pickFirstRunAction() {
      return 'saas';
    },
    async pickExistingAction() {
      return 'update';
    },
    async askBaseUrl(defaultValue = 'http://127.0.0.1:18901') {
      return defaultValue;
    },
    async askToken() {
      return '';
    },
    async pickChannels(opts) {
      return opts.defaults.length ? opts.defaults : [...ALL_CHANNELS];
    },
    async pickRelease(defaultRelease = 'stable') {
      return defaultRelease;
    },
    async confirm() {
      return true;
    },
    async askYesNo(_q, defaultYes = true) {
      return defaultYes;
    },
  };
}

export function createTTYPrompt(opts: CreateTTYPromptOptions = {}): PromptService {
  let lang: Lang = opts.lang ?? 'en';

  async function selectOneImpl<T>(args: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValue?: T;
    /** Override keybinding hint; default is ↑/↓ · enter */
    keys?: string;
  }): Promise<T> {
    const message = withKeys(args.message, args.keys ?? keysSelect(lang));
    if (opts.selectOne) return opts.selectOne({ ...args, message });
    const value = await p.select({
      message,
      // clack Option typing is invariant over value; cast for generic helper
      options: args.options as never,
      initialValue: args.initialValue,
    });
    abortOnCancel(value, lang);
    return value as T;
  }

  async function multiSelectImpl<T>(args: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValues?: T[];
    keys?: string;
  }): Promise<T[]> {
    const message = withKeys(args.message, args.keys ?? keysMulti(lang));
    if (opts.multiSelect) return opts.multiSelect({ ...args, message });
    const value = await p.multiselect({
      message,
      options: args.options as never,
      initialValues: args.initialValues,
      required: false,
    });
    abortOnCancel(value, lang);
    return value as T[];
  }

  async function textImpl(args: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    validate?: (value: string) => string | undefined;
    keys?: string;
  }): Promise<string> {
    const message = withKeys(args.message, args.keys ?? keysText(lang));
    if (opts.text) return opts.text({ ...args, message });
    const value = await p.text({
      message,
      placeholder: args.placeholder,
      defaultValue: args.defaultValue,
      validate: args.validate,
    });
    abortOnCancel(value, lang);
    return String(value ?? '');
  }

  async function confirmImpl(args: {
    message: string;
    initialValue?: boolean;
    keys?: string;
  }): Promise<boolean> {
    const message = withKeys(args.message, args.keys ?? keysConfirm(lang));
    if (opts.confirmFn) return opts.confirmFn({ ...args, message });
    const value = await p.confirm({
      message,
      initialValue: args.initialValue ?? true,
    });
    abortOnCancel(value, lang);
    return Boolean(value);
  }

  return {
    async pickLanguage(defaultLang) {
      const value = await selectOneImpl({
        message: 'Language / 语言',
        keys: '↑/↓ move · enter confirm  |  ↑/↓ 选择 · enter 确认',
        initialValue: defaultLang,
        options: [
          { value: 'en' as Lang, label: 'English' },
          { value: 'zh' as Lang, label: '中文' },
        ],
      });
      lang = value;
      return lang;
    },

    showStatus(text: string) {
      // Clack note keeps formatting without fighting the spinner/select redraw
      p.note(text, lang === 'zh' ? '当前状态' : 'Current status');
    },

    async pickFirstRunAction() {
      return selectOneImpl({
        message: q(lang, 'What do you want to do?', '你要做什么？'),
        initialValue: 'saas' as FirstRunAction,
        options: [
          {
            value: 'saas' as const,
            label: q(lang, 'Connect Loremem SaaS', '连接 Loremem SaaS'),
            hint: q(lang, 'token only', '只填 Token'),
          },
          {
            value: 'external' as const,
            label: q(lang, 'Connect external server', '连接外部服务'),
            hint: q(lang, 'URL + token', '地址 + Token'),
          },
          {
            value: 'docker' as const,
            label: q(lang, 'Local Docker self-host', '本机 Docker 自托管'),
          },
        ],
      });
    },

    async pickExistingAction() {
      return selectOneImpl({
        message: q(lang, 'What do you want to do?', '你要做什么？'),
        initialValue: 'update' as ExistingAction,
        options: [
          {
            value: 'update' as const,
            label: q(lang, 'Update selected plugins', '更新所选插件'),
            hint: q(lang, 'keep server/token', '保留服务与 Token'),
          },
          {
            value: 'reconfigure' as const,
            label: q(lang, 'Reconfigure connection', '重新配置连接'),
            hint: 'SaaS / external / Docker',
          },
          {
            value: 'manage' as const,
            label: q(lang, 'Manage plugins only', '仅管理插件'),
          },
          {
            value: 'uninstall' as const,
            label: q(lang, 'Uninstall plugins', '卸载插件'),
          },
          {
            value: 'status' as const,
            label: q(lang, 'Status only / exit', '只看状态 / 退出'),
          },
        ],
      });
    },

    async askBaseUrl(defaultValue = 'http://127.0.0.1:18901') {
      const value = await textImpl({
        message: q(lang, 'Server base URL', '服务地址'),
        defaultValue,
        placeholder: defaultValue,
        validate: (v) => {
          const s = (v ?? '').trim() || defaultValue;
          if (!s) return q(lang, 'URL is required', '必须填写地址');
          return undefined;
        },
      });
      return (value.trim() || defaultValue).replace(/\/$/, '');
    },

    async askToken(tokenOpts = {}) {
      const required = tokenOpts.required ?? false;
      const hasExisting = tokenOpts.hasExisting ?? false;
      const message = hasExisting
        ? q(lang, 'API token (Enter keeps existing)', 'API Token（回车保留已有）')
        : q(lang, 'API token', 'API Token');

      for (;;) {
        const value = await textImpl({
          message,
          placeholder: hasExisting ? q(lang, 'leave empty to keep', '留空保留') : 'lm_...',
          defaultValue: '',
        });
        if (value.trim()) return value.trim();
        if (!required || hasExisting) return '';
        p.log.error(q(lang, 'Token is required for SaaS.', 'SaaS 必须填写 Token。'));
      }
    },

    async pickChannels(opts) {
      const defaults = opts.defaults.length ? opts.defaults : [...ALL_CHANNELS];
      const options = ALL_CHANNELS.map((id) => {
        const st = opts.snapshot.channels.find((c) => c.id === id);
        const cliOn = opts.snapshot.detectedChannels.includes(id);
        return {
          value: id,
          label: id,
          hint: `CLI:${cliOn ? 'yes' : 'no'} · ${st?.state ?? 'unknown'}`,
        };
      });
      return multiSelectImpl({
        message: q(
          lang,
          `Select channels (${opts.purpose})`,
          `选择渠道（${opts.purpose === 'uninstall' ? '卸载' : '安装'}）`,
        ),
        options,
        initialValues: defaults,
      });
    },

    async pickRelease(defaultRelease = 'stable') {
      return selectOneImpl({
        message: q(lang, 'Release channel', '发布通道'),
        initialValue: defaultRelease,
        options: [
          { value: 'stable' as const, label: 'stable' },
          { value: 'pre' as const, label: 'pre' },
          { value: 'dev' as const, label: 'dev' },
        ],
      });
    },

    async confirm(summary: string) {
      p.note(summary, lang === 'zh' ? '确认' : 'Summary');
      return confirmImpl({
        message: q(lang, 'Proceed?', '确认开始？'),
        initialValue: true,
      });
    },

    async askYesNo(question: string, defaultYes = true) {
      return confirmImpl({
        message: question,
        initialValue: defaultYes,
      });
    },
  };
}
