import * as p from '@clack/prompts';
import type { Lang } from '../core/types.js';

export type BannerOptions = {
  write?: (line: string) => void;
};

const CYAN = '\x1b[38;2;34;211;238m'; // brand cyan
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

// figlet "ANSI Shadow" — each line is exactly 63 chars wide, CJK-safe, no tabs.
const LOGO = [
  '██╗      ██████╗ ██████╗ ███████╗███╗   ███╗███████╗███╗   ███╗',
  '██║     ██╔═══██╗██╔══██╗██╔════╝████╗ ████║██╔════╝████╗ ████║',
  '██║     ██║   ██║██████╔╝█████╗  ██╔████╔██║█████╗  ██╔████╔██║',
  '██║     ██║   ██║██╔══██╗██╔══╝  ██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║',
  '███████╗╚██████╔╝██║  ██║███████╗██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║',
  '╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝',
];

const TAGLINE: Record<Lang, string> = {
  en: 'Long-term memory for AI agents',
  zh: '为 AI Agent 提供长期记忆',
};

function bannerLines(lang: Lang): string[] {
  const tag = TAGLINE[lang] ?? TAGLINE.en;
  return [
    ...LOGO.map((line) => `${CYAN}${BOLD}${line}${NC}`),
    `${DIM}${tag}${NC}`,
  ];
}

/**
 * Open the interactive flow with a large ASCII brand mark, then hand off to
 * Clack's guide line. The logo uses figlet "ANSI Shadow" glyphs: each line is
 * fixed-width so it never misaligns regardless of terminal or CJK width.
 */
export function banner(lang: Lang, opts: BannerOptions = {}): void {
  if (opts.write) {
    bannerLines(lang).forEach((line) => opts.write!(line));
    return;
  }
  console.log();
  bannerLines(lang).forEach((line) => console.log(line));
  console.log();
  p.intro('');
}
