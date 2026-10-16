import { ALL_CHANNELS, type ChannelId, type Lang } from './types.js';

export type GlobalArgs = {
  command: 'install' | 'update' | 'uninstall' | 'status' | 'help';
  baseUrl?: string;
  apiToken?: string;
  channels?: ChannelId[];
  skipDocker: boolean;
  /** Explicitly self-host the Lore server with local Docker. */
  docker: boolean;
  force: boolean;
  pre: boolean;
  dev: boolean;
  lang?: Lang;
  yes: boolean;
  allowInsecureHttp: boolean;
  purge: boolean;
  help: boolean;
  explicitBaseUrl: boolean;
  explicitApiToken: boolean;
  /** Install should open the wizard on a TTY; flags only seed its defaults. */
  interactiveDefault: boolean;
  /** Run straight from flags without prompting (--yes or a non-install command). */
  parameterMode: boolean;
  /** No command and no flags were given. */
  bare: boolean;
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
    docker: false,
    force: false,
    pre: false,
    dev: false,
    yes: false,
    allowInsecureHttp: false,
    purge: false,
    help: false,
    explicitBaseUrl: false,
    explicitApiToken: false,
    interactiveDefault: false,
    parameterMode: false,
    bare: argv.length === 0,
  };

  let i = 0;

  if (argv.length > 0 && !argv[0].startsWith('-')) {
    const cmd = argv[0];
    if (!COMMANDS.has(cmd)) {
      throw new Error(`Unknown command: ${cmd}`);
    }
    result.command = cmd === 'connect' ? 'install' : (cmd as GlobalArgs['command']);
    i = 1;
  }

  while (i < argv.length) {
    const token = argv[i];
    if (!token.startsWith('-')) {
      throw new Error(`Unknown argument: ${token}`);
    }

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
      case '--docker':
        result.docker = true;
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
      case '--allow-insecure-http':
        result.allowInsecureHttp = true;
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

  // Install always opens the wizard on a TTY; flags only preselect its answers.
  // --yes runs straight from flags (defaults for the rest, errors for required).
  result.interactiveDefault = result.command === 'install' && !result.yes && !result.help;
  result.parameterMode = !result.interactiveDefault;

  if (result.pre && result.dev) {
    throw new Error('--pre and --dev cannot be used together');
  }
  if (result.docker && (result.explicitBaseUrl || result.skipDocker)) {
    throw new Error('--docker cannot be combined with --base-url or --skip-docker');
  }

  return result;
}
