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
vi.mock('../lore/recall/recallEventLog', () => ({
  markRecallEventsUsedInAnswer: vi.fn(),
}));
vi.mock('../lore/ops/policy', () => ({
  validateCreatePolicy: vi.fn(),
  validateUpdatePolicy: vi.fn(),
  validateDeletePolicy: vi.fn(),
}));

import { createMcpServer } from '../mcpServer';
import { getNodePayload } from '../lore/memory/browse';
import { markRecallEventsUsedInAnswer } from '../lore/recall/recallEventLog';
import { createNode, deleteNodeByPath, moveNode, updateNodeByPath } from '../lore/memory/write';
import { validateCreatePolicy, validateDeletePolicy, validateUpdatePolicy } from '../lore/ops/policy';

const mockGetNodePayload = vi.mocked(getNodePayload);
const mockMarkRecallEventsUsedInAnswer = vi.mocked(markRecallEventsUsedInAnswer);
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

  it('tells agents to pass recall session and query ids when opening recalled nodes', () => {
    const server = createMcpServer();
    const tool = (server as any)._registeredTools.lore_get_node;
    const shape = tool.inputSchema._def.shape();
    const text = [
      tool.description,
      shape.session_id.description,
      shape.query_id.description,
    ].join('\n');

    expect(text).toContain('REQUIRED when opening a URI from a <recall>');
    expect(text).toContain('copy the exact session_id');
    expect(text).toContain('copy the exact query_id');
    expect(shape.session_id.isOptional()).toBe(true);
    expect(shape.query_id.isOptional()).toBe(true);
    expect(tool.inputSchema.safeParse({ uri: 'core://agent' }).success).toBe(true);
    expect(tool.inputSchema.safeParse({
      uri: 'core://agent',
      session_id: 'sess-1',
      query_id: 'query-1',
    }).success).toBe(true);
  });

  it('does not expose session read tracking tools', () => {
    const server = createMcpServer();
    const tools = (server as any)._registeredTools;

    expect(tools.lore_list_session_reads).toBeUndefined();
    expect(tools.lore_clear_session_reads).toBeUndefined();
  });

  it('describes semantic parent requirements for create and move tools', () => {
    const server = createMcpServer();
    const tools = (server as any)._registeredTools;
    const createShape = tools.lore_create_node.inputSchema._def.shape();
    const moveShape = tools.lore_move_node.inputSchema._def.shape();

    expect(tools.lore_create_node.description).toContain('real abstraction parent node');
    expect(createShape.uri.description).toContain('real abstraction parent nodes');
    expect(createShape.parent_path.description).toContain('real abstraction node');
    expect(tools.lore_move_node.description).toContain('semantic memory tree');
    expect(tools.lore_move_node.description).toContain('reparents');
    expect(moveShape.new_uri.description).toContain('real abstraction node');
  });

  it('records recall usage without session read tracking when opening a recalled node', async () => {
    mockGetNodePayload.mockResolvedValueOnce({
      node: { uri: 'core://agent', node_uuid: 'node-1', content: 'Agent' },
      children: [],
    } as any);

    const handler = getToolHandler('lore_get_node');
    const result = await handler({ uri: 'core://agent', session_id: 'sess-1', query_id: 'query-1' });

    expect(result.content[0].text).toContain('core://agent');
    expect(mockMarkRecallEventsUsedInAnswer).toHaveBeenCalledWith({
      queryId: 'query-1',
      sessionId: 'sess-1',
      nodeUris: ['core://agent'],
      source: 'mcp:lore_get_node',
      success: true,
      clientType: null,
    });
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

  it('exposes glossary mutations on update without full replacement', () => {
    const server = createMcpServer();
    const tool = (server as any)._registeredTools.lore_update_node;
    const shape = tool.inputSchema._def.shape();

    expect(shape.glossary).toBeUndefined();
    expect(shape.glossary_add).toBeDefined();
    expect(shape.glossary_remove).toBeDefined();
    expect(tool.description).not.toContain('glossary fields');
  });

  it('passes glossary mutations into the canonical update operation', async () => {
    mockUpdateNodeByPath.mockResolvedValueOnce({
      success: true,
      operation: 'update',
      uri: 'core://agent/profile',
      path: 'agent/profile',
      node_uuid: 'uuid-update',
    } as any);

    const handler = getToolHandler('lore_update_node');
    const result = await handler({
      uri: 'core://agent/profile',
      content: 'updated',
      glossary_add: ['alpha', ' alpha '],
      glossary_remove: ['old_keyword'],
    });

    expect(mockUpdateNodeByPath).toHaveBeenCalledWith(
      {
        domain: 'core',
        path: 'agent/profile',
        content: 'updated',
        glossaryAdd: ['alpha'],
        glossaryRemove: ['old_keyword'],
      },
      { source: 'mcp:lore_update_node', client_type: null },
    );
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Updated core://agent/profile\nglossary+ alpha\nglossary- old_keyword' }],
    });
  });

  it('ignores glossary replacement arguments on update', async () => {
    mockUpdateNodeByPath.mockResolvedValueOnce({
      success: true,
      operation: 'update',
      uri: 'core://agent/profile',
      path: 'agent/profile',
      node_uuid: 'uuid-update',
    } as any);

    const handler = getToolHandler('lore_update_node');
    const result = await handler({
      uri: 'core://agent/profile',
      glossary: ['alpha', ' alpha ', 'beta'],
      glossary_add: ['gamma'],
    });

    expect(mockUpdateNodeByPath).toHaveBeenCalledWith(
      {
        domain: 'core',
        path: 'agent/profile',
        glossaryAdd: ['gamma'],
        glossaryRemove: [],
      },
      { source: 'mcp:lore_update_node', client_type: null },
    );
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Updated core://agent/profile\nglossary+ gamma' }],
    });
  });

  it('projects delete receipts from deleted and canonical uri fields', async () => {
    mockValidateDeletePolicy.mockResolvedValueOnce({
      errors: [],
      warnings: ['delete warning'],
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
    expect(result.content[0].text).toContain('delete warning');
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
