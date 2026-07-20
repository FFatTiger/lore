import { ALL_CHANNELS, type ChannelId, type Lang } from './types.js';

export type GlobalArgs = {
  command: 'install' | 'update' | 'uninstall' | 'status' | 'help';
  baseUrl?: string;
  apiToken?: string;
  channels?: ChannelId[];
  skipDocker: boolean;
  force: boolean;
  pre: boolean;
  dev: boolean;
  lang?: Lang;
  yes: boolean;
  purge: boolean;
  help: boolean;
  explicitBaseUrl: boolean;
  explicitApiToken: boolean;
  interactiveDefault: boolean;
};

const COMMANDS = new Set(['install', 'update', 'uninstall', 'status', 'help', 'connect']);

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseChannels(raw: string): ChannelId[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Unknown channel: (empty)');
  }
  const out: ChannelId[] = [];
  for (const part of parts) {
    if (!ALL_CHANNELS.includes(part as ChannelId)) {
      throw new Error(`Unknown channel: ${part}`);
    }
    out.push(part as ChannelId);
  }
  return out;
}

export function parseArgv(argv: string[]): GlobalArgs {
  const result: GlobalArgs = {
    command: 'install',
    skipDocker: false,
    force: false,
    pre: false,
    dev: false,
    yes: false,
    purge: false,
    help: false,
    explicitBaseUrl: false,
    explicitApiToken: false,
    interactiveDefault: false,
  };

  let i = 0;
  let sawCommand = false;
  let sawAnyFlag = false;

  if (argv.length > 0 && !argv[0].startsWith('-')) {
    const cmd = argv[0];
    if (!COMMANDS.has(cmd)) {
      throw new Error(`Unknown command: ${cmd}`);
    }
    result.command = cmd === 'connect' ? 'install' : (cmd as GlobalArgs['command']);
    sawCommand = true;
    i = 1;
  }

  while (i < argv.length) {
    const token = argv[i];
    if (!token.startsWith('-')) {
      throw new Error(`Unknown argument: ${token}`);
    }
    sawAnyFlag = true;

    switch (token) {
      case '--base-url': {
        result.baseUrl = requireValue(token, argv[++i]);
        result.explicitBaseUrl = true;
        break;
      }
      case '--api-token': {
        result.apiToken = requireValue(token, argv[++i]);
        result.explicitApiToken = true;
        break;
      }
      case '--channels': {
        result.channels = parseChannels(requireValue(token, argv[++i]));
        break;
      }
      case '--lang': {
        const v = requireValue(token, argv[++i]);
        if (v !== 'en' && v !== 'zh') {
          throw new Error(`Invalid lang: ${v} (expected en|zh)`);
        }
        result.lang = v;
        break;
      }
      case '--skip-docker':
        result.skipDocker = true;
        break;
      case '--force':
        result.force = true;
        break;
      case '--pre':
        result.pre = true;
        break;
      case '--dev':
        result.dev = true;
        break;
      case '--yes':
      case '-y':
        result.yes = true;
        break;
      case '--purge':
        result.purge = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${token}`);
    }
    i += 1;
  }

  // No command + no flags → interactive default install
  if (!sawCommand && !sawAnyFlag) {
    result.interactiveDefault = true;
  }

  return result;
}
