import { describe, expect, it } from 'vitest';
import { getBootSetupRedirect, isSettingsPath, isSetupPath } from '@/lib/bootSetup';

describe('bootSetup routing helpers', () => {
  it('detects setup paths', () => {
    expect(isSetupPath('/setup')).toBe(true);
    expect(isSetupPath('/setup/extra')).toBe(true);
    expect(isSetupPath('/memory')).toBe(false);
  });

  it('detects settings paths', () => {
    expect(isSettingsPath('/settings')).toBe(true);
    expect(isSettingsPath('/settings/advanced')).toBe(true);
    expect(isSettingsPath('/setup')).toBe(false);
  });

  it('redirects incomplete boot state to setup', () => {
    expect(getBootSetupRedirect('/memory', 'partial')).toBe('/setup');
    expect(getBootSetupRedirect('/', 'uninitialized')).toBe('/setup');
  });

  it('allows settings and setup while boot is incomplete', () => {
    expect(getBootSetupRedirect('/settings', 'partial')).toBeNull();
    expect(getBootSetupRedirect('/setup', 'uninitialized')).toBeNull();
  });

  it('redirects completed setup back to memory', () => {
    expect(getBootSetupRedirect('/setup', 'complete')).toBe('/memory');
    expect(getBootSetupRedirect('/', 'complete')).toBe('/memory');
  });

  it('does nothing when already on a normal page after completion', () => {
    expect(getBootSetupRedirect('/memory', 'complete')).toBeNull();
    expect(getBootSetupRedirect('/recall', 'complete')).toBeNull();
  });

  it('does nothing when boot state is unavailable', () => {
    expect(getBootSetupRedirect('/memory', null)).toBeNull();
    expect(getBootSetupRedirect('/memory', undefined)).toBeNull();
  });
});
