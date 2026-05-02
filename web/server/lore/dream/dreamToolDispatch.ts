import { getNodePayload, listDomains } from '../memory/browse';
import { createNode, deleteNodeByPath, moveNode, updateNodeByPath } from '../memory/write';
import { getPathEffectiveness } from '../recall/feedbackAnalytics';
import { getRecallStats } from '../recall/recallAnalytics';
import { searchMemories } from '../search/search';
import { addGlossaryKeyword, manageTriggers, removeGlossaryKeyword } from '../search/glossary';
import { listMemoryViewsByNode } from '../view/memoryViewQueries';
import { getNodeWriteHistory } from '../memory/writeEvents';
import { markSessionRead } from '../memory/session';
import { parseUri } from '../core/utils';
import { inspectNeighbors } from './dreamToolReadHelpers';
import {
  applyDreamWritePolicy,
  type DreamToolEventContext,
} from './dreamToolPolicy';

interface DreamMutationContext extends DreamToolEventContext {}

function attachDreamPolicyWarnings(result: unknown, warnings: string[]): unknown {
  if (!warnings.length || !result || typeof result !== 'object') return result;
  const record = result as Record<string, unknown>;
  return {
    ...record,
    warnings,
    policy_warnings: warnings,
  };
}

async function trackDreamNodeRead(
  uri: string,
  nodeUuid: string | null | undefined,
  eventContext: DreamMutationContext,
  sourceSuffix: string,
): Promise<void> {
  const sessionId = eventContext.session_id ?? null;
  const normalizedUri = String(uri || '').trim();
  const normalizedNodeUuid = String(nodeUuid || '').trim();
  if (!sessionId || !normalizedUri || !normalizedNodeUuid) return;
  try {
    await markSessionRead({
      session_id: sessionId,
      uri: normalizedUri,
      node_uuid: normalizedNodeUuid,
      source: `${eventContext.source}:${sourceSuffix}`,
    });
  } catch {
    // best effort only
  }
}

export async function dispatchDreamTool(
  name: string,
  args: Record<string, unknown>,
  eventContext: DreamMutationContext,
): Promise<unknown> {
  const policyResult = await applyDreamWritePolicy(name, args, eventContext);
  if (policyResult.blockedResult) return policyResult.blockedResult;

  switch (name) {
    case 'get_node': {
      const { domain, path } = parseUri(args.uri as string);
      const result = await getNodePayload({ domain, path });
      await trackDreamNodeRead(result.node?.uri as string, result.node?.node_uuid as string | null | undefined, eventContext, 'get_node');
      return result;
    }
    case 'search':
      return await searchMemories({ query: args.query as string, limit: (args.limit as number) || 10 });
    case 'list_domains':
      return await listDomains();
    case 'get_query_recall_detail':
      return await getRecallStats({
        queryId: (args.query_id as string) || '',
        queryText: (args.query_text as string) || '',
        days: (args.days as number) || 7,
        limit: (args.limit as number) || 10,
      });
    case 'get_node_write_history':
      return await getNodeWriteHistory({ nodeUri: args.uri as string, limit: (args.limit as number) || 20 });
    case 'get_path_effectiveness_detail':
      return await getPathEffectiveness({ days: (args.days as number) || 7 });
    case 'inspect_neighbors':
      return await inspectNeighbors(args.uri as string, eventContext);
    case 'inspect_views':
      return await listMemoryViewsByNode({ uri: args.uri as string, limit: (args.limit as number) || 12 });
    case 'create_node': {
      const { domain, path } = args.uri ? parseUri(args.uri as string) : { domain: 'core', path: '' };
      const segments = path.split('/').filter(Boolean);
      const title = segments.pop() || '';
      const parentPath = segments.join('/');
      return attachDreamPolicyWarnings(
        await createNode(
          {
            domain,
            parentPath,
            content: args.content as string,
            priority: (args.priority as number) || 2,
            title,
            disclosure: (args.disclosure as string) || null,
            glossary: Array.isArray(args.glossary) ? args.glossary as string[] : [],
          },
          eventContext,
        ),
        policyResult.warnings,
      );
    }
    case 'update_node': {
      const { domain, path } = parseUri(args.uri as string);
      return attachDreamPolicyWarnings(
        await updateNodeByPath(
          {
            domain,
            path,
            content: args.content as string | undefined,
            priority: args.priority as number | undefined,
            disclosure: args.disclosure as string | undefined,
          },
          eventContext,
        ),
        policyResult.warnings,
      );
    }
    case 'delete_node': {
      const { domain, path } = parseUri(args.uri as string);
      return attachDreamPolicyWarnings(
        await deleteNodeByPath({ domain, path }, eventContext),
        policyResult.warnings,
      );
    }
    case 'move_node':
      return await moveNode(
        {
          old_uri: args.old_uri as string,
          new_uri: args.new_uri as string,
        },
        eventContext,
      );
    case 'add_glossary':
      return await addGlossaryKeyword(
        { keyword: args.keyword as string, node_uuid: args.node_uuid as string },
        eventContext,
      );
    case 'remove_glossary':
      return await removeGlossaryKeyword(
        { keyword: args.keyword as string, node_uuid: args.node_uuid as string },
        eventContext,
      );
    case 'manage_triggers':
      return await manageTriggers(
        { uri: args.uri as string, add: (args.add as string[]) || [], remove: (args.remove as string[]) || [] },
        eventContext,
      );
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { status: 404, code: 'unknown_tool' });
  }
}
