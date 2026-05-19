import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel, EmbeddingModel } from 'ai';
import { getSettings as getSettingsBatch } from '../config/settings';
import type { EmbeddingConfig } from '../core/types';

export type LlmProvider = 'openai_compatible' | 'openai_responses' | 'anthropic';
export type EmbeddingProvider = 'openai_compatible';

export interface ResolvedViewLlmConfig {
  provider: LlmProvider;
  base_url: string;
  api_key: string;
  model: string;
  timeout_ms: number;
  temperature: number;
  api_version: string;
}

export interface ResolvedEmbeddingConfig extends EmbeddingConfig {
  provider: EmbeddingProvider;
}

function normalizeBaseUrl(value: unknown): string {
  return String(value || '').trim().replace(/\/$/, '');
}

function normalizeLlmProvider(value: unknown): LlmProvider {
  const provider = String(value || '').trim();
  if (provider === 'anthropic' || provider === 'openai_responses') return provider;
  return 'openai_compatible';
}

function normalizeEmbeddingProvider(value: unknown): EmbeddingProvider {
  return value === 'openai_compatible' ? 'openai_compatible' : 'openai_compatible';
}

function getExplicitOverride<T extends object, K extends keyof T>(
  source: Partial<T> | null | undefined,
  key: K,
): T[K] | undefined {
  if (!source || typeof source !== 'object' || !Object.prototype.hasOwnProperty.call(source, key)) {
    return undefined;
  }
  return source[key] as T[K] | undefined;
}

function buildOpenAiProvider(config: { base_url: string; api_key: string }): ReturnType<typeof createOpenAI> {
  return createOpenAI({
    baseURL: config.base_url,
    apiKey: config.api_key,
    name: 'lore-openai-compatible',
    fetch: globalThis.fetch,
  });
}

function buildAnthropicProvider(config: ResolvedViewLlmConfig): ReturnType<typeof createAnthropic> {
  return createAnthropic({
    baseURL: config.base_url,
    apiKey: config.api_key,
    headers: config.api_version ? { 'anthropic-version': config.api_version } : undefined,
    name: 'lore-anthropic',
    fetch: globalThis.fetch,
  });
}

export function createLanguageModel(config: ResolvedViewLlmConfig): LanguageModel {
  if (config.provider === 'anthropic') {
    return buildAnthropicProvider(config).messages(config.model);
  }

  const provider = buildOpenAiProvider(config);
  if (config.provider === 'openai_responses') {
    return provider.responses(config.model);
  }
  return provider.chat(config.model);
}

function createEmbeddingModel(config: ResolvedEmbeddingConfig): EmbeddingModel<string> {
  return buildOpenAiProvider(config).embedding(config.model);
}

export async function resolveViewLlmConfig(viewLlm?: Partial<ResolvedViewLlmConfig> | null): Promise<ResolvedViewLlmConfig | null> {
  const override = viewLlm && typeof viewLlm === 'object' ? viewLlm : null;
  const s = await getSettingsBatch([
    'view_llm.provider',
    'view_llm.base_url',
    'view_llm.api_key',
    'view_llm.model',
    'view_llm.temperature',
    'view_llm.timeout_ms',
    'view_llm.api_version',
  ]);
  const provider = normalizeLlmProvider(getExplicitOverride(override, 'provider') ?? s['view_llm.provider'] ?? 'openai_compatible');
  const base_url = normalizeBaseUrl(getExplicitOverride(override, 'base_url') ?? s['view_llm.base_url'] ?? '');
  const api_key = String(getExplicitOverride(override, 'api_key') ?? s['view_llm.api_key'] ?? '').trim();
  const model = String(getExplicitOverride(override, 'model') ?? s['view_llm.model'] ?? '').trim();
  if (!base_url || !api_key || !model) return null;
  return {
    provider,
    base_url,
    api_key,
    model,
    timeout_ms: Number(getExplicitOverride(override, 'timeout_ms') ?? s['view_llm.timeout_ms'] ?? 1800000) || 1800000,
    temperature: Number(getExplicitOverride(override, 'temperature') ?? s['view_llm.temperature'] ?? 0.2),
    api_version: String(getExplicitOverride(override, 'api_version') ?? s['view_llm.api_version'] ?? '').trim(),
  };
}

export async function resolveEmbeddingConfig(embedding?: Partial<ResolvedEmbeddingConfig> | null): Promise<ResolvedEmbeddingConfig> {
  const override = embedding && typeof embedding === 'object' ? embedding : null;
  const s = await getSettingsBatch(['embedding.provider', 'embedding.base_url', 'embedding.api_key', 'embedding.model']);
  const provider = normalizeEmbeddingProvider(getExplicitOverride(override, 'provider') ?? s['embedding.provider'] ?? 'openai_compatible');
  const base_url = normalizeBaseUrl(getExplicitOverride(override, 'base_url') ?? s['embedding.base_url'] ?? '');
  const api_key = String(getExplicitOverride(override, 'api_key') ?? s['embedding.api_key'] ?? '').trim();
  const model = String(getExplicitOverride(override, 'model') ?? s['embedding.model'] ?? '').trim();
  if (!base_url || !api_key || !model) {
    const error: Error & { status?: number } = new Error('Embedding config is missing. Configure embedding.base_url, embedding.api_key, and embedding.model in /settings.');
    error.status = 500;
    throw error;
  }
  return { provider, base_url, api_key, model };
}

export async function getEmbeddingRuntimeConfig(embedding?: Partial<ResolvedEmbeddingConfig> | null): Promise<{ provider: EmbeddingProvider; base_url: string; model: string }> {
  const resolved = await resolveEmbeddingConfig(embedding);
  return {
    provider: resolved.provider,
    base_url: resolved.base_url,
    model: resolved.model,
  };
}
