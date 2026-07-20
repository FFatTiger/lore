import type { Lang } from '../core/types.js';

type Messages = Record<string, string>;

const en: Messages = {
  'install.complete': 'Install complete ({version})',
  'install.partial': 'Install finished with errors ({version}) — {ok} ok, {failed} failed, {skipped} skipped',
  'install.failed': 'Install failed ({version}) — {ok} ok, {failed} failed, {skipped} skipped',
  'install.no_channels': 'Install failed — no channels selected',
  'install.release_unknown':
    'Could not resolve GitHub release version. Plugin downloads will fail until this succeeds.',
  'install.release_unknown_detail': '{detail}',
  'install.summary_ok': 'ok: {ok}',
  'install.summary_failed': 'failed: {failed}',
  'install.summary_skipped': 'skipped: {skipped}',
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
  'install.partial': '安装结束但有错误（{version}）— 成功 {ok}，失败 {failed}，跳过 {skipped}',
  'install.failed': '安装失败（{version}）— 成功 {ok}，失败 {failed}，跳过 {skipped}',
  'install.no_channels': '安装失败 — 未选择任何渠道',
  'install.release_unknown': '无法解析 GitHub 发布版本。在成功解析前插件包无法下载。',
  'install.release_unknown_detail': '{detail}',
  'install.summary_ok': '成功：{ok}',
  'install.summary_failed': '失败：{failed}',
  'install.summary_skipped': '跳过：{skipped}',
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
