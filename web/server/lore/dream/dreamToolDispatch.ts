import { getNodePayload, listDomains } from '../memory/browse';
import { createNode, deleteNodeByPath, moveNode, updateNodeByPath } from '../memory/write';
import { getHygieneAudit } from '../memory/hygieneAudit';
import { getStructuralAudit } from '../memory/structuralAudit';
import { getPathEffectiveness } from '../recall/feedbackAnalytics';
import {
  getDreamRecallReview,
  getDreamQueryCandidates,
  getDreamQueryEventSamples,
  getDreamQueryNodePaths,
  getDreamQueryPathBreakdown,
  getDreamQueryRecallDetail,
} from '../recall/recallAnalytics';
import { searchMemories } from '../search/search';
import { listMemoryViewsByNode } from '../view/memoryViewQueries';
import { getDreamMemoryEventSummary, getNodeWriteHistory } from '../memory/writeEvents';
import { parseUri } from '../core/utils';
import { inspectMemoryNodeForDream, inspectNeighbors, inspectTree, refreshOrInspectViews, validateMemoryChange } from './dreamToolReadHelpers';
import { replayRecall } from './dreamReplayRecall';
import { collectExcludedDreamQueryIds, dreamSessionMatches, filterDreamRecallReview, loadDreamSessionFilter } from './dreamSessionFilter';
import {
  applyDreamWritePolicy,
  type DreamToolEventContext,
} from './dreamToolPolicy';

interface DreamMutationContext extends DreamToolEventContext {}

const QUERY_SCOPED_DREAM_TOOLS = new Set([
  'get_query_recall_detail',
  'get_query_candidates',
  'get_query_path_breakdown',
  'get_query_node_paths',
  'get_query_event_samples',
]);

async function blockedExcludedQuery(queryId: unknown, days: unknown): Promise<Record<string, unknown> | null> {
  const id = String(queryId || '').trim();
  if (!id) return null;
  const filter = await loadDreamSessionFilter();
  const excluded = await collectExcludedDreamQueryIds(filter, Number(days) || 7);
  if (!excluded.has(id)) return null;
  return {
    blocked: true,
    code: 'dream_session_excluded',
    error: 'query belongs to an excluded session',
    recoverable: true,
  };
}

function attachDreamPolicyWarnings(result: unknown, warnings: string[]): unknown {
  if (!warnings.length || !result || typeof result !== 'object') return result;
  const record = result as Record<string, unknown>;
  return {
    ...record,
    warnings,
    policy_warnings: warnings,
  };
}

export async function dispatchDreamTool(
  name: string,
  args: Record<string, unknown>,
  eventContext: DreamMutationContext,
): Promise<unknown> {
  const policyResult = await applyDreamWritePolicy(name, args, eventContext);
  if (policyResult.blockedResult) return policyResult.blockedResult;

  if (QUERY_SCOPED_DREAM_TOOLS.has(name)) {
    const blocked = await blockedExcludedQuery(args.query_id, args.days);
    if (blocked) return blocked;
  }

  switch (name) {
    case 'get_node': {
      const { domain, path } = parseUri(args.uri as string);
      return await getNodePayload({ domain, path });
    }
    case 'search':
      return await searchMemories({ query: args.query as string, limit: (args.limit as number) || 10 });
    case 'list_domains':
      return await listDomains();
    case 'get_recall_metadata': {
      const review = await getDreamRecallReview({
        date: (args.date as string) || '',
        days: (args.days as number) || 0,
        limit: (args.limit as number) || 100,
        offset: (args.offset as number) || 0,
      }) as unknown as Record<string, unknown>;
      const filter = await loadDreamSessionFilter();
      const excluded = await collectExcludedDreamQueryIds(filter, (args.days as number) || 1);
      return filterDreamRecallReview(review, excluded);
    }
    case 'get_query_recall_detail': {
      const filter = await loadDreamSessionFilter();
      if (args.query_text && dreamSessionMatches(filter, args.query_text)) {
        return {
          blocked: true,
          code: 'dream_session_excluded',
          error: 'query belongs to an excluded session',
          recoverable: true,
        };
      }
      return await getDreamQueryRecallDetail({
        queryId: (args.query_id as string) || '',
        queryText: (args.query_text as string) || '',
        days: (args.days as number) || 7,
        limit: (args.limit as number) || 10,
      });
    }
    case 'get_query_candidates':
      return await getDreamQueryCandidates({
        queryId: (args.query_id as string) || '',
        limit: (args.limit as number) || 50,
        selectedOnly: args.selected_only === true,
        usedOnly: args.used_only === true,
      });
    case 'get_query_path_breakdown':
      return await getDreamQueryPathBreakdown({
        queryId: (args.query_id as string) || '',
      });
    case 'get_query_node_paths':
      return await getDreamQueryNodePaths({
        queryId: (args.query_id as string) || '',
        nodeUri: (args.node_uri as string) || '',
      });
    case 'get_query_event_samples':
      return await getDreamQueryEventSamples({
        queryId: (args.query_id as string) || '',
        nodeUri: (args.node_uri as string) || '',
        retrievalPath: (args.retrieval_path as string) || '',
        limit: (args.limit as number) || 10,
        includeMetadata: args.include_metadata === true,
      });
    case 'structural_audit':
      return await getStructuralAudit({
        category: (args.category as string) || '',
        limit: (args.limit as number) || 15,
        offset: (args.offset as number) || 0,
      });
    case 'hygiene_audit':
      return await getHygieneAudit({
        category: (args.category as string) || '',
        limit: (args.limit as number) || 15,
        offset: (args.offset as number) || 0,
      });
    case 'replay_recall':
      return await replayRecall({
        query_ids: args.query_ids,
        queries: args.queries,
      });
    case 'get_node_write_history':
      return await getNodeWriteHistory({ nodeUri: args.uri as string, limit: (args.limit as number) || 20 });
    case 'get_memory_event_summary':
      return await getDreamMemoryEventSummary({
        date: (args.date as string) || '',
        eventType: (args.event_type as string) || '',
        nodeUri: (args.node_uri as string) || '',
        limit: (args.limit as number) || 40,
      });
    case 'get_path_effectiveness_detail':
      return await getPathEffectiveness({ days: (args.days as number) || 7 });
    case 'inspect_neighbors':
      return await inspectNeighbors(args.uri as string, eventContext);
    case 'inspect_tree':
      return await inspectTree(
        args.uri as string,
        {
          depth: (args.depth as number) || 2,
          maxNodes: (args.max_nodes as number) || 60,
        },
        eventContext,
      );
    case 'inspect_views':
      return await listMemoryViewsByNode({ uri: args.uri as string, limit: (args.limit as number) || 12 });
    case 'refresh_or_inspect_views':
      return await refreshOrInspectViews(args.uri as string, { limit: (args.limit as number) || 6 });
    case 'inspect_memory_node_for_dream':
      return await inspectMemoryNodeForDream(
        args.uri as string,
        {
          siblingsLimit: (args.siblings_limit as number) || 8,
          childrenLimit: (args.children_limit as number) || 12,
          viewsLimit: (args.views_limit as number) || 6,
          historyLimit: (args.history_limit as number) || 8,
        },
        eventContext,
      );
    case 'validate_memory_change':
      return validateMemoryChange(args);
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
            glossaryAdd: Array.isArray(args.glossary_add) ? args.glossary_add as string[] : [],
            glossaryRemove: Array.isArray(args.glossary_remove) ? args.glossary_remove as string[] : [],
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
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { status: 404, code: 'unknown_tool' });
  }
}
