import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../components/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => ({
    confirm: vi.fn(),
    toast: vi.fn(),
  }),
}));

vi.mock('../../../lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

const controller = {
  domain: 'project',
  path: 'parent',
  data: {
    node: { content: 'parent body', priority: 2 },
    children: [{ path: 'parent/child_one', name: 'child_one' }],
    breadcrumbs: [{ label: 'Memory', path: '' }, { label: 'parent', path: 'parent' }],
  },
  domains: [{ domain: 'project', root_count: 1 }],
  node: { content: 'parent body', priority: 2 },
  isRoot: false,
  loading: false,
  error: null,
  sidebarOpen: true,
  editing: false,
  editContent: '',
  editDisclosure: '',
  editPriority: 2,
  saving: false,
  moving: false,
  creating: false,
  rebuildingViews: false,
  treeVersion: 0,
  setSidebarOpen: vi.fn(),
  setEditContent: vi.fn(),
  setEditDisclosure: vi.fn(),
  setEditPriority: vi.fn(),
  setMoving: vi.fn(),
  setCreating: vi.fn(),
  navigateTo: vi.fn(),
  navigateToHistory: vi.fn(),
  refreshData: vi.fn(),
  refreshNavigation: vi.fn(),
  startEditing: vi.fn(),
  cancelEditing: vi.fn(),
  handleSave: vi.fn(),
  handleDelete: vi.fn(),
  handleRebuildViews: vi.fn(),
};

vi.mock('../useMemoryBrowserController', () => ({
  useMemoryBrowserController: () => controller,
}));

vi.mock('../components/MemoryBrowserSidebar', () => ({
  default: ({ treeVersion }: { treeVersion?: number }) => <aside>sidebar-tree-version:{String(treeVersion)}</aside>,
}));

vi.mock('../components/MemoryNodeHeader', () => ({
  default: () => <header>node header</header>,
}));

vi.mock('../components/MemoryNodeMeta', () => ({
  default: () => <section>node meta</section>,
}));

vi.mock('../components/MemoryBrowserPanels', () => ({
  default: ({ refreshNavigation }: { refreshNavigation?: () => Promise<void> }) => (
    <section>panels-refresh-navigation:{String(typeof refreshNavigation)}</section>
  ),
}));

vi.mock('../components/MemoryChildrenList', () => ({
  default: ({ childItems, isRoot }: { childItems?: unknown[]; isRoot: boolean }) => (
    <section>children-list:{String(isRoot)}:{childItems?.length || 0}</section>
  ),
}));

import MemoryBrowser from '../MemoryBrowser';

describe('MemoryBrowser actions surface', () => {
  it('renders children on non-root memory nodes and wires navigation refresh to action panels', () => {
    const html = renderToStaticMarkup(<MemoryBrowser />);

    expect(html).toContain('children-list:false:1');
    expect(html).toContain('sidebar-tree-version:0');
    expect(html).toContain('panels-refresh-navigation:function');
  });
});
