import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: <T,>(initial: T) => [initial, vi.fn()] as const,
  };
});

vi.mock('@lobehub/ui/es/Modal/index', () => ({
  default: ({
    children,
    open,
    title,
    okText,
    cancelText,
    okButtonProps,
    cancelButtonProps,
    footer,
    centered,
    className,
  }: {
    children: React.ReactNode;
    open?: boolean;
    title?: React.ReactNode;
    okText?: React.ReactNode;
    cancelText?: React.ReactNode;
    okButtonProps?: { danger?: boolean };
    cancelButtonProps?: { style?: React.CSSProperties };
    footer?: React.ReactNode;
    centered?: boolean;
    className?: string;
  }) => (
    <section
      data-lobe-modal="true"
      data-open={String(open)}
      data-ok-danger={String(Boolean(okButtonProps?.danger))}
      data-cancel-hidden={String(cancelButtonProps?.style?.display === 'none')}
      data-class-name={className || ''}
      data-centered={String(Boolean(centered))}
    >
      <h1>{title}</h1>
      <div>{children}</div>
      {footer === null ? null : <footer>{cancelText}{okText}</footer>}
    </section>
  ),
}));

vi.mock('sonner', () => ({
  Toaster: () => <div data-toaster="true" />,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../ui', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

vi.mock('../../lib/theme', () => ({
  useTheme: () => ({ theme: 'dark' }),
}));

vi.mock('../../lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { ConfirmModalForTest } from '../ConfirmDialog';

function renderConfirmModal(options: { destructive?: boolean; hideCancel?: boolean } = {}) {
  return renderToStaticMarkup(
    <ConfirmModalForTest
      dialog={{
        title: 'Delete memory',
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        destructive: options.destructive,
        hideCancel: options.hideCancel,
        resolve: () => undefined,
      }}
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );
}

describe('ConfirmProvider modal', () => {
  it('renders confirmations through Lobe Modal with message and actions', () => {
    const html = renderConfirmModal();

    expect(html).toContain('data-lobe-modal="true"');
    expect(html).toContain('data-open="true"');
    expect(html).toContain('data-centered="true"');
    expect(html).toContain('rounded-2xl');
    expect(html).toContain('border-separator-thin');
    expect(html).toContain('bg-bg-elevated');
    expect(html).toContain('shadow-xl');
    expect(html).toContain('Delete memory');
    expect(html).toContain('This cannot be undone.');
    expect(html).toContain('Cancel');
    expect(html).toContain('Delete');
  });

  it('maps destructive confirmations to a danger ok button', () => {
    const html = renderConfirmModal({ destructive: true });

    expect(html).toContain('data-ok-danger="true"');
  });

  it('can hide the cancel action', () => {
    const html = renderConfirmModal({ hideCancel: true });

    expect(html).toContain('data-cancel-hidden="true"');
  });
});
