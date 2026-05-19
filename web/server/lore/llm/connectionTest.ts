import { generateText as generateSdkText } from 'ai';
import {
  createLanguageModel,
  resolveEmbeddingConfig,
  resolveViewLlmConfig,
  type ResolvedEmbeddingConfig,
  type ResolvedViewLlmConfig,
} from './config';

export type SettingsConnectionSection = 'embedding' | 'view_llm';

export interface SettingsConnectionTestResult {
  ok: true;
  section: SettingsConnectionSection;
  model: string;
  detail?: string;
}

type SettingsConnectionPatch = Record<string, unknown>;

const CONNECTION_TEST_INPUT = 'Lore connection test';
const CONNECTION_TEST_TIMEOUT_MS = 15_000;

function statusError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function errorMessage(error: unknown): string {
  return (error as Error)?.message || String(error || 'Unknown error');
}

function normalizeBaseUrl(value: string): string {
  return String(value || '').trim().replace(/\/$/, '');
}

function getJsonHeaders(apiKey: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function compactOverrides<T extends object>(patch: SettingsConnectionPatch, prefix: SettingsConnectionSection, keys: Array<keyof T & string>): Partial<T> {
  const overrides: Partial<T> = {};
  for (const key of keys) {
    const settingKey = `${prefix}.${key}`;
    if (Object.prototype.hasOwnProperty.call(patch, settingKey)) {
      overrides[key as keyof T] = patch[settingKey] as T[keyof T];
    }
  }
  return overrides;
}

async function testEmbeddingConnection(patch: SettingsConnectionPatch): Promise<SettingsConnectionTestResult> {
  const config = await resolveEmbeddingConfig(compactOverrides<ResolvedEmbeddingConfig>(patch, 'embedding', [
    'provider',
    'base_url',
    'api_key',
    'model',
  ]));

  try {
    const response = await fetch(`${normalizeBaseUrl(config.base_url)}/embeddings`, {
      method: 'POST',
      headers: getJsonHeaders(config.api_key),
      body: JSON.stringify({ model: config.model, input: CONNECTION_TEST_INPUT }),
      signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json() as { data?: Array<{ embedding?: unknown }> };
    const vector = data.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('response missing embedding vector');
    }

    return {
      ok: true,
      section: 'embedding',
      model: config.model,
      detail: `dimensions: ${vector.length}`,
    };
  } catch (error) {
    throw statusError(`Embedding connection failed: ${errorMessage(error)}`, 502);
  }
}

async function testViewLlmConnection(patch: SettingsConnectionPatch): Promise<SettingsConnectionTestResult> {
  const config = await resolveViewLlmConfig(compactOverrides<ResolvedViewLlmConfig>(patch, 'view_llm', [
    'provider',
    'base_url',
    'api_key',
    'model',
    'timeout_ms',
    'temperature',
    'api_version',
  ]));
  if (!config) throw statusError('View LLM config is missing. Configure view_llm.base_url, view_llm.api_key, and view_llm.model in /settings.', 400);

  try {
    const result = await generateSdkText({
      model: createLanguageModel(config),
      prompt: 'Reply with OK only.',
      temperature: 0,
      maxOutputTokens: 8,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(Math.min(Math.max(1000, config.timeout_ms || CONNECTION_TEST_TIMEOUT_MS), 30_000)),
    });
    if (!result.text.trim()) throw new Error('response missing content');

    return {
      ok: true,
      section: 'view_llm',
      model: config.model,
      detail: result.text.trim().slice(0, 80),
    };
  } catch (error) {
    throw statusError(`View LLM connection failed: ${errorMessage(error)}`, 502);
  }
}

export async function testSettingsConnection(
  section: SettingsConnectionSection,
  patch: SettingsConnectionPatch = {},
): Promise<SettingsConnectionTestResult> {
  if (section === 'embedding') return testEmbeddingConnection(patch);
  if (section === 'view_llm') return testViewLlmConnection(patch);
  throw statusError(`Unknown settings connection section: ${section}`, 400);
}
