import { truncate } from '../core/utils';
import { normalizeList } from './viewBuilders';
import type { EmbeddingConfig } from '../core/types';
import { resolveViewLlmConfig, type ResolvedViewLlmConfig } from '../llm/config';
import { generateText, type ProviderMessage } from '../llm/provider';
import { DEFAULT_VIEW_GENERATION_SYSTEM_PROMPT } from '../config/settingsSchema';
import { loadServerPromptConfig } from '../prompts/config';

// ---------------------------------------------------------------------------
// LLM config resolution
// ---------------------------------------------------------------------------

export { resolveViewLlmConfig };
export type ViewLlmConfig = ResolvedViewLlmConfig;

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

export function extractJsonObject(text: unknown): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// LLM chat completion
// ---------------------------------------------------------------------------

export async function chatCompletion(
  config: ViewLlmConfig,
  messages: ProviderMessage[],
): Promise<string> {
  const response = await generateText(config, messages);
  return response.content;
}

// ---------------------------------------------------------------------------
// View generation prompt builder
// ---------------------------------------------------------------------------

export function buildViewGenerationMessages(
  doc: Record<string, unknown>,
  systemPrompt = DEFAULT_VIEW_GENERATION_SYSTEM_PROMPT,
): Array<{ role: string; content: string }> {
  const payload = {
    uri: doc.uri,
    path: doc.path,
    priority: doc.priority,
    disclosure: truncate(doc.disclosure, 180),
    glossary_keywords: normalizeList(doc.glossary_keywords as unknown[] || [], 12),
    body_preview: truncate(doc.body_preview, 600),
  };

  return [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: JSON.stringify(payload, null, 2),
    },
  ];
}

export async function buildConfiguredViewGenerationMessages(doc: Record<string, unknown>): Promise<Array<{ role: string; content: string }>> {
  const prompts = await loadServerPromptConfig();
  return buildViewGenerationMessages(doc, prompts.viewGenerationSystem);
}

// ---------------------------------------------------------------------------
// LLM refinement pipeline
// ---------------------------------------------------------------------------

export async function refineDocumentWithLlm(
  doc: Record<string, unknown>,
  config: ViewLlmConfig,
): Promise<{ gist: string; question: string[]; model: string } | null> {
  try {
    const raw = await chatCompletion(config, await buildConfiguredViewGenerationMessages(doc));
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const gist = truncate(parsed.gist, 320);
    const question = normalizeList(parsed.question as unknown[] || [], 3).slice(0, 3);

    if (!gist || question.length < 3) return null;
    return { gist, question, model: config.model };
  } catch {
    return null;
  }
}

export async function refineDocumentsWithLlm(
  docs: Record<string, unknown>[],
  config: ViewLlmConfig | null,
): Promise<Record<string, unknown>[]> {
  if (!config || docs.length === 0) return docs;
  const refinedDocs: Record<string, unknown>[] = [];
  for (const doc of docs) {
    const refined = await refineDocumentWithLlm(doc, config);
    refinedDocs.push(refined ? { ...doc, llm_views: refined } : doc);
  }
  return refinedDocs;
}
