import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadLoreConfig, pickString } from '../vendor/lore-config.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotFields = ['conversationId', 'modelName', 'transcriptPath', 'artifactDirectoryPath'];

function detectProjectInfo(workspace) {
  const root = pickString(workspace);
  if (!root) return { dir_name: null, repo_name: null };
  let repo_name = null;
  try {
    const remote = execFileSync('git', ['remote'], {
      cwd: root, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n')[0];
    if (remote) {
      const url = execFileSync('git', ['remote', 'get-url', remote], {
        cwd: root, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      repo_name = url.match(/\/([^/.]+?)(?:\.git)?$/)?.[1] ?? null;
    }
  } catch {}
  return { dir_name: path.basename(root), repo_name };
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const event = process.argv[2];
  const prompt = pickString(input.lastUserInput);
  if (event === 'pre-invocation' && (input.invocationNum !== 0 || !prompt)) return {};
  if (event !== 'session-start' && event !== 'pre-invocation') return {};

  const sessionId = pickString(input.conversationId);
  const normalized = { ...(sessionId ? { session_id: sessionId } : {}), ...(event === 'pre-invocation' ? { prompt } : {}) };
  const snapshot = {};
  for (const key of snapshotFields) {
    const value = pickString(input[key]);
    if (value) snapshot[key] = value;
  }
  const runtime = { runtime_id: 'agy', runtime_family: 'agy' };
  try {
    const version = pickString(JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8')).version);
    if (version) runtime.plugin_version = version;
  } catch {}
  const cfg = loadLoreConfig();
  const headers = { 'content-type': 'application/json' };
  if (cfg.apiToken) headers.authorization = `Bearer ${cfg.apiToken}`;
  let output = {};
  try {
    const response = await fetch(`${cfg.baseUrl}/api/lifecycle/event`, {
      method: 'POST', headers,
      body: JSON.stringify({
        protocol_version: 'lore.lifecycle.v1', runtime,
        event: event === 'session-start'
          ? { name: 'session.start', native_name: 'SessionStart' }
          : { name: 'prompt.submit', native_name: 'PreInvocation' },
        normalized,
        ...(event === 'session-start' ? { project: detectProjectInfo(input.workspacePaths?.[0]) } : {}),
        ...(Object.keys(snapshot).length ? { native_input_snapshot: snapshot } : {}),
      }),
      signal: AbortSignal.timeout(event === 'session-start' ? 8000 : 10000),
    });
    if (response.ok) {
      const result = await response.json();
      if (result?.host_output?.mode === 'stdout_json' && result.host_output.value != null) output = result.host_output.value;
    }
  } catch {}
  process.stdout.write(JSON.stringify(output));
  if (event === 'session-start' && cfg.skillsEnabled) {
    try {
      const child = spawn(process.execPath, [path.join(pluginRoot, 'vendor/skill-workcopy/skills-sync.mjs'), '--client-type', 'agy', '--root', path.join(pluginRoot, 'skills')], {
        detached: true, stdio: 'ignore', env: process.env,
      });
      child.unref();
    } catch {}
  }
  return null;
}

main().then((output) => {
  if (output !== null) process.stdout.write(JSON.stringify(output));
}).catch(() => process.stdout.write('{}'));
