import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui', () => ({
  AppPasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input data-app-password-input="true" type="password" {...props} />,
}));

vi.mock('../lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../lib/api', () => ({
  getDomains: vi.fn(),
}));

import TokenAuth from '../TokenAuth';

describe('TokenAuth Lobe wrappers', () => {
  it('renders the token field through AppPasswordInput', () => {
    const html = renderToStaticMarkup(<TokenAuth onAuthenticated={() => undefined} />);

    expect(html).toContain('data-app-password-input="true"');
    expect(html).toContain('Enter your token');
  });
});
