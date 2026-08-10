import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatSkillCandidateBlock,
  discoveryCandidateEntries,
  readSkillCandidates,
} from '../src/discovery.mjs';

test('formatSkillCandidateBlock produces <lore-skills> with get instruction', () => {
  const block = formatSkillCandidateBlock([
    { skill_id: 's1', name: 'alpha', version: 2, description: 'First skill' },
    { skill_id: 's2', name: 'beta', version: 1 },
  ]);
  assert.match(block, /<lore-skills>/);
  assert.match(block, /<\/lore-skills>/);
  assert.match(block, /lore_skill_get/);
  assert.match(block, /skill_id: s1/);
  assert.match(block, /alpha/);
  assert.match(block, /First skill/);
});

test('discoveryCandidateEntries filters incomplete rows', () => {
  const out = discoveryCandidateEntries([
    { skill_id: 'ok', name: 'named', expected_version: 4, description: 'd' },
    { name: 'no-id' },
    { skill_id: 'noid-name' },
    null,
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].skill_id, 'ok');
  assert.equal(out[0].version, 4);
});

test('readSkillCandidates reads lifecycle skill_candidates array', () => {
  const candidates = readSkillCandidates({
    skill_candidates: [{ id: 'x', name: 'X', version: 1 }],
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, 'x');
  assert.deepEqual(readSkillCandidates({ skill_candidates: 'nope' }), []);
});
