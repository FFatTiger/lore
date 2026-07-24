import { spawn } from 'node:child_process';

export type ExecResult = { code: number; stdout: string; stderr: string };
export type ExecOptions = { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean };

export type ExecFn = (
  argv: string[],
  opts?: ExecOptions,
) => Promise<ExecResult>;

function sanitizeDetail(value: string, redact: string[]): string {
  let detail = value.trim();
  for (const secret of redact.filter(Boolean)) {
    detail = detail.split(secret).join('[REDACTED]');
  }
  return detail.replace(/\s+/g, ' ').slice(0, 300);
}

function boundedDetail(result: ExecResult, redact: string[]): string {
  return sanitizeDetail([result.stderr, result.stdout].filter(Boolean).join(' '), redact);
}

export async function runChecked(
  run: ExecFn,
  stage: string,
  argv: string[],
  opts?: ExecOptions,
  safety: { redact?: string[] } = {},
): Promise<ExecResult> {
  const redact = safety.redact ?? [];
  let result: ExecResult;
  try {
    result = await run(argv, opts);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const detail = sanitizeDetail(raw, redact);
    throw new Error(`${stage} failed${detail ? `: ${detail}` : ''}`);
  }
  if (result.code !== 0) {
    const detail = boundedDetail(result, redact);
    throw new Error(`${stage} failed (exit ${result.code})${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

export function createExec(): ExecFn {
  return (argv, opts = {}) =>
    new Promise((resolve, reject) => {
      if (!argv.length) {
        reject(new Error('createExec: empty argv'));
        return;
      }
      const [cmd, ...args] = argv;
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        reject(err);
      });
      child.on('close', (code) => {
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });
}
