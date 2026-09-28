import { describe, it, expect } from 'vitest';

import {
  inspectProtectedBootOperation,
  describeProtectedBootOperation,
} from '../protectedBoot';

describe('inspectProtectedBootOperation', () => {
  it('inspects update on protected boot uri', () => {
    expect(inspectProtectedBootOperation('update_node', { uri: 'core://agent' })).toEqual({
      operation: 'update_node',
      match: 'uri',
      blocked_uri: 'core://agent',
      spec: expect.objectContaining({ role: 'agent' }),
    });
  });

  it('prefers old_uri when move source is protected', () => {
    expect(inspectProtectedBootOperation('move_node', {
      old_uri: 'core://soul',
      new_uri: 'core://archive/soul',
    })).toEqual({
      operation: 'move_node',
      match: 'old_uri',
      blocked_uri: 'core://soul',
      requested_old_uri: 'core://soul',
      requested_new_uri: 'core://archive/soul',
      spec: expect.objectContaining({ role: 'soul' }),
    });
  });

  it('blocks delete on the ZCode boot URI', () => {
    expect(inspectProtectedBootOperation('delete_node', {
      uri: 'CORE://AGENT/ZCODE',
    })).toEqual({
      operation: 'delete_node',
      match: 'uri',
      blocked_uri: 'core://agent/zcode',
      spec: expect.objectContaining({
        id: 'agent-zcode',
        client_type: 'zcode',
        dream_protection: 'protected',
      }),
    });
  });

  it('blocks delete on the OpenCode boot URI', () => {
    expect(inspectProtectedBootOperation('delete_node', {
      uri: 'CORE://AGENT/OPENCODE',
    })).toEqual({
      operation: 'delete_node',
      match: 'uri',
      blocked_uri: 'core://agent/opencode',
      spec: expect.objectContaining({
        id: 'agent-opencode',
        client_type: 'opencode',
        dream_protection: 'protected',
      }),
    });
  });

  it('blocks moving from the OpenCode boot URI', () => {
    expect(inspectProtectedBootOperation('move_node', {
      old_uri: 'core://agent/opencode',
      new_uri: 'core://archive/opencode',
    })).toMatchObject({
      operation: 'move_node',
      match: 'old_uri',
      blocked_uri: 'core://agent/opencode',
    });
  });

  it('blocks moving another node onto the OpenCode boot URI', () => {
    expect(inspectProtectedBootOperation('move_node', {
      old_uri: 'core://scratch/opencode',
      new_uri: 'core://agent/opencode',
    })).toMatchObject({
      operation: 'move_node',
      match: 'new_uri',
      blocked_uri: 'core://agent/opencode',
    });
  });

  it('returns null for unprotected operations', () => {
    expect(inspectProtectedBootOperation('get_node', { uri: 'core://agent' })).toBeNull();
    expect(inspectProtectedBootOperation('move_node', { old_uri: 'core://x', new_uri: 'core://y' })).toBeNull();
  });
});

describe('describeProtectedBootOperation', () => {
  it('formats update message with actor', () => {
    const message = describeProtectedBootOperation({
      operation: 'update_node',
      match: 'uri',
      blocked_uri: 'core://agent',
      spec: {
        uri: 'core://agent',
        role: 'agent',
        role_label: 'workflow constraints',
        purpose: 'Working rules',
        dream_protection: 'protected',
      },
    }, 'dream:auto');

    expect(message).toBe('dream:auto cannot update protected boot node core://agent (workflow constraints)');
  });

  it('formats move target reservation message', () => {
    const message = describeProtectedBootOperation({
      operation: 'move_node',
      match: 'new_uri',
      blocked_uri: 'preferences://user',
      requested_old_uri: 'core://scratch/user_profile',
      requested_new_uri: 'preferences://user',
      spec: {
        uri: 'preferences://user',
        role: 'user',
        role_label: 'stable user definition',
        purpose: 'Stable user context',
        dream_protection: 'protected',
      },
    }, 'dream:auto');

    expect(message).toBe('dream:auto cannot move a node onto protected boot path preferences://user (stable user definition)');
  });
});
