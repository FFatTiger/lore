import { getNodePayload } from '../memory/browse';
import { markSessionRead } from '../memory/session';
import { parseUri } from '../core/utils';

interface DreamReadEventContext {
  source: string;
  session_id?: string | null;
}

interface DreamReadableNode {
  uri?: unknown;
  node_uuid?: unknown;
}

async function trackDreamRead(
  node: DreamReadableNode | null | undefined,
  eventContext: DreamReadEventContext,
  sourceSuffix: string,
): Promise<void> {
  const sessionId = eventContext.session_id ?? null;
  const uri = typeof node?.uri === 'string' ? node.uri : '';
  const nodeUuid = typeof node?.node_uuid === 'string' ? node.node_uuid : '';
  if (!sessionId || !uri || !nodeUuid) return;

  try {
    await markSessionRead({
      session_id: sessionId,
      uri,
      node_uuid: nodeUuid,
      source: `${eventContext.source}:${sourceSuffix}`,
    });
  } catch {
    // best effort only
  }
}

export async function inspectNeighbors(
  uri: string,
  eventContext: DreamReadEventContext = { source: 'dream:auto' },
): Promise<Record<string, unknown>> {
  const { domain, path: currentPath } = parseUri(uri);
  const current = await getNodePayload({ domain, path: currentPath });
  await trackDreamRead(current.node, eventContext, 'inspect_neighbors');
  const aliases = Array.isArray(current.node?.aliases) ? current.node.aliases : [];
  const breadcrumbs = Array.isArray(current.breadcrumbs) ? current.breadcrumbs : [];
  const children = Array.isArray(current.children) ? current.children : [];

  const segments = currentPath.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { uri: `${domain}://${currentPath}`, parent: null, siblings: [], children, aliases, breadcrumbs };
  }

  const parentPath = segments.slice(0, -1).join('/');
  const parent = await getNodePayload({ domain, path: parentPath });
  await trackDreamRead(parent.node, eventContext, 'inspect_neighbors');
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
