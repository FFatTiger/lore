import type { GlobalArgs } from '../core/args.js';
import { readConfig } from '../core/config.js';
import { assertTokenTransport } from '../core/connection.js';
import { getConfigPath, getLoreHome } from '../core/paths.js';

export type SecretDeps = {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  stderr?: NodeJS.WriteStream;
  stdout?: NodeJS.WriteStream;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function responseDetail(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (body && typeof body.detail === 'string' && body.detail) return body.detail;
  } catch {
    // Non-JSON bodies carry no detail.
  }
  return undefined;
}

/**
 * `secret get NAME` prints one stored project secret value to stdout with no
 * trailing newline, so shell substitution can inject it into a command:
 * `curl -H "Authorization: Bearer $(npx -y @loremem/cli secret get NAME)"`.
 * Fully non-interactive: failures print one stderr line and exit 1, and the
 * value or token is never printed to stderr.
 */
export async function runSecretGet(args: GlobalArgs, deps: SecretDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const name = args.secretName ?? '';
  const fail = (message: string): number => {
    stderr.write(`${message}\n`);
    return 1;
  };

  const cfg = await readConfig(getConfigPath(getLoreHome(env)));
  const baseUrl = cfg.base_url?.trim();
  const token = cfg.api_token?.trim();
  if (!baseUrl || !token) {
    return fail('No Lore server connection saved; run `npx @loremem/cli install` first.');
  }

  try {
    assertTokenTransport(baseUrl, token, { allowInsecureHttp: args.allowInsecureHttp });
  } catch (error) {
    return fail(errorText(error));
  }

  const doFetch = deps.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${baseUrl}/api/secrets/${encodeURIComponent(name)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (error) {
    return fail(`Could not reach the Lore server: ${errorText(error)}`);
  }

  if (response.status === 404) {
    const detail = await responseDetail(response);
    return fail(detail ?? 'This Lore server does not support secrets');
  }
  if (!response.ok) {
    const detail = await responseDetail(response);
    return fail(`Lore server error ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  let body: { value?: unknown };
  try {
    body = (await response.json()) as { value?: unknown };
  } catch {
    return fail('Unexpected response from the Lore server');
  }
  if (typeof body.value !== 'string' || body.value === '') {
    return fail('Unexpected response from the Lore server');
  }

  stdout.write(body.value);
  return 0;
}
