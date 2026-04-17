import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  sql: vi.fn(),
}));
vi.mock('../lore/memory/boot', () => ({
  bootView: vi.fn(),
}));
vi.mock('../lore/memory/browse', () => ({
  getNodePayload: vi.fn(),
  listDomains: vi.fn(),
}));
vi.mock('../lore/memory/write', () => ({
  createNode: vi.fn(),
  updateNodeByPath: vi.fn(),
  deleteNodeByPath: vi.fn(),
  moveNode: vi.fn(),
}));
vi.mock('../lore/search/search', () => ({
  searchMemories: vi.fn(),
}));
vi.mock('../lore/search/glossary', () => ({
  addGlossaryKeyword: vi.fn(),
  removeGlossaryKeyword: vi.fn(),
}));
vi.mock('../lore/memory/session', () => ({
  markSessionRead: vi.fn(),
  listSessionReads: vi.fn(),
  clearSessionReads: vi.fn(),
}));
vi.mock('../lore/recall/recallEventLog', () => ({
  markRecallEventsUsedInAnswer: vi.fn(),
}));
vi.mock('../lore/ops/policy', () => ({
  validateCreatePolicy: vi.fn(),
  validateUpdatePolicy: vi.fn(),
  validateDeletePolicy: vi.fn(),
}));

import { createMcpServer } from '../mcpServer';
import { createNode, deleteNodeByPath, moveNode, updateNodeByPath } from '../lore/memory/write';
import { validateCreatePolicy, validateDeletePolicy, validateUpdatePolicy } from '../lore/ops/policy';

const mockCreateNode = vi.mocked(createNode);
const mockUpdateNodeByPath = vi.mocked(updateNodeByPath);
const mockDeleteNodeByPath = vi.mocked(deleteNodeByPath);
const mockMoveNode = vi.mocked(moveNode);
const mockValidateCreatePolicy = vi.mocked(validateCreatePolicy);
const mockValidateUpdatePolicy = vi.mocked(validateUpdatePolicy);
const mockValidateDeletePolicy = vi.mocked(validateDeletePolicy);

function getToolHandler(name: string) {
  const server = createMcpServer();
  return (server as any)._registeredTools[name].handler as (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

describe('embedded MCP contract projections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateCreatePolicy.mockResolvedValue({ errors: [], warnings: [] } as any);
    mockValidateUpdatePolicy.mockResolvedValue({ errors: [], warnings: [] } as any);
    mockValidateDeletePolicy.mockResolvedValue({ errors: [], warnings: [] } as any);
  });

  it('projects create receipts from canonical uri fields', async () => {
    mockCreateNode.mockResolvedValueOnce({
      success: true,
      operation: 'create',
      uri: 'core://agent/profile',
      path: 'agent/profile',
      node_uuid: 'uuid-create',
    } as any);

    const handler = getToolHandler('lore_create_node');
    const result = await handler({
      domain: 'core',
      parent_path: 'agent',
      title: 'profile',
      content: 'hello',
      priority: 2,
      glossary: [],
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Created core://agent/profile' }],
    });
  });

  it('projects update receipts from canonical uri fields', async () => {
    mockUpdateNodeByPath.mockResolvedValueOnce({
      success: true,
      operation: 'update',
      uri: 'core://agent/profile',
      path: 'agent/profile',
      node_uuid: 'uuid-update',
    } as any);

    const handler = getToolHandler('lore_update_node');
    const result = await handler({
      uri: 'core://stale/path',
      content: 'updated',
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Updated core://agent/profile' }],
    });
  });

  it('projects delete receipts from deleted and canonical uri fields', async () => {
    mockValidateDeletePolicy.mockResolvedValueOnce({
      errors: [],
      warnings: ['read before delete'],
    } as any);
    mockDeleteNodeByPath.mockResolvedValueOnce({
      success: true,
      operation: 'delete',
      uri: 'core://canonical/profile',
      path: 'canonical/profile',
      node_uuid: 'uuid-delete',
      deleted_uri: 'core://legacy/profile',
    } as any);

    const handler = getToolHandler('lore_delete_node');
    const result = await handler({
      uri: 'core://legacy/profile',
    });

    expect(result.content[0].text).toContain('Deleted core://legacy/profile (canonical: core://canonical/profile)');
    expect(result.content[0].text).toContain('Policy warnings:');
    expect(result.content[0].text).toContain('read before delete');
  });

  it('projects move receipts from canonical old and new uri fields', async () => {
    mockMoveNode.mockResolvedValueOnce({
      success: true,
      operation: 'move',
      uri: 'core://new/path',
      path: 'new/path',
      node_uuid: 'uuid-move',
      old_uri: 'core://old/path',
      new_uri: 'core://new/path',
    } as any);

    const handler = getToolHandler('lore_move_node');
    const result = await handler({
      old_uri: 'core://old/path',
      new_uri: 'core://new/path',
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Moved core://old/path → core://new/path' }],
    });
  });
});
