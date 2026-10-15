import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createLoreTools } from '../tools.js';

type ToolContract = {
  name: string;
  description: string;
  parameters: Array<{ name: string; description: string; required: boolean }>;
};

const contracts = JSON.parse(readFileSync(
  fileURLToPath(new URL('../tool-contracts.json', import.meta.url)),
  'utf8',
)) as ToolContract[];

function description(schema: unknown): string {
  return String((schema as { description?: unknown }).description ?? '');
}

function optional(schema: unknown): boolean {
  const candidate = schema as { safeParse(value: unknown): { success: boolean } };
  return candidate.safeParse(undefined).success;
}

describe('native OpenCode tool contract parity', () => {
  it('matches canonical MCP names, descriptions, argument descriptions, and required fields', () => {    const tools = createLoreTools({
      baseUrl: 'https://api.example.test',
      apiToken: '',
      startupTimeoutMs: 8_000,
      requestTimeoutMs: 30_000,
      defaultDomain: 'core',
      skillsEnabled: true,
      loreHome: '/tmp/lore-home',
    });

    expect(Object.keys(tools)).toEqual(contracts.map((contract) => contract.name));
    for (const contract of contracts) {
      const definition = tools[contract.name];
      expect(definition.description).toBe(contract.description);
      expect(Object.keys(definition.args)).toEqual(contract.parameters.map((parameter) => parameter.name));
      for (const parameter of contract.parameters) {
        const schema = definition.args[parameter.name];
        expect(description(schema)).toBe(parameter.description);
        expect(!optional(schema)).toBe(parameter.required);
      }
    }
  });

  it('lore_search contract advertises full instead of content_limit', () => {
    const search = contracts.find((contract) => contract.name === 'lore_search');
    expect(search).toBeDefined();
    const names = search!.parameters.map((parameter) => parameter.name);
    expect(names).toContain('full');
    expect(names).not.toContain('content_limit');
    expect(search!.parameters.find((parameter) => parameter.name === 'full')!.description)
      .toBe('Include the full content of the top result.');
  });

  it('lore_get_node contract marks recall ids as optional with auto attribution', () => {
    const getNode = contracts.find((contract) => contract.name === 'lore_get_node');
    expect(getNode!.description).toContain('if available');
    expect(getNode!.description).toContain('automatically by newer servers');
    expect(getNode!.parameters.find((parameter) => parameter.name === 'query_id')!.description)
      .toContain('attributed automatically');
  });

  it('lore_create_node and lore_update_node contracts match the new edit surface', () => {
    const create = contracts.find((contract) => contract.name === 'lore_create_node');
    expect(create!.parameters.find((parameter) => parameter.name === 'glossary')!.description)
      .toContain('Terms a person would actually type');

    const update = contracts.find((contract) => contract.name === 'lore_update_node');
    expect(update!.description).toContain('targeted edits');
    expect(update!.description).toContain('instead of appending dated logs');
    const names = update!.parameters.map((parameter) => parameter.name);
    expect(names).toContain('old_text');
    expect(names).toContain('new_text');
  });
});
