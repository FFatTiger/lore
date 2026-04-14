'use client';

import React, { useMemo, useState, ReactNode } from 'react';
import clsx from 'clsx';
import {
  Badge,
  StatCard,
  EmptyState,
  Table,
  BreakdownGrid,
  CueList,
  fmt,
  safeArray,
  asNumber,
  formatRecallBlock,
} from './ui';
import { useT } from '../lib/i18n';

interface StageSegmentProps {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}

function StageSegment({ active, onClick, label, count }: StageSegmentProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'press shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition-all duration-200 ease-spring',
        active
          ? 'bg-sys-blue/15 text-sys-blue font-semibold'
          : 'font-medium text-txt-secondary hover:text-txt-primary hover:bg-fill-quaternary',
      )}
    >
      <span>{label}</span>
      <span className={clsx('ml-1.5 inline-block tabular-nums', active ? 'opacity-70' : 'opacity-60')}>
        {count}
      </span>
    </button>
  );
}

type RecallRow = Record<string, unknown>;

function denseWeighted(row: RecallRow): number {
  return asNumber(row?.semantic_score, 0) * asNumber(row?.weight, 1);
}
function lexicalWeighted(row: RecallRow): number {
  return asNumber(row?.lexical_score, 0) * asNumber(row?.weight, 1);
}

interface TableColumn {
  key: string;
  label: ReactNode;
  className?: string;
  render?: (value: unknown, row: RecallRow) => ReactNode;
}

interface CandidateDetailProps {
  candidate: RecallRow | null;
  data: RecallData | null;
  exactColumns: TableColumn[];
  glossarySemanticColumns: TableColumn[];
  denseColumns: TableColumn[];
  lexicalColumns: TableColumn[];
  finalItems: RecallRow[];
  t: (key: string) => string;
}

function CandidateDetail({ candidate, data, exactColumns, glossarySemanticColumns, denseColumns, lexicalColumns, finalItems, t }: CandidateDetailProps): React.JSX.Element | null {
  if (!candidate) return null;
  const uri = candidate.uri;
  const exactHits = safeArray<RecallRow>(data?.exact_hits).filter((r) => r?.uri === uri);
  const glossaryHits = safeArray<RecallRow>(data?.glossary_semantic_hits).filter((r) => r?.uri === uri);
  const denseHits = safeArray<RecallRow>(data?.dense_hits).filter((r) => r?.uri === uri);
  const lexicalHits = safeArray<RecallRow>(data?.lexical_hits).filter((r) => r?.uri === uri);
  const displayed = finalItems.some((r) => r?.uri === uri);

  return (
    <div className="animate-in mt-4 rounded-2xl bg-sys-blue/[0.06] border border-sys-blue/20 p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <code className="font-mono text-[12.5px] text-txt-primary break-all">{String(uri ?? '')}</code>
        <span className="text-[28px] font-bold leading-none tabular-nums tracking-tight text-sys-blue">{fmt(candidate.score, 3)}</span>
        {candidate.priority != null && <Badge tone="default">{t('Priority')} {String(candidate.priority)}</Badge>}
        {displayed ? <Badge tone="green">{t('Shown')}</Badge> : <Badge tone="red">{t('Withheld')}</Badge>}
      </div>
      <BreakdownGrid breakdown={candidate.score_breakdown as Record<string, unknown> | null} />

      <div className="grid gap-4 xl:grid-cols-2">
        {exactHits.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Exact sources')}</div>
            <Table columns={exactColumns} rows={exactHits} />
          </div>
        )}
        {glossaryHits.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Glossary sources')}</div>
            <Table columns={glossarySemanticColumns} rows={glossaryHits} />
          </div>
        )}
        {denseHits.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Semantic sources')}</div>
            <Table columns={denseColumns} rows={denseHits} />
          </div>
        )}
        {lexicalHits.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Lexical sources')}</div>
            <Table columns={lexicalColumns} rows={lexicalHits} />
          </div>
        )}
        {exactHits.length + glossaryHits.length + denseHits.length + lexicalHits.length === 0 && (
          <div className="col-span-full text-[13px] text-txt-tertiary">{t('No matching source records.')}</div>
        )}
      </div>
    </div>
  );
}

interface RetrievalMeta {
  exact_candidates?: number;
  glossary_semantic_candidates?: number;
  dense_candidates?: number;
  lexical_candidates?: number;
  query_tokens?: number;
}

interface SuppressionData {
  boot?: number;
  read?: number;
  score?: number;
}

interface RecallData {
  query?: string;
  exact_hits?: RecallRow[];
  glossary_semantic_hits?: RecallRow[];
  dense_hits?: RecallRow[];
  lexical_hits?: RecallRow[];
  merged_candidates?: RecallRow[];
  items?: RecallRow[];
  suppressed?: SuppressionData;
  retrieval_meta?: RetrievalMeta;
}

export function clientTypeTone(clientType: unknown): 'blue' | 'purple' | 'teal' | 'orange' | 'soft' {
  switch (String(clientType || '').trim()) {
    case 'claudecode':
      return 'blue';
    case 'openclaw':
      return 'purple';
    case 'hermes':
      return 'teal';
    case 'mcp':
      return 'orange';
    default:
      return 'soft';
  }
}

export function clientTypeLabel(clientType: unknown): string {
  switch (String(clientType || '').trim()) {
    case 'claudecode':
      return 'Claude Code';
    case 'openclaw':
      return 'OpenClaw';
    case 'hermes':
      return 'Hermes';
    case 'mcp':
      return 'MCP';
    default:
      return 'Legacy';
  }
}

interface RuntimeWeights {
  w_exact?: number;
  w_glossary_semantic?: number;
  w_dense?: number;
  w_lexical?: number;
}

interface RuntimeData {
  normalized_linear?: RuntimeWeights;
  memory_views?: {
    weights?: {
      gist?: number;
      question?: number;
    };
  };
}

interface RecallStagesProps {
  data: RecallData | null;
  runtime?: RuntimeData | null;
  minDisplayScore?: number | null;
  maxDisplayItems?: number | null;
  scorePrecision?: number;
  sessionId?: string | null;
  readNodeDisplayMode?: string | null;
  initialStage?: string;
  showClientSource?: boolean;
  hideMergedBreakdownColumn?: boolean;
}

export default function RecallStages({
  data,
  runtime = null,
  minDisplayScore = null,
  maxDisplayItems = null,
  scorePrecision = 2,
  sessionId = null,
  readNodeDisplayMode = null,
  initialStage = 'merge',
  showClientSource = false,
  hideMergedBreakdownColumn = false,
}: RecallStagesProps): React.JSX.Element {
  const { t } = useT();
  const [activeStage, setActiveStage] = useState(initialStage);
  const [selectedMergedUri, setSelectedMergedUri] = useState('');

  const mergedCandidates = safeArray<RecallRow>(data?.merged_candidates);
  const finalItems = safeArray<RecallRow>(data?.items);
  const topMerged = mergedCandidates[0] || null;
  const topFinal = finalItems[0] || null;
  const suppression: SuppressionData = data?.suppressed || { boot: 0, read: 0, score: 0 };
  const retrievalMeta: RetrievalMeta = data?.retrieval_meta || {};
  const selectedCandidate = mergedCandidates.find((r) => r?.uri === selectedMergedUri) || null;

  const recallPreview = useMemo(
    () => formatRecallBlock(finalItems as Parameters<typeof formatRecallBlock>[0], scorePrecision),
    [finalItems, scorePrecision],
  );

  const stageItems = useMemo(() => ([
    { key: 'query', label: t('Query'), count: (retrievalMeta.exact_candidates || 0) + (retrievalMeta.glossary_semantic_candidates || 0) + (retrievalMeta.dense_candidates || 0) + (retrievalMeta.lexical_candidates || 0) },
    { key: 'exact', label: t('Exact'), count: safeArray(data?.exact_hits).length },
    { key: 'glossarySemantic', label: t('Glossary'), count: safeArray(data?.glossary_semantic_hits).length },
    { key: 'dense', label: t('Semantic'), count: safeArray(data?.dense_hits).length },
    { key: 'lexical', label: t('Lexical'), count: safeArray(data?.lexical_hits).length },
    { key: 'merge', label: t('Merged'), count: mergedCandidates.length },
    { key: 'display', label: t('Shown'), count: finalItems.length },
  ]), [data, mergedCandidates.length, finalItems.length, retrievalMeta, t]);

  const uriCell = (v: unknown, meta: ReactNode): ReactNode => (
    <div className="min-w-0">
      <div className="font-mono text-[12px] text-txt-primary break-all">{String(v ?? '')}</div>
      {meta && <div className="mt-0.5 text-[11.5px] text-txt-tertiary">{meta}</div>}
    </div>
  );

  const exactColumns = useMemo((): TableColumn[] => [
    { key: 'uri', label: t('Entry'), render: (v, row) => uriCell(v,
      row.path_exact_hit ? '路径完全命中' : row.glossary_exact_hit ? '术语完全命中' : row.query_contains_glossary_hit ? 'query 包含术语' : row.glossary_text_hit ? '术语文本命中' : row.glossary_fts_hit ? '术语 FTS' : '精确') },
    { key: 'exact_score', label: t('Raw'), render: (v) => <span className="font-mono tabular-nums text-txt-primary">{fmt(v, 3)}</span> },
    { key: 'cue_terms', label: t('Cues'), render: (_, row) => <CueList item={row as { cues?: unknown[]; cue_terms?: unknown[] }} /> },
  ], [t]);

  const glossarySemanticColumns = useMemo((): TableColumn[] => [
    { key: 'uri', label: t('Entry'), render: (v, row) => uriCell(v, `keyword: ${row.keyword || '—'}`) },
    { key: 'glossary_semantic_score', label: t('Score'), render: (v) => <span className="font-mono tabular-nums text-txt-primary">{fmt(v, 3)}</span> },
  ], [t]);

  const denseColumns = useMemo((): TableColumn[] => [
    { key: 'uri', label: t('Entry'), render: (v, row) => uriCell(v, `${row.view_type} · ${row.llm_refined ? row.llm_model || 'LLM refined' : 'rule-based'}`) },
    { key: 'semantic_score', label: t('Raw'), render: (v) => <span className="font-mono tabular-nums text-txt-primary">{fmt(v, 3)}</span> },
    { key: 'weight', label: t('Weight'), render: (v) => <span className="font-mono tabular-nums text-txt-tertiary">{fmt(v, 2)}</span> },
    { key: 'weighted', label: t('Weighted'), render: (_, row) => <span className="font-mono tabular-nums text-sys-blue">{fmt(denseWeighted(row), 3)}</span> },
  ], [t]);

  const lexicalColumns = useMemo((): TableColumn[] => [
    { key: 'uri', label: t('Entry'), render: (v, row) => uriCell(v, `${row.view_type} · ${row.fts_hit ? 'fts' : row.text_hit ? 'text' : row.uri_hit ? 'uri' : 'lex'}`) },
    { key: 'lexical_score', label: t('Raw'), render: (v) => <span className="font-mono tabular-nums text-txt-primary">{fmt(v, 3)}</span> },
    { key: 'weight', label: t('Weight'), render: (v) => <span className="font-mono tabular-nums text-txt-tertiary">{fmt(v, 2)}</span> },
    { key: 'weighted', label: t('Weighted'), render: (_, row) => <span className="font-mono tabular-nums text-sys-blue">{fmt(lexicalWeighted(row), 3)}</span> },
  ], [t]);

  const mergedColumns = useMemo((): TableColumn[] => {
    const columns: TableColumn[] = [
      { key: 'uri', label: t('Candidate'), render: (v, row) => (
        <div className="min-w-0">
          <div className="font-mono text-[12px] text-txt-primary break-all">{String(v ?? '')}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {safeArray<string>(row.matched_on).map((p) => <Badge key={`${String(v)}-${p}`}>{p}</Badge>)}
          </div>
        </div>
      ) },
      { key: 'score', label: t('Final'), render: (v) => <span className="text-[18px] font-semibold tabular-nums text-sys-blue">{fmt(v, 3)}</span> },
    ];

    if (showClientSource) {
      columns.push({
        key: 'client_type',
        label: t('Source'),
        render: (v) => <Badge tone={clientTypeTone(v)}>{clientTypeLabel(v)}</Badge>,
      });
    }

    if (!hideMergedBreakdownColumn) {
      columns.push({ key: 'breakdown', label: t('Breakdown'), render: (_, row) => <BreakdownGrid breakdown={row.score_breakdown as Record<string, unknown>} /> });
    }

    columns.push({ key: 'cues', label: t('Cues'), render: (_, row) => <CueList item={row as { cues?: unknown[]; cue_terms?: unknown[] }} /> });
    return columns;
  }, [hideMergedBreakdownColumn, showClientSource, t]);

  const finalColumns = useMemo((): TableColumn[] => [
    { key: 'uri', label: t('Quoted'), render: (v, row) => (
      <div className="min-w-0">
        <div className="font-mono text-[12px] text-txt-primary break-all">{String(v ?? '')}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {safeArray<string>(row.matched_on).map((p) => <Badge key={`${String(v)}-${p}`} tone="blue">{p}</Badge>)}
        </div>
      </div>
    ) },
    { key: 'score', label: t('Score'), render: (v) => <span className="text-[18px] font-semibold tabular-nums text-sys-blue">{fmt(v, 3)}</span> },
    { key: 'cues', label: t('Cues'), render: (_, row) => <CueList item={row as { cues?: unknown[]; cue_terms?: unknown[] }} /> },
  ], [t]);

  function renderStage(): ReactNode {
    if (!data) return <EmptyState text={t('No data yet.')} />;

    switch (activeStage) {
      case 'query':
        return (
          <div className="space-y-6 animate-in">
            <div className="rounded-2xl bg-bg-raised border border-separator-thin p-5">
              <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary mb-2">{t('Query text')}</div>
              <p className="text-[20px] font-semibold leading-snug text-txt-primary">{data?.query || '—'}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {sessionId && <Badge tone="blue">Session · {sessionId}</Badge>}
                {minDisplayScore != null && <Badge tone="orange">Threshold · {fmt(minDisplayScore, 2)}</Badge>}
                {maxDisplayItems != null && <Badge tone="green">Max · {maxDisplayItems}</Badge>}
                {readNodeDisplayMode && <Badge>Read · {readNodeDisplayMode}</Badge>}
              </div>
            </div>
            <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
              <StatCard label={t('Exact')} value={retrievalMeta.exact_candidates ?? 0} tone="orange" />
              <StatCard label={t('Glossary')} value={retrievalMeta.glossary_semantic_candidates ?? 0} tone="teal" />
              <StatCard label={t('Semantic')} value={retrievalMeta.dense_candidates ?? 0} tone="purple" />
              <StatCard label={t('Lexical')} value={retrievalMeta.lexical_candidates ?? 0} tone="green" />
            </div>
          </div>
        );

      case 'exact':
        return (
          <div className="space-y-3 animate-in">
            <div className="flex items-center gap-3 text-[12.5px] text-txt-secondary">
              <span>{safeArray(data.exact_hits).length} {t('hits')}</span>
              {runtime && <span className="text-txt-tertiary">· {t('Weight')} {fmt(runtime?.normalized_linear?.w_exact, 2)}</span>}
            </div>
            <Table columns={exactColumns} rows={safeArray<RecallRow>(data.exact_hits)} empty={t('No exact hits.')} />
          </div>
        );

      case 'glossarySemantic':
        return (
          <div className="space-y-3 animate-in">
            <div className="flex items-center gap-3 text-[12.5px] text-txt-secondary">
              <span>{safeArray(data.glossary_semantic_hits).length} {t('hits')}</span>
              {runtime && <span className="text-txt-tertiary">· {t('Weight')} {fmt(runtime?.normalized_linear?.w_glossary_semantic, 2)}</span>}
            </div>
            <Table columns={glossarySemanticColumns} rows={safeArray<RecallRow>(data.glossary_semantic_hits)} empty={t('No glossary hits.')} />
          </div>
        );

      case 'dense':
        return (
          <div className="space-y-3 animate-in">
            <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-txt-secondary">
              <span>{safeArray(data.dense_hits).length} {t('hits')}</span>
              {runtime && <span className="text-txt-tertiary">· {t('Weight')} {fmt(runtime?.normalized_linear?.w_dense, 2)}</span>}
              {runtime && <span className="text-txt-tertiary">· gist {fmt(runtime?.memory_views?.weights?.gist, 2)}</span>}
              {runtime && <span className="text-txt-tertiary">· question {fmt(runtime?.memory_views?.weights?.question, 2)}</span>}
            </div>
            <Table columns={denseColumns} rows={safeArray<RecallRow>(data.dense_hits)} empty={t('No semantic hits.')} />
          </div>
        );

      case 'lexical':
        return (
          <div className="space-y-3 animate-in">
            <div className="flex items-center gap-3 text-[12.5px] text-txt-secondary">
              <span>{safeArray(data.lexical_hits).length} {t('hits')}</span>
              {runtime && <span className="text-txt-tertiary">· {t('Weight')} {fmt(runtime?.normalized_linear?.w_lexical, 2)}</span>}
            </div>
            <Table columns={lexicalColumns} rows={safeArray<RecallRow>(data.lexical_hits)} empty={t('No lexical hits.')} />
          </div>
        );

      case 'merge':
        return (
          <div className="space-y-3 animate-in">
            <div className="flex items-center gap-3 text-[12.5px] text-txt-secondary">
              <span>{mergedCandidates.length} {t('candidates')}</span>
              {topMerged && <span className="text-txt-tertiary">· top {fmt(topMerged.score, 3)}</span>}
            </div>
            <Table
              columns={mergedColumns}
              rows={mergedCandidates}
              empty={t('No merged candidates.')}
              onRowClick={(row) => setSelectedMergedUri((prev) => prev === row.uri ? '' : String(row.uri ?? ''))}
              activeRowKey={selectedMergedUri}
            />
            {selectedMergedUri && (
              <CandidateDetail
                candidate={selectedCandidate}
                data={data}
                exactColumns={exactColumns}
                glossarySemanticColumns={glossarySemanticColumns}
                denseColumns={denseColumns}
                lexicalColumns={lexicalColumns}
                finalItems={finalItems}
                t={t}
              />
            )}
          </div>
        );

      case 'display':
        return (
          <div className="space-y-4 animate-in">
            <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-txt-secondary">
              <span>{finalItems.length} {t('Shown')}</span>
              {minDisplayScore != null && <span className="text-txt-tertiary">· ≥ {fmt(minDisplayScore, 2)}</span>}
              {topFinal && <span className="text-txt-tertiary">· top {fmt(topFinal.score, 3)}</span>}
              {suppression && (
                <span className="ml-auto text-txt-tertiary">
                  {t('Suppressed')} · boot {suppression.boot ?? 0} · read {suppression.read ?? 0} · score {suppression.score ?? 0}
                </span>
              )}
            </div>
            <Table columns={finalColumns} rows={finalItems} empty={t('Nothing to show.')} />
            {recallPreview && (
              <div className="rounded-2xl bg-bg-inset border border-separator-thin p-4">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-sys-blue">{t('Recall block · prompt injection')}</div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-txt-secondary">{recallPreview}</pre>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className="space-y-5">
      <div className="relative">
        <div className="overflow-x-auto no-scrollbar">
          <div className="inline-flex items-center gap-1 p-1 rounded-full bg-bg-raised border border-separator-thin">
            {stageItems.map((stage) => (
              <StageSegment
                key={stage.key}
                active={activeStage === stage.key}
                onClick={() => setActiveStage(stage.key)}
                label={stage.label}
                count={stage.count}
              />
            ))}
          </div>
        </div>
      </div>

      {renderStage()}
    </div>
  );
}
