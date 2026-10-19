#!/usr/bin/env node

import { runLoreMcpBridge } from '../vendor/mcp-bridge/index.mjs';
import { materializeSkill } from './skill-materializer.mjs';

function transformSkillGetResponse(message, payload, config) {
  if (message.method !== 'tools/call' || message.params?.name !== 'lore_skill_get') return payload;
  if (!payload || typeof payload !== 'object' || payload.error || payload.result?.isError === true) return payload;
  const content = payload.result?.content;
  if (!Array.isArray(content)) return payload;
  const textItem = content.find((item) => item?.type === 'text' && typeof item.text === 'string');
  if (!textItem) return payload;
  let skill;
  try {
    skill = JSON.parse(textItem.text);
  } catch {
    throw new Error('Lore skill get returned invalid package JSON');
  }
  const materialized = materializeSkill(skill, { loreHome: config.loreHome });
  return {
    ...payload,
    result: {
      ...payload.result,
      content: [{ type: 'text', text: JSON.stringify(materialized, null, 2) }],
    },
  };
}

runLoreMcpBridge({ clientType: 'zcode', transformSkillGetResponse });
