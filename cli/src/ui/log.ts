export type LoggerWrite = (line: string) => void;

export type LoggerOptions = {
  write?: LoggerWrite;
};

export type Logger = {
  info: (msg: string) => void;
  ok: (msg: string) => void;
  warn: (msg: string) => void;
  err: (msg: string) => void;
  section: (title: string) => void;
};

const BLUE = '\x1b[0;34m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const RED = '\x1b[0;31m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

export function createLogger(opts: LoggerOptions = {}): Logger {
  const write = opts.write ?? ((line: string) => console.log(line));

  return {
    info(msg: string) {
      write(`${BLUE}→${NC} ${msg}`);
    },
    ok(msg: string) {
      write(`${GREEN}✓${NC} ${msg}`);
    },
    warn(msg: string) {
      write(`${YELLOW}!${NC} ${msg}`);
    },
    err(msg: string) {
      write(`${RED}✗${NC} ${msg}`);
    },
    section(title: string) {
      write('');
      write(`${BOLD}── ${title}${NC}`);
    },
  };
}
