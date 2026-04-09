import { getSettings as getSettingsBatch } from '../config/settings';
import { truncate } from '../core/utils';
import { normalizeList } from './viewBuilders';
import type { EmbeddingConfig } from '../core/types';

// ---------------------------------------------------------------------------
// LLM config resolution
// ---------------------------------------------------------------------------

export interface ViewLlmConfig {
  base_url: string;
  api_key: string;
  model: string;
  timeout_ms: number;
  temperature: number;
}

export async function resolveViewLlmConfig(embedding?: EmbeddingConfig | null): Promise<ViewLlmConfig | null> {
  const s = await getSettingsBatch([
    'view_llm.base_url',
    'view_llm.model',
    'view_llm.temperature',
    'view_llm.timeout_ms',
  ]);
  const base_url = String(s['view_llm.base_url'] || embedding?.base_url || '').trim().replace(/\/$/, '');
  const api_key = String(process.env.LORE_VIEW_LLM_API_KEY || embedding?.api_key || '').trim();
  const model = String(s['view_llm.model'] || '').trim();
  // Leaving view_llm.base_url blank disables LLM view refinement entirely.
  if (!base_url || !api_key || !model) return null;
  return {
    base_url,
    api_key,
    model,
    timeout_ms: Number(s['view_llm.timeout_ms']) || 30000,
    temperature: Number(s['view_llm.temperature']) || 0.2,
  };
}

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
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const response = await fetch(`${config.base_url}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      messages,
    }),
    signal: AbortSignal.timeout(config.timeout_ms),
  });

  if (!response.ok) {
    throw new Error(`View LLM request failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: { text?: string }) => (typeof part?.text === 'string' ? part.text : '')).join('\n').trim();
  }
  throw new Error('View LLM response missing content');
}

// ---------------------------------------------------------------------------
// View generation prompt builder
// ---------------------------------------------------------------------------

export function buildViewGenerationMessages(doc: Record<string, unknown>): Array<{ role: string; content: string }> {
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
      content: [
        'You generate retrieval views for a memory system.',
        'Return strict JSON only.',
        'Keys: gist(string), question(string[]).',
        'gist: 1-2 dense sentences that summarize what this memory is about and when it should be recalled.',
        'question: exactly 3 natural-language questions someone may ask later that this memory should help answer.',
        'Use the same dominant language as the source material.',
        'Do not output tags, keywords, cue lists, path fragments, or generic labels.',
        'Do not include markdown fences.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify(payload, null, 2),
    },
  ];
}

// ---------------------------------------------------------------------------
// LLM refinement pipeline
// ---------------------------------------------------------------------------

export async function refineDocumentWithLlm(
  doc: Record<string, unknown>,
  config: ViewLlmConfig,
): Promise<{ gist: string; question: string[]; model: string } | null> {
  try {
    const raw = await chatCompletion(config, buildViewGenerationMessages(doc));
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
