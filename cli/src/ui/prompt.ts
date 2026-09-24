import * as p from '@clack/prompts';
import type { ChannelId, Lang } from '../core/types.js';
import type { InstallSnapshot } from '../core/snapshot.js';

export type ConnectionMode = 'saas' | 'external' | 'docker';
export type ExistingAction = 'update' | 'reconfigure' | 'manage' | 'uninstall' | 'status' | 'exit';
export type FirstRunAction = ConnectionMode;
export type ReleaseChannel = 'stable' | 'pre' | 'dev';

export const INTERACTIVE_ABORT = 'LORE_INTERACTIVE_ABORT';

export type PromptService = {
  pickLanguage(defaultLang: Lang): Promise<Lang>;
  showStatus(text: string): void;
  pickFirstRunAction(opts?: { initial?: FirstRunAction; dockerAvailable?: boolean }): Promise<FirstRunAction>;
  pickExistingAction(initial?: ExistingAction): Promise<ExistingAction>;
  askBaseUrl(defaultValue?: string): Promise<string>;
  /** Empty answer means "keep existing" / "use the command-line token". */
  askToken(opts?: { required?: boolean; hasExisting?: boolean; hasPreset?: boolean }): Promise<string>;
  pickChannels(opts: {
    /** Channels offered in the picker. */
    choices: ChannelId[];
    /** Channels preselected in the picker. */
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

function isCancel(value: unknown): boolean {
  return p.isCancel(value);
}

function showStatusLines(text: string, lang: Lang): void {
  p.note(text, lang === 'zh' ? '当前配置' : 'Current setup');
}

export function isInteractiveAbort(error: unknown): boolean {
  return error instanceof Error && error.message === INTERACTIVE_ABORT;
}

function abortOnCancel(value: unknown, lang: Lang): asserts value is Exclude<typeof value, symbol> {
  if (isCancel(value)) {
    p.cancel(lang === 'zh' ? '已取消' : 'Cancelled', { withGuide: false });
    throw new Error(INTERACTIVE_ABORT);
  }
}

export function createNullPrompt(): PromptService {
  return {
    async pickLanguage(defaultLang) {
      return defaultLang;
    },
    showStatus() {},
    async pickFirstRunAction(opts) {
      return opts?.initial ?? 'external';
    },
    async pickExistingAction(initial = 'update') {
      return initial;
    },
    async askBaseUrl(defaultValue = 'http://127.0.0.1:18901') {
      return defaultValue;
    },
    async askToken() {
      return '';
    },
    async pickChannels(opts) {
      return opts.defaults.filter((id) => opts.choices.includes(id));
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
  }): Promise<T> {
    const message = args.message;
    if (opts.selectOne) return opts.selectOne({ ...args, message });
    const value = await p.select({
      message,
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
  }): Promise<T[]> {
    const message = args.message;
    if (opts.multiSelect) return opts.multiSelect({ ...args, message });
    const value = await p.multiselect({
      message,
      options: args.options as never,
      initialValues: args.initialValues,
      required: true,
    });
    abortOnCancel(value, lang);
    return value as T[];
  }

  async function textImpl(args: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    initialValue?: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string> {
    const message = args.message;
    if (opts.text) return opts.text({ ...args, message });
    const value = await p.text({
      message,
      placeholder: args.placeholder,
      defaultValue: args.defaultValue,
      initialValue: args.initialValue,
      validate: args.validate ? (value) => args.validate!(value ?? '') : undefined,
    });
    abortOnCancel(value, lang);
    return String(value ?? '');
  }

  async function confirmImpl(args: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean> {
    const message = args.message;
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
      // Do not use p.note(): its box renderer miscalculates CJK/ANSI display width
      // in several terminal emulators and produces broken vertical borders.
      showStatusLines(text, lang);
    },

    async pickFirstRunAction(actionOpts = {}) {
      const dockerAvailable = actionOpts.dockerAvailable ?? true;
      return selectOneImpl({
        message: q(lang, 'Where is your Lore server?', 'Lore 服务端在哪里？'),
        initialValue: actionOpts.initial ?? ('external' as FirstRunAction),
        options: [
          {
            value: 'external' as const,
            label: q(
              lang,
              'Connect to an existing server (client only)',
              '连接已有服务（仅配置客户端）',
            ),
            hint: q(lang, 'URL + token', '地址 + Token'),
          },
          {
            value: 'saas' as const,
            label: q(lang, 'Connect Loremem SaaS', '连接 Loremem SaaS'),
            hint: q(lang, 'token only', '只填 Token'),
          },
          {
            value: 'docker' as const,
            label: q(
              lang,
              'Deploy the server on this machine with Docker',
              '在本机用 Docker 部署服务端',
            ),
            hint: dockerAvailable
              ? q(lang, 'runs docker compose', '会执行 docker compose')
              : q(lang, 'Docker not detected', '未检测到 Docker'),
          },
        ],
      });
    },

    async pickExistingAction(initial = 'update') {
      return selectOneImpl({
        message: q(lang, 'What do you want to do?', '你要做什么？'),
        initialValue: initial,
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
        initialValue: defaultValue,
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
      const hasPreset = tokenOpts.hasPreset ?? false;
      // The command-line token wins over the saved one when left blank; never echo either.
      const message = hasPreset
        ? q(lang, 'API token (Enter uses --api-token)', 'API Token（回车使用 --api-token 传入的值）')
        : hasExisting
          ? q(lang, 'API token (Enter keeps existing)', 'API Token（回车保留已有）')
          : q(lang, 'API token', 'API Token');
      const placeholder = hasPreset
        ? q(lang, 'leave empty to use --api-token', '留空使用 --api-token')
        : hasExisting
          ? q(lang, 'leave empty to keep', '留空保留')
          : 'lm_...';

      for (;;) {
        const value = await textImpl({
          message,
          placeholder,
          defaultValue: '',
        });
        if (value.trim()) return value.trim();
        if (!required || hasExisting || hasPreset) return '';
        p.log.error(q(lang, 'Token is required for SaaS.', 'SaaS 必须填写 Token。'));
      }
    },

    async pickChannels(opts) {
      const options = opts.choices.map((id) => {
        const st = opts.snapshot.channels.find((c) => c.id === id);
        const cliOn = opts.snapshot.detectedChannels.includes(id);
        return {
          value: id,
          label: id,
          hint: `${cliOn ? q(lang, 'detected', '已检测到') : q(lang, 'CLI not found', '未检测到 CLI')} · ${st?.state ?? 'unknown'}`,
        };
      });
      return multiSelectImpl({
        message: q(
          lang,
          `Select channels (${opts.purpose})`,
          `选择渠道（${opts.purpose === 'uninstall' ? '卸载' : '安装'}）`,
        ),
        options,
        initialValues: opts.defaults.filter((id) => opts.choices.includes(id)),
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
