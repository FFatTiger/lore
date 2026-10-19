#!/usr/bin/env node

import { runLoreMcpBridge } from '../vendor/mcp-bridge/index.mjs';
import { ensureSkillWorkCopy, normalizeSkillDetail } from '../vendor/skill-workcopy/index.mjs';

// A successful lore_skill_get materializes the server package under
// ${LORE_HOME:-~/.lore}/skills/<project-id>/<skill-name>/ like the other
// channels, then answers with the local work-copy location and SKILL.md.
async function transformSkillGetResponse(message, payload, config) {
  if (message.method !== 'tools/call' || message.params?.name !== 'lore_skill_get') return payload;
  if (!payload || typeof payload !== 'object' || payload.error || payload.result?.isError === true) return payload;
  const content = payload.result?.content;
  if (!Array.isArray(content)) return payload;
  const textItem = content.find((item) => item?.type === 'text' && typeof item.text === 'string');
  if (!textItem) return payload;
  let detail;
  try {
    detail = normalizeSkillDetail(JSON.parse(textItem.text));
  } catch {
    throw new Error('Lore skill get returned invalid package JSON');
  }
  const skillId = String(message.params?.arguments?.skill_id || detail.id || '').trim();
  if (!skillId) throw new Error('Lore skill get returned no skill_id');
  const ensured = await ensureSkillWorkCopy({
    loreHome: config.loreHome,
    skillId,
    loadSkill: async () => detail,
  });
  const text = [
    `Skill ready: ${ensured.skill.name || skillId}`,
    `skill_dir: ${ensured.skill_dir}`,
    'Files from Lore in skill_dir are read-only and refreshed by lore_skill_get. Any other file there is a local artifact: never checked or uploaded. Save deliverables for the user where they asked or in the working directory, not in skill_dir.',
    `server_version: ${ensured.server_version ?? '?'}`,
    `local_version: ${ensured.local_version}`,
    `downloaded: ${ensured.downloaded}`,
    '',
    ensured.skill_md,
  ].join('\n');
  return {
    ...payload,
    result: {
      ...payload.result,
      content: [{ type: 'text', text }],
    },
  };
}

runLoreMcpBridge({ clientType: 'dsh', transformSkillGetResponse });
