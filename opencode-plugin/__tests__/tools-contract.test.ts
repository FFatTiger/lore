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
  it('matches canonical MCP names, descriptions, argument descriptions, and required fields', () => {
    const tools = createLoreTools({
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
});
