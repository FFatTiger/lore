import { getSettings as getSettingsBatch } from '../config/settings';
import type { EmbeddingConfig } from '../core/types';

function vectorLiteral(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => Number(item)).join(',')}]`;
  return String(value || '[]');
}

async function resolveEmbeddingConfig(embedding?: Partial<EmbeddingConfig> | null): Promise<EmbeddingConfig> {
  const fallback = embedding && typeof embedding === 'object' ? embedding : {};
  const s = await getSettingsBatch(['embedding.base_url', 'embedding.model']);
  const base_url = String(s['embedding.base_url'] || fallback.base_url || '').trim().replace(/\/$/, '');
  const api_key = String(process.env.LORE_EMBEDDING_API_KEY || fallback.api_key || '').trim();
  const model = String(s['embedding.model'] || fallback.model || '').trim();
  if (!base_url || !api_key || !model) {
    const error: any = new Error('Embedding config is missing. Configure embedding.base_url / embedding.model via /settings (or LORE_EMBEDDING_BASE_URL / LORE_EMBEDDING_MODEL env) and set LORE_EMBEDDING_API_KEY.');
    error.status = 500;
    throw error;
  }
  return { base_url, api_key, model };
}

async function embedTexts(embedding: EmbeddingConfig, inputs: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of inputs) {
    const response = await fetch(`${String(embedding.base_url || '').replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${embedding.api_key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: embedding.model, input: text }),
    });
    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.status}`);
    }
    const data = await response.json();
    const rows = [...(data.data || [])].sort((a: any, b: any) => (a.index || 0) - (b.index || 0));
    if (!rows[0]?.embedding) throw new Error('Embedding response missing data rows');
    results.push(rows[0].embedding);
  }
  return results;
}

async function getEmbeddingRuntimeConfig(embedding?: Partial<EmbeddingConfig> | null): Promise<{ base_url: string; model: string }> {
  const resolved = await resolveEmbeddingConfig(embedding);
  return {
    base_url: resolved.base_url,
    model: resolved.model,
  };
}

export { embedTexts, vectorLiteral, resolveEmbeddingConfig, getEmbeddingRuntimeConfig };
