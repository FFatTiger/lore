import type { Lang } from '../core/types.js';

type Messages = Record<string, string>;

const en: Messages = {
  'install.complete': 'Install complete ({version})',
  'restart.next': 'Next: restart agent runtimes, then open {baseUrl}/setup',
  'restart.codex_hooks': 'Codex: open /hooks and trust Lore hooks if prompted',
  'restart.codex_plugins':
    'Codex: if /plugins still shows Lore as installable, install it manually',
  'docker.skip': 'Skipping Docker',
  'docker.external': 'Using external Lore server',
  'docker.saved_external': 'Using saved external server',
  'config.path': 'Config: {path}',
  'setup.url': 'Setup: {baseUrl}/setup',
};

const zh: Messages = {
  'install.complete': '安装完成（{version}）',
  'restart.next': '下一步：重启 Agent，然后打开 {baseUrl}/setup',
  'restart.codex_hooks': 'Codex：打开 /hooks，按提示信任 Lore hooks',
  'restart.codex_plugins': 'Codex：如果 /plugins 仍显示 Lore 可安装，手动安装即可',
  'docker.skip': '跳过 Docker',
  'docker.external': '使用外部 Lore 服务',
  'docker.saved_external': '使用已保存的外部服务',
  'config.path': '配置：{path}',
  'setup.url': '设置：{baseUrl}/setup',
};

const tables: Record<Lang, Messages> = { en, zh };

function applyVars(template: string, vars?: Record<string, string>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match,
  );
}

export function t(lang: Lang, key: string, vars?: Record<string, string>): string {
  const table = tables[lang] ?? tables.en;
  const template = table[key] ?? tables.en[key] ?? key;
  return applyVars(template, vars);
}
