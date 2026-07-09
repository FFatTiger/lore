import { getSettings } from '../config/settings';
import {
  DEFAULT_BOOT_DRAFT_CLIENT_CLAUDECODE_INSTRUCTIONS,
  DEFAULT_BOOT_DRAFT_CLIENT_CODEX_INSTRUCTIONS,
  DEFAULT_BOOT_DRAFT_CLIENT_EXTRA_INSTRUCTIONS,
  DEFAULT_BOOT_DRAFT_CLIENT_HERMES_INSTRUCTIONS,
  DEFAULT_BOOT_DRAFT_CLIENT_OPENCLAW_INSTRUCTIONS,
  DEFAULT_BOOT_DRAFT_CLIENT_PI_INSTRUCTIONS,
  DEFAULT_BOOT_DRAFT_GLOBAL_AGENT_EXTRA_INSTRUCTIONS,
  DEFAULT_BOOT_DRAFT_ROLE_AGENT_INSTRUCTIONS,
  DEFAULT_BOOT_DRAFT_ROLE_SOUL_INSTRUCTIONS,
  DEFAULT_BOOT_DRAFT_ROLE_USER_INSTRUCTIONS,
  DEFAULT_BOOT_DRAFT_SYSTEM_PROMPT,
  DEFAULT_DREAM_PHASE_APPLY_PROMPT,
  DEFAULT_DREAM_PHASE_AUDIT_PROMPT,
  DEFAULT_DREAM_PHASE_DIAGNOSE_PROMPT,
  DEFAULT_DREAM_PHASE_PLAN_PROMPT,
  DEFAULT_DREAM_PHASE_PREFLIGHT_PROMPT,
  DEFAULT_DREAM_POETIC_DIARY_PROMPT,
  DEFAULT_DREAM_SYSTEM_PROMPT,
  DEFAULT_VIEW_GENERATION_SYSTEM_PROMPT,
} from '../config/settingsSchema';

export interface ServerPromptConfig {
  viewGenerationSystem: string;
  bootDraftSystem: string;
  bootDraftRoleAgentInstructions: string;
  bootDraftRoleSoulInstructions: string;
  bootDraftRoleUserInstructions: string;
  bootDraftGlobalAgentExtraInstructions: string;
  bootDraftClientExtraInstructions: string;
  bootDraftClientClaudecodeInstructions: string;
  bootDraftClientOpenclawInstructions: string;
  bootDraftClientHermesInstructions: string;
  bootDraftClientCodexInstructions: string;
  bootDraftClientPiInstructions: string;
  dreamSystem: string;
  dreamPoeticDiary: string;
  dreamPhaseDiagnose: string;
  dreamPhasePlan: string;
  dreamPhasePreflight: string;
  dreamPhaseApply: string;
  dreamPhaseAudit: string;
}

const PROMPT_KEYS = [
  'prompts.view_generation.system',
  'prompts.boot_draft.system',
  'prompts.boot_draft.instructions.role_agent',
  'prompts.boot_draft.instructions.role_soul',
  'prompts.boot_draft.instructions.role_user',
  'prompts.boot_draft.instructions.global_agent_extra',
  'prompts.boot_draft.instructions.client_extra',
  'prompts.boot_draft.instructions.client_claudecode',
  'prompts.boot_draft.instructions.client_openclaw',
  'prompts.boot_draft.instructions.client_hermes',
  'prompts.boot_draft.instructions.client_codex',
  'prompts.boot_draft.instructions.client_pi',
  'prompts.dream.system',
  'prompts.dream.poetic_diary',
  'prompts.dream.phase.diagnose',
  'prompts.dream.phase.plan',
  'prompts.dream.phase.preflight',
  'prompts.dream.phase.apply',
  'prompts.dream.phase.audit',
] as const;

function textOrDefault(value: unknown, fallback: string): string {
  const text = String(value || '').trim();
  return text || fallback.trim();
}

export async function loadServerPromptConfig(): Promise<ServerPromptConfig> {
  const values: Record<string, unknown> = (await getSettings([...PROMPT_KEYS]).catch(() => ({}))) || {};
  return {
    viewGenerationSystem: textOrDefault(values['prompts.view_generation.system'], DEFAULT_VIEW_GENERATION_SYSTEM_PROMPT),
    bootDraftSystem: textOrDefault(values['prompts.boot_draft.system'], DEFAULT_BOOT_DRAFT_SYSTEM_PROMPT),
    bootDraftRoleAgentInstructions: textOrDefault(values['prompts.boot_draft.instructions.role_agent'], DEFAULT_BOOT_DRAFT_ROLE_AGENT_INSTRUCTIONS),
    bootDraftRoleSoulInstructions: textOrDefault(values['prompts.boot_draft.instructions.role_soul'], DEFAULT_BOOT_DRAFT_ROLE_SOUL_INSTRUCTIONS),
    bootDraftRoleUserInstructions: textOrDefault(values['prompts.boot_draft.instructions.role_user'], DEFAULT_BOOT_DRAFT_ROLE_USER_INSTRUCTIONS),
    bootDraftGlobalAgentExtraInstructions: textOrDefault(values['prompts.boot_draft.instructions.global_agent_extra'], DEFAULT_BOOT_DRAFT_GLOBAL_AGENT_EXTRA_INSTRUCTIONS),
    bootDraftClientExtraInstructions: textOrDefault(values['prompts.boot_draft.instructions.client_extra'], DEFAULT_BOOT_DRAFT_CLIENT_EXTRA_INSTRUCTIONS),
    bootDraftClientClaudecodeInstructions: textOrDefault(values['prompts.boot_draft.instructions.client_claudecode'], DEFAULT_BOOT_DRAFT_CLIENT_CLAUDECODE_INSTRUCTIONS),
    bootDraftClientOpenclawInstructions: textOrDefault(values['prompts.boot_draft.instructions.client_openclaw'], DEFAULT_BOOT_DRAFT_CLIENT_OPENCLAW_INSTRUCTIONS),
    bootDraftClientHermesInstructions: textOrDefault(values['prompts.boot_draft.instructions.client_hermes'], DEFAULT_BOOT_DRAFT_CLIENT_HERMES_INSTRUCTIONS),
    bootDraftClientCodexInstructions: textOrDefault(values['prompts.boot_draft.instructions.client_codex'], DEFAULT_BOOT_DRAFT_CLIENT_CODEX_INSTRUCTIONS),
    bootDraftClientPiInstructions: textOrDefault(values['prompts.boot_draft.instructions.client_pi'], DEFAULT_BOOT_DRAFT_CLIENT_PI_INSTRUCTIONS),
    dreamSystem: textOrDefault(values['prompts.dream.system'], DEFAULT_DREAM_SYSTEM_PROMPT),
    dreamPoeticDiary: textOrDefault(values['prompts.dream.poetic_diary'], DEFAULT_DREAM_POETIC_DIARY_PROMPT),
    dreamPhaseDiagnose: textOrDefault(values['prompts.dream.phase.diagnose'], DEFAULT_DREAM_PHASE_DIAGNOSE_PROMPT),
    dreamPhasePlan: textOrDefault(values['prompts.dream.phase.plan'], DEFAULT_DREAM_PHASE_PLAN_PROMPT),
    dreamPhasePreflight: textOrDefault(values['prompts.dream.phase.preflight'], DEFAULT_DREAM_PHASE_PREFLIGHT_PROMPT),
    dreamPhaseApply: textOrDefault(values['prompts.dream.phase.apply'], DEFAULT_DREAM_PHASE_APPLY_PROMPT),
    dreamPhaseAudit: textOrDefault(values['prompts.dream.phase.audit'], DEFAULT_DREAM_PHASE_AUDIT_PROMPT),
  };
}

export function renderPromptTemplate(template: string, values: Record<string, unknown>): string {
  return Object.entries(values).reduce((out, [key, value]) => (
    out.replaceAll(`{{${key}}}`, String(value ?? ''))
  ), template);
}
