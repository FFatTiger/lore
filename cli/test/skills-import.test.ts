import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli.ts';

const TOKEN = 'lm_import_test';
const FIVE_MIB = 5 * 1024 * 1024;

type SkillBody = {
  name?: string;
  enabled?: boolean;
  files?: Array<{ path: string; content?: string; content_base64?: string; media_type?: string }>;
  source?: Record<string, string>;
};

type Posted = { authorization: string; body: SkillBody };

async function listen(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function writeConfig(loreHome: string, baseUrl: string): Promise<void> {
  await fs.mkdir(loreHome, { recursive: true });
  await fs.writeFile(
    path.join(loreHome, 'config.json'),
    `${JSON.stringify({ base_url: baseUrl, api_token: TOKEN }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function skillDir(
  root: string,
  name: string,
  files: Record<string, string | Buffer>,
): Promise<string> {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  for (const [rel, data] of Object.entries(files)) {
    const dest = path.join(dir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
  }
  return dir;
}

function frontmatter(name: string, extra = ''): string {
  return `---\nname: ${name}\n${extra}description: test skill\n---\n\n# ${name}\n`;
}

function skillsServer(opts: {
  skills?: boolean;
  onPost?: (body: SkillBody) => { status: number; body: unknown };
}): { posts: Posted[]; health: number } & { handler: Parameters<typeof listen>[0] } {
  const posts: Posted[] = [];
  let health = 0;
  const handler: Parameters<typeof listen>[0] = async (req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url.startsWith('/api/health')) {
      health += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        edition: opts.skills === false ? 'oss' : 'saas',
        capabilities: opts.skills === false ? {} : { skills: true },
      }));
      return;
    }
    if (req.method === 'POST' && url === '/api/skills') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as SkillBody;
      posts.push({
        authorization: req.headers.authorization ?? '',
        body,
      });
      const result = opts.onPost?.(body) ?? { status: 201, body: { id: 'sk_1' } };
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body));
      return;
    }
    res.writeHead(404);
    res.end('nope');
  };
  return { posts, get health() { return health; }, handler };
}

async function runImport(
  home: string,
  argv: string[],
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  const prevHome = process.env.HOME;
  const prevLore = process.env.LORE_HOME;
  process.env.HOME = home;
  process.env.LORE_HOME = path.join(home, '.lore');
  console.log = (...args: unknown[]) => { out.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { err.push(args.map(String).join(' ')); };
  try {
    const code = await run(argv);
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevLore === undefined) delete process.env.LORE_HOME;
    else process.env.LORE_HOME = prevLore;
  }
}

test('import posts a text skill and reports success', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-sk-ok-'));
  const agents = path.join(home, '.agents');
  const skills = path.join(agents, 'skills');
  await skillDir(skills, 'grilling', { 'SKILL.md': frontmatter('grilling') });
  const api = skillsServer({});
  const { server, baseUrl } = await listen(api.handler);
  await writeConfig(path.join(home, '.lore'), baseUrl);
  try {
    const result = await runImport(home, ['skills', 'import', skills]);
    assert.equal(result.code, 0, result.err);
    assert.equal(api.posts.length, 1);
    assert.equal(api.posts[0]!.authorization, `Bearer ${TOKEN}`);
    const body = api.posts[0]!.body;
    assert.equal(body.name, 'grilling');
    assert.equal(body.enabled, true);
    assert.equal(body.files?.[0]?.path, 'SKILL.md');
    assert.match(body.files?.[0]?.content ?? '', /# grilling/);
    assert.equal(body.source?.type, 'local');
    assert.equal(body.source?.imported_from, await fs.realpath(path.join(skills, 'grilling')));
    assert.match(body.source?.imported_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.match(result.out, /imported:\s*1/i);
    assert.match(result.out, /still active/i);
    assert.doesNotMatch(`${result.out}\n${result.err}`, new RegExp(TOKEN));
    const after = await fs.readdir(path.join(skills, 'grilling'));
    assert.deepEqual(after, ['SKILL.md']);
  } finally {
    server.close();
  }
});

test('409 skill_exists is skipped and a later error does not stop the rest', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-sk-mix-'));
  const skills = path.join(home, 'skills');
  for (const name of ['alpha', 'beta', 'gamma']) {
    await skillDir(skills, name, { 'SKILL.md': frontmatter(name) });
  }
  const api = skillsServer({
    onPost: (body) => {
      if (body.name === 'alpha') return { status: 409, body: { code: 'skill_exists', detail: 'exists' } };
      if (body.name === 'beta') return { status: 422, body: { detail: 'name rejected by server' } };
      return { status: 201, body: { id: 'ok' } };
    },
  });
  const { server, baseUrl } = await listen(api.handler);
  await writeConfig(path.join(home, '.lore'), baseUrl);
  try {
    const result = await runImport(home, ['skills', 'import', skills]);
    assert.equal(result.code, 1);
    assert.deepEqual(api.posts.map((p) => p.body.name), ['alpha', 'beta', 'gamma']);
    assert.match(result.out, /alpha[\s\S]*already in Lore/);
    assert.match(result.out, /beta[\s\S]*name rejected by server/);
    assert.match(result.out, /imported:\s*1/i);
    assert.match(result.out, /skipped:\s*1/i);
    assert.match(result.out, /failed:\s*1/i);
  } finally {
    server.close();
  }
});

test('dry-run prints the plan and never POSTs', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-sk-dry-'));
  const skills = path.join(home, 'skills');
  await skillDir(skills, 'grilling', { 'SKILL.md': frontmatter('grilling') });
  await skillDir(skills, 'Bad Name', { 'SKILL.md': frontmatter('Bad Name') });
  const api = skillsServer({});
  const { server, baseUrl } = await listen(api.handler);
  await writeConfig(path.join(home, '.lore'), baseUrl);
  try {
    const result = await runImport(home, ['skills', 'import', skills, '--dry-run']);
    assert.equal(result.code, 0, result.err);
    assert.equal(api.posts.length, 0);
    assert.ok(api.health >= 1);
    assert.match(result.out, /grilling/);
    assert.match(result.out, /would import:\s*1/i);
    assert.match(result.out, /would skip:\s*1/i);
  } finally {
    server.close();
  }
});

test('lock file provenance is github and missing lock stays local', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-sk-lock-'));
  const agents = path.join(home, '.agents');
  const skills = path.join(agents, 'skills');
  await skillDir(skills, 'grilling', { 'SKILL.md': frontmatter('grilling') });
  await skillDir(skills, 'local-only', { 'SKILL.md': frontmatter('local-only') });
  await fs.writeFile(path.join(agents, '.skill-lock.json'), JSON.stringify({
    version: 1,
    skills: {
      grilling: {
        source: 'mattpocock/skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/mattpocock/skills.git',
        skillPath: 'skills/grilling/SKILL.md',
        skillFolderHash: 'abc123',
      },
    },
  }));
  const api = skillsServer({});
  const { server, baseUrl } = await listen(api.handler);
  await writeConfig(path.join(home, '.lore'), baseUrl);
  try {
    const result = await runImport(home, ['skills', 'import', skills]);
    assert.equal(result.code, 0, result.err);
    const byName = Object.fromEntries(api.posts.map((p) => [p.body.name, p.body.source]));
    assert.equal(byName.grilling?.type, 'github');
    assert.equal(byName.grilling?.repo, 'mattpocock/skills');
    assert.equal(byName.grilling?.url, 'https://github.com/mattpocock/skills.git');
    assert.equal(byName.grilling?.path, 'skills/grilling/SKILL.md');
    assert.equal(byName.grilling?.folder_hash, 'abc123');
    assert.match(byName.grilling?.imported_at ?? '', /^\d{4}/);
    assert.equal(byName['local-only']?.type, 'local');
    assert.equal(byName['local-only']?.imported_from, await fs.realpath(path.join(skills, 'local-only')));
  } finally {
    server.close();
  }
});

test('name mismatch, broken symlink, and inner symlink are skipped or reported', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-sk-skip-'));
  const skills = path.join(home, 'skills');
  await skillDir(skills, 'grilling', { 'SKILL.md': frontmatter('other-name') });
  await fs.symlink(path.join(skills, 'missing-target'), path.join(skills, 'broken'));
  const real = await skillDir(skills, 'with-link', {
    'SKILL.md': frontmatter('with-link'),
    'notes.txt': 'hello',
  });
  await fs.symlink(path.join(real, 'notes.txt'), path.join(real, 'alias.txt'));
  const api = skillsServer({});
  const { server, baseUrl } = await listen(api.handler);
  await writeConfig(path.join(home, '.lore'), baseUrl);
  try {
    const result = await runImport(home, ['skills', 'import', skills]);
    assert.equal(result.code, 0, result.err);
    assert.deepEqual(api.posts.map((p) => p.body.name), ['with-link']);
    const paths = api.posts[0]!.body.files?.map((f) => f.path) ?? [];
    assert.deepEqual(paths.sort(), ['SKILL.md', 'notes.txt']);
    assert.match(result.out, /grilling[\s\S]*name/i);
    assert.match(result.out, /broken[\s\S]*symlink/i);
    assert.match(result.out, /alias\.txt/);
  } finally {
    server.close();
  }
});

test('symlinked skill directory is imported from its real path', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-sk-real-'));
  const realRoot = path.join(home, 'real');
  const skills = path.join(home, 'skills');
  await fs.mkdir(skills, { recursive: true });
  const real = await skillDir(realRoot, 'grilling', { 'SKILL.md': frontmatter('grilling') });
  await fs.symlink(real, path.join(skills, 'grilling'));
  const api = skillsServer({});
  const { server, baseUrl } = await listen(api.handler);
  await writeConfig(path.join(home, '.lore'), baseUrl);
  try {
    const result = await runImport(home, ['skills', 'import', skills]);
    assert.equal(result.code, 0, result.err);
    assert.equal(api.posts[0]!.body.source?.imported_from, await fs.realpath(real));
  } finally {
    server.close();
  }
});

test('binary files are sent as base64 with a media type', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-sk-bin-'));
  const skills = path.join(home, 'skills');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  await skillDir(skills, 'grilling', {
    'SKILL.md': frontmatter('grilling'),
    'assets/icon.png': png,
  });
  const api = skillsServer({});
  const { server, baseUrl } = await listen(api.handler);
  await writeConfig(path.join(home, '.lore'), baseUrl);
  try {
    const result = await runImport(home, ['skills', 'import', skills]);
    assert.equal(result.code, 0, result.err);
    const icon = api.posts[0]!.body.files?.find((f) => f.path === 'assets/icon.png');
    assert.equal(icon?.content, undefined);
    assert.equal(icon?.content_base64, png.toString('base64'));
    assert.equal(icon?.media_type, 'image/png');
  } finally {
    server.close();
  }
});

test('oversized files and too many files are skipped without POST', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-sk-limit-'));
  const skills = path.join(home, 'skills');
  await skillDir(skills, 'huge', {
    'SKILL.md': frontmatter('huge'),
    'blob.bin': Buffer.alloc(FIVE_MIB + 1),
  });
  const many: Record<string, string> = { 'SKILL.md': frontmatter('many') };
  for (let i = 0; i < 256; i += 1) many[`f${i}.txt`] = 'x';
  await skillDir(skills, 'many', many);
  const api = skillsServer({});
  const { server, baseUrl } = await listen(api.handler);
  await writeConfig(path.join(home, '.lore'), baseUrl);
  try {
    const result = await runImport(home, ['skills', 'import', skills]);
    assert.equal(result.code, 0, result.err);
    assert.equal(api.posts.length, 0);
    assert.match(result.out, /huge[\s\S]*5 MiB|huge[\s\S]*too large/i);
    assert.match(result.out, /many[\s\S]*256/);
    assert.match(result.out, /skipped:\s*2/i);
  } finally {
    server.close();
  }
});

test('skills capability false refuses before reading packages', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-sk-cap-'));
  const skills = path.join(home, 'skills');
  await skillDir(skills, 'grilling', { 'SKILL.md': frontmatter('grilling') });
  const api = skillsServer({ skills: false });
  const { server, baseUrl } = await listen(api.handler);
  await writeConfig(path.join(home, '.lore'), baseUrl);
  try {
    const result = await runImport(home, ['skills', 'import', skills]);
    assert.notEqual(result.code, 0);
    assert.equal(api.posts.length, 0);
    assert.match(`${result.out}\n${result.err}`, /skills/i);
  } finally {
    server.close();
  }
});

test('default directory is ~/.agents/skills and --json is machine readable', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-sk-default-'));
  const skills = path.join(home, '.agents', 'skills');
  await skillDir(skills, 'grilling', { 'SKILL.md': frontmatter('grilling') });
  const api = skillsServer({});
  const { server, baseUrl } = await listen(api.handler);
  await writeConfig(path.join(home, '.lore'), baseUrl);
  try {
    const result = await runImport(home, ['skills', 'import', '--json']);
    assert.equal(result.code, 0, `${result.err}\n${result.out}`);
    assert.equal(api.posts.length, 1);
    assert.equal(api.posts[0]!.body.name, 'grilling');
    const parsed = JSON.parse(result.out) as { imported: unknown[]; skipped: unknown[]; failed: unknown[] };
    assert.equal(parsed.imported.length, 1);
    assert.deepEqual(parsed.skipped, []);
    assert.deepEqual(parsed.failed, []);
  } finally {
    server.close();
  }
});

