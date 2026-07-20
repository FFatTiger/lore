import type { Lang } from '../core/types.js';

export type BannerOptions = {
  write?: (line: string) => void;
};

const BLUE = '\x1b[0;34m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

const LOGO = [
  ' _     ____  ____  _____ ',
  '/ \\   /  _ \\/  __\\/  __/ ',
  '| |   | / \\||  \\/||  \\   ',
  '| |_/\\| \\_/||    /|  /_  ',
  '\\____/\\____/\\_/\\_\\\\____\\ ',
  '                        ',
];

const TAGLINES: Record<Lang, [string, string]> = {
  en: [
    '  Lore — long-term memory for AI agents',
    '  One install script, all agent runtimes.',
  ],
  zh: [
    '  Lore — AI Agent 长期记忆',
    '  一条安装脚本，接入所有 Agent 运行时',
  ],
};

export function banner(lang: Lang, opts: BannerOptions = {}): void {
  const write = opts.write ?? ((line: string) => console.log(line));
  const [tag0, tag1] = TAGLINES[lang] ?? TAGLINES.en;

  write('');
  write(`${BLUE}${BOLD}${LOGO[0]}${NC}`);
  write(`${BLUE}${BOLD}${LOGO[1]}${NC}${tag0}`);
  write(`${BLUE}${BOLD}${LOGO[2]}${NC}`);
  write(`${BLUE}${BOLD}${LOGO[3]}${NC}${tag1}`);
  write(`${BLUE}${BOLD}${LOGO[4]}${NC}`);
  write(`${BLUE}${BOLD}${LOGO[5]}${NC}`);
  write('');
}
