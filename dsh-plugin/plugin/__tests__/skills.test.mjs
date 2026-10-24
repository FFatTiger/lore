import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { createLoreSkillProvider, createLoreSkills, parseSkillFrontmatter } from '../skills.mjs';

const temporaryHomes = [];
const savedEnv = {};

function setEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  Object.keys(savedEnv).forEach((key) => delete savedEnv[key]);
  while (temporaryHomes.length) fs.rmSync(temporaryHomes.pop(), { recursive: true, force: true });
});

function tempHome(prefix) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryHomes.push(home);
  return home;
}

function providerControl() {
  return { signal: new AbortController().signal, invalidate: () => {} };
}

function writeSkillDir(home, projectId, dirName, skillMd, { marker = true } = {}) {
  const dir = path.join(home, 'skills', projectId, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
  if (marker) {
    fs.writeFileSync(path.join(dir, '.lore-skill-marker.json'), JSON.stringify({
      schema: 'lore.skill.workcopy.v1',
      project_id: projectId,
      skill_id: `id-${dirName}`,
      name: dirName,
      version: 1,
      managed_files: ['SKILL.md'],
      manifest_hash: 'listing-does-not-hash',
      synced_at: '',
    }));
  }
  return dir;
}

test('parseSkillFrontmatter reads keys, strips quotes, and returns the body', () => {
  const parsed = parseSkillFrontmatter(
    '---\nname: alpha-skill\ndescription: "Does alpha"\ndisable-model-invocation: true\n---\n\n# Alpha\n\nBody.\n',
  );
  assert.equal(parsed.fm.name, 'alpha-skill');
  assert.equal(parsed.fm.description, 'Does alpha');
  assert.equal(parsed.fm['disable-model-invocation'], 'true');
  assert.equal(parsed.body, '# Alpha\n\nBody.\n');

  assert.deepEqual(parseSkillFrontmatter('# No frontmatter\n').fm, {});
});

test('list reports an empty incomplete observation before the project id is known', async () => {
  const home = tempHome('lore-dsh-prov-');
  setEnv({ LORE_HOME: home, LORE_BASE_URL: 'http://127.0.0.1:9', LORE_SKILLS_ENABLED: '1' });
  const skills = createLoreSkills();
  const provider = createLoreSkillProvider(skills, providerControl());
  const listed = await provider.list({});
  assert.deepEqual(listed, { candidates: [], complete: false });
});

test('list maps frontmatter to candidates and skips non-kebab or unmarked entries', async () => {
  const home = tempHome('lore-dsh-prov-');
  setEnv({ LORE_HOME: home, LORE_SKILLS_ENABLED: '0' });
  const alpha = writeSkillDir(home, 'proj-1', 'alpha-skill',
    '---\nname: alpha-skill\ndescription: Does alpha\n---\n\n# Alpha\n');
  writeSkillDir(home, 'proj-1', 'beta-skill',
    '---\nname: beta-skill\ndescription: Does beta\ndisable-model-invocation: true\n---\n\n# Beta\n');
  writeSkillDir(home, 'proj-1', 'gamma-skill',
    '---\nname: gamma-skill\ndescription: Does gamma\nuser-invocable: false\n---\n\n# Gamma\n');
  writeSkillDir(home, 'proj-1', 'weird_name',
    '---\nname: Weird_Name\ndescription: Not kebab\n---\n\n# Weird\n');
  writeSkillDir(home, 'proj-1', 'unmarked',
    '---\nname: unmarked-skill\ndescription: No marker\n---\n\n# Unmarked\n', { marker: false });

  const skills = createLoreSkills();
  skills.state.projectId = 'proj-1';
  const provider = createLoreSkillProvider(skills, providerControl());
  const { candidates, complete } = await provider.list({});
  assert.equal(complete, true);
  assert.deepEqual(candidates.map((candidate) => candidate.name), ['alpha-skill', 'beta-skill', 'gamma-skill']);

  const [alpha0, beta, gamma] = candidates;
  assert.equal(alpha0.description, 'Does alpha');
  assert.deepEqual(alpha0.invocation, { modelInvocable: true, userInvocable: true });
  assert.deepEqual(beta.invocation, { modelInvocable: false, userInvocable: true });
  assert.deepEqual(gamma.invocation, { modelInvocable: true, userInvocable: false });
  assert.equal(alpha0.provider, 'lore');
  assert.deepEqual(alpha0.resourceBase, { kind: 'directory', path: alpha });
  assert.equal(alpha0.path, path.join(alpha, 'SKILL.md'));
  assert.equal(alpha0.rank, 0);
  assert.equal(alpha0.locator, alpha);
});

test('get loads the SKILL.md body for a listed candidate', async () => {
  const home = tempHome('lore-dsh-prov-');
  setEnv({ LORE_HOME: home, LORE_SKILLS_ENABLED: '0' });
  writeSkillDir(home, 'proj-1', 'alpha-skill',
    '---\nname: alpha-skill\ndescription: Does alpha\n---\n\n# Alpha\n\nUse it.\n');

  const skills = createLoreSkills();
  skills.state.projectId = 'proj-1';
  const provider = createLoreSkillProvider(skills, providerControl());
  const { candidates } = await provider.list({});
  const loaded = await provider.get(candidates[0], {});
  assert.equal(loaded.name, 'alpha-skill');
  assert.equal(loaded.description, 'Does alpha');
  assert.equal(loaded.content, '# Alpha\n\nUse it.\n');
  assert.equal(loaded.path, candidates[0].path);
  assert.deepEqual(loaded.resourceBase, candidates[0].resourceBase);

  // A vanished file resolves to undefined instead of throwing.
  fs.rmSync(path.join(candidates[0].path));
  assert.equal(await provider.get(candidates[0], {}), undefined);
});
