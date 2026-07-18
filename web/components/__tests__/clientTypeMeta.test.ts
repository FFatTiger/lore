import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_CLIENT_TYPES,
  clientTypeAssetPath,
  clientTypeInitials,
  clientTypeLabel,
} from '../clientTypeMeta';

describe('clientTypeMeta', () => {
  it('exposes Pi display metadata', () => {
    expect(KNOWN_CLIENT_TYPES).toContain('pi');
    expect(clientTypeLabel('pi')).toBe('Pi');
    expect(clientTypeAssetPath('pi')).toBe('/channel-icons/pi.svg');
    expect(clientTypeInitials('pi')).toBe('π');
  });

  it('exposes OpenCode display metadata and the approved official asset', () => {
    expect(KNOWN_CLIENT_TYPES).toContain('opencode');
    expect(clientTypeLabel('OpenCode')).toBe('OpenCode');
    expect(clientTypeAssetPath('opencode')).toBe('/channel-icons/opencode.svg');
    expect(clientTypeInitials('opencode')).toBe('OC');

    const asset = resolve(process.cwd(), 'public/channel-icons/opencode.svg');
    const digest = createHash('sha256').update(readFileSync(asset)).digest('hex');
    expect(digest).toBe('7cfa6e9d6726f7c9fa26c7d9aef0dfec52d20a137380454340f30f12ccbfd302');
  });
});
