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

vi.mock('@lobehub/ui/es/Select/Select', () => ({
  default: ({ options = [], value }: { options?: Array<{ label: React.ReactNode; value: string }>; value?: string }) => (
    <select value={value}>
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
  default: ({ children }: { children: React.ReactNode }) => <span data-badge="true">{children}</span>,
}));

vi.mock('@lobehub/ui/es/Input/InputNumber', () => ({
  default: (props: Record<string, unknown>) => <input data-lobe-input-number="true" {...props} />,
}));

vi.mock('@lobehub/ui/es/Empty/index', () => ({
  default: ({ description }: { description?: React.ReactNode }) => <div data-lobe-empty="true">{description}</div>,
}));

vi.mock('@lobehub/ui/es/CopyButton/index', () => ({
  default: ({ content }: { content: string }) => <button data-lobe-copy="true" data-content={content}>Copy</button>,
}));

vi.mock('@lobehub/ui/es/base-ui/Switch/Switch', () => ({
  default: ({ checked }: { checked?: boolean }) => <button data-lobe-switch="true" data-checked={checked} />,
}));

vi.mock('@lobehub/ui/es/ActionIcon/index', () => ({
  default: ({ title }: { title: string }) => <button data-lobe-action-icon="true" title={title} />,
}));

vi.mock('@lobehub/ui/es/CodeDiff/index', () => ({
  CodeDiff: () => <div data-lobe-code-diff="true" />,
}));

vi.mock('@lobehub/ui/es/Block/index', () => ({
  default: ({ children }: { children: React.ReactNode }) => <section data-lobe-block="true">{children}</section>,
}));

vi.mock('@lobehub/ui/es/Modal/index', () => ({
  default: ({ children }: { children: React.ReactNode }) => <section data-lobe-modal="true">{children}</section>,
}));

vi.mock('@lobehub/ui', () => ({
  Dropdown: ({ children, menu }: { children: React.ReactNode; menu?: { items?: Array<{ key: string; label: React.ReactNode }> } }) => (
    <div data-lobe-dropdown="true">
      <div>{children}</div>
      {(menu?.items || []).map((item) => <span key={item.key}>{item.label}</span>)}
    </div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <span data-lobe-tooltip="true">{children}</span>,
}));

vi.mock('../../../../../lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../../components/ConfirmDialog', () => ({
  useConfirm: () => ({ toast: vi.fn() }),
}));

import MemoryEditor from '../MemoryEditor';
import MemoryNodeHeader from '../MemoryNodeHeader';
import MemoryNodeMeta from '../MemoryNodeMeta';
import MemoryViewsSection from '../MemoryViewsSection';

describe('memory detail Lobe wrappers', () => {
  it('renders priority and disclosure editing through AppInput', () => {
    const html = renderToStaticMarkup(
      <MemoryEditor
        editContent="body"
        setEditContent={() => undefined}
        editDisclosure="when useful"
        setEditDisclosure={() => undefined}
        editPriority={2}
        setEditPriority={() => undefined}
        saving={false}
        onSave={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect((html.match(/data-app-input="true"/g) || []).length).toBe(1);
    expect(html).toContain('data-lobe-input-number="true"');
    expect(html).toContain('data-app-text-area="true"');
    expect(html).toContain('!h-[480px]');
    expect(html).toContain('when useful');
  });

  it('renders header actions through the shared dropdown menu wrapper', () => {
    const html = renderToStaticMarkup(
      <MemoryNodeHeader
        node={{ content: 'body', priority: 1 }}
        data={{ node: null, children: [], breadcrumbs: [{ label: 'Memory', path: '' }, { label: 'agent', path: 'agent' }] }}
        domain="core"
        path="agent"
        isRoot={false}
        editing={false}
        moving={false}
        creating={false}
        sidebarOpen
        setSidebarOpen={() => undefined}
        startEditing={() => undefined}
        setCreating={() => undefined}
        setMoving={() => undefined}
        handleRebuildViews={async () => undefined}
        rebuildingViews={false}
        handleDelete={async () => undefined}
        navigateTo={() => undefined}
        refreshData={async () => undefined}
        navigateToHistory={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).toContain('data-lobe-dropdown="true"');
    expect(html).toContain('More');
    expect(html).toContain('data-memory-node-header="true"');
  });

  it('keeps title actions aligned and renders node metadata as a subtitle', () => {
    const html = renderToStaticMarkup(
      <MemoryNodeHeader
        node={{
          content: 'body',
          priority: 0,
          disclosure: 'when useful',
          last_updated_at: '2026-05-20T10:12:00.000Z',
          last_updated_client_type: 'codex',
          last_updated_source: 'api:test',
          glossary_keywords: ['term', 'timezone'],
        }}
        data={{ node: null, children: [], breadcrumbs: [{ label: 'Memory', path: '' }, { label: 'user', path: 'user' }] }}
        domain="preferences"
        path="user"
        isRoot={false}
        editing={false}
        moving={false}
        creating={false}
        sidebarOpen
        setSidebarOpen={() => undefined}
        startEditing={() => undefined}
        setCreating={() => undefined}
        setMoving={() => undefined}
        handleRebuildViews={async () => undefined}
        rebuildingViews={false}
        handleDelete={async () => undefined}
        navigateTo={() => undefined}
        refreshData={async () => undefined}
        navigateToHistory={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).toContain('data-memory-title-row="true"');
    expect(html).toContain('items-center justify-between');
    expect(html).toContain('data-memory-node-subtitle="true"');
    expect(html).toContain('Updated');
    expect(html).toContain('Source');
    expect(html).toContain('#term');
  });

  it('uses the active domain as the title on domain root pages', () => {
    const html = renderToStaticMarkup(
      <MemoryNodeHeader
        node={{ content: '', priority: 0, is_virtual: true }}
        data={{ node: null, children: [], breadcrumbs: [{ label: 'Memory', path: '' }] }}
        domain="preferences"
        path=""
        isRoot
        editing={false}
        moving={false}
        creating={false}
        sidebarOpen
        setSidebarOpen={() => undefined}
        startEditing={() => undefined}
        setCreating={() => undefined}
        setMoving={() => undefined}
        handleRebuildViews={async () => undefined}
        rebuildingViews={false}
        handleDelete={async () => undefined}
        navigateTo={() => undefined}
        refreshData={async () => undefined}
        navigateToHistory={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).toContain('>preferences<');
    expect(html).not.toContain('>root<');
  });

  it('does not render history action in the node header', () => {
    const html = renderToStaticMarkup(
      <MemoryNodeHeader
        node={{ content: 'body', priority: 1 }}
        data={{ node: null, children: [], breadcrumbs: [{ label: 'Memory', path: '' }, { label: 'agent', path: 'agent' }] }}
        domain="core"
        path="agent"
        isRoot={false}
        editing={false}
        moving={false}
        creating={false}
        sidebarOpen
        setSidebarOpen={() => undefined}
        startEditing={() => undefined}
        setCreating={() => undefined}
        setMoving={() => undefined}
        handleRebuildViews={async () => undefined}
        rebuildingViews={false}
        handleDelete={async () => undefined}
        navigateTo={() => undefined}
        refreshData={async () => undefined}
        navigateToHistory={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).not.toContain('History');
  });

  it('renders LLM model metadata through Badge', () => {
    const html = renderToStaticMarkup(
      <MemoryViewsSection
        t={(key) => key}
        defaultOpen
        memoryViews={[
          {
            id: 1,
            view_type: 'summary',
            weight: 1,
            status: 'active',
            text_content: 'view text',
            metadata: { llm_refined: true, llm_model: 'claude-opus-4-7' },
          } as any,
        ]}
      />,
    );

    expect(html).toContain('data-badge="true"');
    expect(html).toContain('claude-opus-4-7');
  });

  it('keeps retrieval views collapsed by default in memory details', () => {
    const html = renderToStaticMarkup(
      <MemoryNodeMeta
        node={{
          memory_views: [
            {
              id: 1,
              view_type: 'gist',
              weight: 1,
              status: 'active',
              text_content: 'collapsed view text',
            },
          ],
        }}
        domain="project"
        path="node"
        editing={false}
        refreshData={async () => undefined}
        navigateTo={() => undefined}
        navigateToHistory={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).toContain('Retrieval views');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('collapsed view text');
  });

  it('merges disclosure and payload into one core card before advanced retrieval views', () => {
    const html = renderToStaticMarkup(
      <MemoryNodeMeta
        node={{
          node_uuid: 'node-1',
          disclosure: 'when user profile is needed',
          content: 'user is da ge',
          memory_views: [
            {
              id: 1,
              view_type: 'gist',
              weight: 1,
              status: 'active',
              text_content: 'collapsed view text',
            },
          ],
        }}
        domain="preferences"
        path="user"
        editing={false}
        refreshData={async () => undefined}
        navigateTo={() => undefined}
        navigateToHistory={() => undefined}
        t={(key) => key}
      />,
    );

    expect(html).toContain('data-memory-core-card="true"');
    expect(html).toContain('data-memory-disclosure-section="true"');
    expect(html).toContain('data-memory-payload-section="true"');
    expect(html).toContain('Trigger / summary');
    expect(html).toContain('Memory content');
    expect(html.indexOf('when user profile is needed')).toBeLessThan(html.indexOf('user is da ge'));
    expect(html.indexOf('user is da ge')).toBeLessThan(html.indexOf('Retrieval views'));
  });
});
