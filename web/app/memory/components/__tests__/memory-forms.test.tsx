import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/ui/es/Button/index', () => ({
  default: ({ children, danger: _danger, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) => <button {...props}>{children}</button>,
}));

vi.mock('@lobehub/ui/es/Alert/index', () => ({
  default: ({ description }: { description?: React.ReactNode }) => <aside>{description}</aside>,
}));

vi.mock('@lobehub/ui/es/Input/InputPassword', () => ({
  default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input data-app-password-input="true" type="password" {...props} />,
}));

vi.mock('@lobehub/ui/es/Avatar/index', () => ({
  default: ({ avatar, title }: { avatar?: React.ReactNode; title?: React.ReactNode }) => <div>{avatar || title}</div>,
}));

vi.mock('@lobehub/ui/es/Input/Input', () => ({
  default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input data-app-input="true" {...props} />,
}));

vi.mock('@lobehub/ui/es/Input/TextArea', () => ({
  default: ({ resize: _resize, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { resize?: boolean }) => <textarea data-app-text-area="true" {...props} />,
}));

vi.mock('@lobehub/ui/es/Input/InputNumber', () => ({
  default: (props: Record<string, unknown>) => <input data-lobe-input-number="true" type="number" {...props} />,
}));

vi.mock('@lobehub/ui/es/Select/Select', () => ({
  default: ({ options = [], value }: { options?: Array<{ label: React.ReactNode; value: string }>; value?: string }) => (
    <select value={value} readOnly>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock('@lobehub/ui/es/Accordion/index', () => ({
  Accordion: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionItem: ({ children, title }: { children: React.ReactNode; title: React.ReactNode }) => <section><div>{title}</div>{children}</section>,
}));

vi.mock('@lobehub/ui/es/Segmented/index', () => ({
  default: ({ options = [] }: { options?: Array<{ label: React.ReactNode; value: string }> }) => <div>{options.map((option) => option.label)}</div>,
}));

vi.mock('@lobehub/ui/es/Checkbox/index', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div data-lobe-checkbox="true">{children}</div>,
}));

vi.mock('@lobehub/ui/es/Tag/Tag', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('../../../../../lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../../../lib/api', () => ({
  api: { post: vi.fn() },
}));

import CreateNodeForm from '../CreateNodeForm';
import MoveDialog from '../MoveDialog';

describe('memory form Lobe input wrappers', () => {
  it('renders title and disclosure through AppInput and priority through AppInputNumber', () => {
    const html = renderToStaticMarkup(
      <CreateNodeForm domain="core" parentPath="agent" onCreated={() => undefined} onCancel={() => undefined} />,
    );

    expect(html).toContain('data-app-input="true"');
    expect((html.match(/data-app-input="true"/g) || []).length).toBe(2);
    expect(html).toContain('data-lobe-input-number="true"');
    expect(html).toContain('type="number"');
    expect(html).toContain('snake_case_name');
    expect(html).toContain('When should this memory be recalled?');
    expect(html).toContain('data-app-text-area="true"');
  });

  it('renders the new URI field through AppInput', () => {
    const html = renderToStaticMarkup(
      <MoveDialog domain="core" path="agent" onMoved={() => undefined} onCancel={() => undefined} />,
    );

    expect(html).toContain('data-app-input="true"');
    expect(html).toContain('core://agent');
  });
});
