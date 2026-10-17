import { getNodePayload } from '../memory/browse';
import { parseUri } from '../core/utils';
import { hasDateTimePathSuffix, isAllowedDateArchivedPath, lastPathSegment } from '../memory/pathRules';
import { listMemoryViewsByNode } from '../view/memoryViewQueries';
import { getNodeWriteHistory } from '../memory/writeEvents';
import { getProtectedBootOperation } from './dreamToolBootGuard';

interface DreamReadEventContext {
  source: string;
  session_id?: string | null;
}

interface DreamTreeNode {
  uri: string;
  node_uuid: string | null;
  priority: number | null;
  disclosure: string | null;
  content_snippet: string;
  child_count: number;
  children: DreamTreeNode[];
}

interface DreamTreeInspection {
  uri: string;
  depth: number;
  max_nodes: number;
  visited_nodes: number;
  truncated: boolean;
  tree: DreamTreeNode;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function snippet(content: unknown): string {
  const text = String(content || '');
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function preview(content: unknown, maxChars: number): string {
  const text = String(content || '');
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function gistSnippetFromViews(views: unknown): string {
  if (!Array.isArray(views)) return '';
  const gist = views.find((view) => {
    if (!view || typeof view !== 'object') return false;
    const record = view as Record<string, unknown>;
    return record.view_type === 'gist' && typeof record.text_content === 'string' && record.text_content.trim();
  }) as Record<string, unknown> | undefined;
  return snippet(gist?.text_content);
}

async function getChildGistSnippet(child: Record<string, unknown>): Promise<string> {
  const fromInlineViews = gistSnippetFromViews(child.memory_views);
  if (fromInlineViews) return fromInlineViews;

  const nodeUuid = typeof child.node_uuid === 'string' ? child.node_uuid : '';
  const uri = typeof child.uri === 'string' ? child.uri : '';
  if (!nodeUuid && !uri) return '';

  const views = await listMemoryViewsByNode({ nodeUuid, uri, limit: 2 });
  return gistSnippetFromViews(views);
}

async function toTreeLeaf(child: Record<string, unknown>): Promise<DreamTreeNode> {
  const gistSnippet = await getChildGistSnippet(child);
  return {
    uri: String(child.uri || ''),
    node_uuid: typeof child.node_uuid === 'string' ? child.node_uuid : null,
    priority: Number.isFinite(Number(child.priority)) ? Number(child.priority) : null,
    disclosure: typeof child.disclosure === 'string' && child.disclosure.trim() ? child.disclosure : null,
    content_snippet: gistSnippet || snippet(child.content_snippet),
    child_count: Number.isFinite(Number(child.approx_children_count)) ? Number(child.approx_children_count) : 0,
    children: [],
  };
}

export async function inspectTree(
  uri: string,
  {
    depth = 2,
    maxNodes = 60,
  }: {
    depth?: number;
    maxNodes?: number;
  } = {},
  _eventContext: DreamReadEventContext = { source: 'dream:auto' },
): Promise<DreamTreeInspection> {
  const safeDepth = clampInteger(depth, 1, 4, 2);
  const safeMaxNodes = clampInteger(maxNodes, 1, 120, 60);
  const { domain, path } = parseUri(uri);
  let visitedNodes = 0;
  let truncated = false;
  const seenUris = new Set<string>();

  async function loadNode(currentUri: string, level: number): Promise<DreamTreeNode> {
    const parsed = parseUri(currentUri);
    const payload = await getNodePayload({ domain: parsed.domain, path: parsed.path });
    visitedNodes += 1;

    const nodeUri = String(payload.node?.uri || currentUri);
    seenUris.add(nodeUri);
    const children = Array.isArray(payload.children) ? payload.children : [];
    const leafChildren = await Promise.all(children.map((child) => toTreeLeaf(child as unknown as Record<string, unknown>)));
    const treeNode: DreamTreeNode = {
      uri: nodeUri,
      node_uuid: typeof payload.node?.node_uuid === 'string' ? payload.node.node_uuid : null,
      priority: Number.isFinite(Number(payload.node?.priority)) ? Number(payload.node.priority) : null,
      disclosure: typeof payload.node?.disclosure === 'string' && payload.node.disclosure.trim() ? payload.node.disclosure : null,
      content_snippet: gistSnippetFromViews(payload.node?.memory_views) || snippet(payload.node?.content),
      child_count: children.length,
      children: leafChildren,
    };

    if (level >= safeDepth || children.length === 0) return treeNode;

    const nestedChildren: DreamTreeNode[] = [];
    for (const child of children) {
      const childUri = String(child.uri || '').trim();
      if (!childUri || seenUris.has(childUri)) {
        nestedChildren.push(await toTreeLeaf(child as unknown as Record<string, unknown>));
        continue;
      }
      if (visitedNodes >= safeMaxNodes) {
        truncated = true;
        nestedChildren.push(await toTreeLeaf(child as unknown as Record<string, unknown>));
        continue;
      }
      nestedChildren.push(await loadNode(childUri, level + 1));
    }
    treeNode.children = nestedChildren;
    return treeNode;
  }

  const tree = await loadNode(`${domain}://${path}`, 1);
  return {
    uri: `${domain}://${path}`,
    depth: safeDepth,
    max_nodes: safeMaxNodes,
    visited_nodes: visitedNodes,
    truncated,
    tree,
  };
}

export async function inspectNeighbors(
  uri: string,
  _eventContext: DreamReadEventContext = { source: 'dream:auto' },
): Promise<Record<string, unknown>> {
  const { domain, path: currentPath } = parseUri(uri);
  const current = await getNodePayload({ domain, path: currentPath });
  const aliases = Array.isArray(current.node?.aliases) ? current.node.aliases : [];
  const breadcrumbs = Array.isArray(current.breadcrumbs) ? current.breadcrumbs : [];
  const children = Array.isArray(current.children) ? current.children : [];

  const segments = currentPath.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { uri: `${domain}://${currentPath}`, parent: null, siblings: [], children, aliases, breadcrumbs };
  }

  const parentPath = segments.slice(0, -1).join('/');
  const parent = await getNodePayload({ domain, path: parentPath });
  const siblings = (Array.isArray(parent.children) ? parent.children : []).filter((child) => child.uri !== uri);

  return {
    uri: `${domain}://${currentPath}`,
    parent: parent.node,
    siblings,
    children,
    aliases,
    breadcrumbs,
  };
}

function compactNode(node: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!node) return null;
  return {
    uri: node.uri,
    node_uuid: node.node_uuid,
    priority: Number.isFinite(Number(node.priority)) ? Number(node.priority) : null,
    disclosure: typeof node.disclosure === 'string' && node.disclosure.trim() ? node.disclosure : null,
    child_count: Number.isFinite(Number(node.approx_children_count)) ? Number(node.approx_children_count) : undefined,
    content_snippet: gistSnippetFromViews(node.memory_views) || snippet(node.content_snippet || node.content),
  };
}

function compactView(view: Record<string, unknown>): Record<string, unknown> {
  const text = String(view.text_content || '');
  return {
    view_type: view.view_type ?? null,
    source: view.source ?? null,
    status: view.status ?? null,
    weight: Number.isFinite(Number(view.weight)) ? Number(view.weight) : null,
    text_content: preview(text, 600),
    text_chars: text.length,
    updated_at: view.updated_at ?? null,
    metadata: view.metadata && typeof view.metadata === 'object' ? view.metadata : {},
  };
}

export async function inspectMemoryNodeForDream(
  uri: string,
  {
    siblingsLimit = 8,
    childrenLimit = 12,
    viewsLimit = 6,
    historyLimit = 8,
  }: {
    siblingsLimit?: number;
    childrenLimit?: number;
    viewsLimit?: number;
    historyLimit?: number;
  } = {},
  _eventContext: DreamReadEventContext = { source: 'dream:auto' },
): Promise<Record<string, unknown>> {
  const safeSiblingsLimit = clampInteger(siblingsLimit, 0, 20, 8);
  const safeChildrenLimit = clampInteger(childrenLimit, 0, 30, 12);
  const safeViewsLimit = clampInteger(viewsLimit, 1, 8, 6);
  const safeHistoryLimit = clampInteger(historyLimit, 1, 10, 8);
  const { domain, path } = parseUri(uri);
  const current = await getNodePayload({ domain, path });
  const node = current.node as unknown as Record<string, unknown>;
  const segments = path.split('/').filter(Boolean);
  const parentPath = segments.slice(0, -1).join('/');
  const [parentPayload, views, writeHistory] = await Promise.all([
    segments.length > 0 ? getNodePayload({ domain, path: parentPath }) : Promise.resolve(null),
    listMemoryViewsByNode({ uri: String(node.uri || `${domain}://${path}`), nodeUuid: String(node.node_uuid || ''), limit: safeViewsLimit }),
    getNodeWriteHistory({ nodeUri: String(node.uri || `${domain}://${path}`), limit: safeHistoryLimit }),
  ]);
  const siblings = parentPayload
    ? (Array.isArray(parentPayload.children) ? parentPayload.children : [])
        .flatMap((child) => (
          String((child as unknown as Record<string, unknown>).uri || '') !== String(node.uri || '')
            ? [compactNode(child as unknown as Record<string, unknown>)].filter(Boolean)
            : []
        ))
        .slice(0, safeSiblingsLimit)
    : [];
  const children = (Array.isArray(current.children) ? current.children : [])
    .slice(0, safeChildrenLimit)
    .flatMap((child) => {
      const compacted = compactNode(child as unknown as Record<string, unknown>);
      return compacted ? [compacted] : [];
    });
  const content = String(node.content || '');
  const payload: Record<string, unknown> = {
    uri: node.uri || `${domain}://${path}`,
    node_uuid: node.node_uuid ?? null,
    priority: Number.isFinite(Number(node.priority)) ? Number(node.priority) : null,
    disclosure: typeof node.disclosure === 'string' && node.disclosure.trim() ? node.disclosure : null,
    glossary: Array.isArray(node.glossary_keywords) ? node.glossary_keywords : [],
    aliases: Array.isArray(node.aliases) ? node.aliases : [],
    content_chars: content.length,
    content_preview: preview(content, 1200),
    child_count: Array.isArray(current.children) ? current.children.length : 0,
    parent: parentPayload ? compactNode(parentPayload.node as unknown as Record<string, unknown>) : null,
    siblings,
    children,
    breadcrumbs: Array.isArray(current.breadcrumbs) ? current.breadcrumbs : [],
    views: (Array.isArray(views) ? views : []).map((view) => compactView(view as unknown as Record<string, unknown>)),
    write_history: writeHistory,
    limits: {
      siblings: safeSiblingsLimit,
      children: safeChildrenLimit,
      views: safeViewsLimit,
      history: safeHistoryLimit,
    },
  };
  payload.json_size_chars = JSON.stringify(payload).length;
  return payload;
}

export async function refreshOrInspectViews(
  uri: string,
  { limit = 6 }: { limit?: number } = {},
): Promise<Record<string, unknown>> {
  const safeLimit = clampInteger(limit, 1, 8, 6);
  const views = await listMemoryViewsByNode({ uri, limit: safeLimit });
  const payload: Record<string, unknown> = {
    uri,
    mode: 'inspect_only',
    refresh_supported: false,
    views: (Array.isArray(views) ? views : []).map((view) => compactView(view as unknown as Record<string, unknown>)),
  };
  payload.json_size_chars = JSON.stringify(payload).length;
  return payload;
}

export function validateMemoryChange(args: Record<string, unknown>): Record<string, unknown> {
  const action = String(args.action || '').trim();
  const uri = String(args.uri || '').trim();
  const content = typeof args.content === 'string' ? args.content : '';
  const disclosure = typeof args.disclosure === 'string' ? args.disclosure.trim() : '';
  const priority = args.priority;
  const protectedOp = getProtectedBootOperation(
    action === 'move' || action === 'move_node' ? 'move_node' : action === 'delete' || action === 'delete_node' ? 'delete_node' : action === 'create' || action === 'create_node' ? 'create_node' : 'update_node',
    {
      uri,
      old_uri: uri,
      new_uri: args.new_uri,
    },
  );
  const multiScenePattern = /\s或\s|\sOR\s|\/|、|,|，/i;
  const warnings: string[] = [];
  const errors: string[] = [];
  if ((action === 'create' || action === 'create_node' || content) && !disclosure) warnings.push('disclosure is missing');
  if (disclosure && multiScenePattern.test(disclosure)) warnings.push('disclosure appears to describe multiple scenes');
  if ((action === 'create' || action === 'create_node') && (priority === undefined || priority === null || priority === '')) warnings.push('priority is missing for create');
  const parsed = uri ? parseUri(uri) : { domain: '', path: '' };
  const parsedNew = typeof args.new_uri === 'string' ? parseUri(args.new_uri) : { domain: '', path: '' };
  if ((action === 'create' || action === 'create_node') && parsed.path.split('/').filter(Boolean).length <= 1) warnings.push('create target has little parent context and may create a horizontal island');
  const targetPath = action === 'move' || action === 'move_node' ? parsedNew.path : parsed.path;
  if (targetPath && hasDateTimePathSuffix(targetPath) && !isAllowedDateArchivedPath(targetPath)) {
    errors.push('path 是概念身份，日期是事件属性。把发生时间写进正文时间线或明确的 diary/log/release/archive/incident 概念；普通项目和工作记忆用稳定概念命名。');
  }
  if ((action === 'create' || action === 'create_node') && lastPathSegment(parsed.path) === '1') {
    errors.push('Dream create_node must use an explicit stable semantic path; numeric root paths like core://1 are not allowed.');
  }
  if (protectedOp) warnings.push(protectedOp.reason || `protected path: ${protectedOp.blocked_uri}`);

  return {
    action,
    uri,
    blocked: Boolean(protectedOp) || errors.length > 0,
    errors,
    warnings,
    checks: {
      has_disclosure: Boolean(disclosure),
      disclosure_single_scene: !disclosure || !multiScenePattern.test(disclosure),
      has_priority: priority !== undefined && priority !== null && priority !== '',
      protected_path: Boolean(protectedOp),
      create_has_parent_path: parsed.path.split('/').filter(Boolean).length > 1,
      stable_target_path: !(targetPath && hasDateTimePathSuffix(targetPath) && !isAllowedDateArchivedPath(targetPath)),
      content_chars: content.length,
    },
  };
}
