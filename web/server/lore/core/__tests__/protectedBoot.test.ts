import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../memory/boot', () => ({
  getBootNodeSpec: vi.fn(),
}));

import { getBootNodeSpec } from '../../memory/boot';
import {
  inspectProtectedBootOperation,
  describeProtectedBootOperation,
} from '../protectedBoot';

const mockGetBootNodeSpec = vi.mocked(getBootNodeSpec);

describe('inspectProtectedBootOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBootNodeSpec.mockReturnValue(null);
  });

  it('inspects update on protected boot uri', () => {
    mockGetBootNodeSpec.mockReturnValue({
      uri: 'core://agent',
      role: 'agent',
      role_label: 'workflow constraints',
      purpose: 'Working rules',
      dream_protection: 'protected',
    } as any);

    expect(inspectProtectedBootOperation('update_node', { uri: 'core://agent' })).toEqual({
      operation: 'update_node',
      match: 'uri',
      blocked_uri: 'core://agent',
      spec: expect.objectContaining({ role: 'agent' }),
    });
  });

  it('prefers old_uri when move source is protected', () => {
    mockGetBootNodeSpec.mockImplementation((uri) => {
      if (uri === 'core://soul') {
        return {
          uri: 'core://soul',
          role: 'soul',
          role_label: 'style / persona / self-definition',
          purpose: 'Persona baseline',
          dream_protection: 'protected',
        } as any;
      }
      return null;
    });

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
