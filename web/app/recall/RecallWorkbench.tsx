'use client';

import React, { useState, useCallback, KeyboardEvent, ChangeEvent, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import {
  PageCanvas, PageTitle, Section, Button, EmptyState, AppCheckbox, AppInput, AppSelect, AppTextArea,
  fmt, asNumber,
} from '../../components/ui';
import RecallStages from '../../components/RecallStages';
import { useT } from '../../lib/i18n';
import { AxiosError } from 'axios';
import { buildUrlWithSearchParams, readBooleanParam, readNumberParam, readStringParam } from '../../lib/url-state';

interface DebugForm {
  query: string;
  sessionId: string;
  limit: number | string;
  minScore: number | string;
  maxDisplayItems: number | string;
  minDisplayScore: number | string;
  scorePrecision: number | string;
  readNodeDisplayMode: string;
  excludeBootFromResults: boolean;
  strategy: string;
}

const DEFAULT_DEBUG: DebugForm = {
  query: '',
  sessionId: 'recall-ui-debug',
  limit: 12,
  minScore: 0,
  maxDisplayItems: 3,
  minDisplayScore: 0.60,
  scorePrecision: 2,
  readNodeDisplayMode: 'soft',
  excludeBootFromResults: true,
  strategy: '',  // empty = use server default
};

interface StrategyOption {
  value: string;
  label: string;
}

const STRATEGY_OPTIONS: StrategyOption[] = [
  { value: '', label: 'Default (follow /settings)' },
  { value: 'raw_plus_lex_damp', label: 'raw_plus_lex_damp — raw score + lex damping · recommended · long-query safe' },
  { value: 'raw_score', label: 'raw_score — raw score sum · most faithful · quality=score' },
  { value: 'normalized_linear', label: 'normalized_linear — normalized ranks · old default · long-query inflation' },
  { value: 'weighted_rrf', label: 'weighted_rrf — weighted rank fusion · uses path weights · 0-0.3 score' },
  { value: 'rrf', label: 'rrf — rank fusion · 0-0.2 score · ranking only' },
  { value: 'max_signal', label: 'max_signal — strongest signal wins · multi-path boost · tolerant' },
  { value: 'cascade', label: 'cascade — signal tiers · exact>gs>dense · can exceed 1.0' },
  { value: 'dense_floor', label: 'dense_floor — semantic threshold · low cosine gets cut · aggressive' },
];

export default function RecallWorkbench(): React.JSX.Element {
  const { t } = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialForm = useMemo<DebugForm>(() => ({
    query: readStringParam(searchParams, 'query'),
    sessionId: readStringParam(searchParams, 'session_id', DEFAULT_DEBUG.sessionId),
    limit: readNumberParam(searchParams, 'limit', Number(DEFAULT_DEBUG.limit), { min: 1 }),
    minScore: readNumberParam(searchParams, 'min_score', Number(DEFAULT_DEBUG.minScore)),
    maxDisplayItems: readNumberParam(searchParams, 'max_display_items', Number(DEFAULT_DEBUG.maxDisplayItems), { min: 1 }),
    minDisplayScore: Number(readStringParam(searchParams, 'min_display_score', String(DEFAULT_DEBUG.minDisplayScore))) || Number(DEFAULT_DEBUG.minDisplayScore),
    scorePrecision: readNumberParam(searchParams, 'score_precision', Number(DEFAULT_DEBUG.scorePrecision), { min: 0 }),
    readNodeDisplayMode: readStringParam(searchParams, 'read_node_display_mode', DEFAULT_DEBUG.readNodeDisplayMode),
    excludeBootFromResults: readBooleanParam(searchParams, 'exclude_boot_from_results', DEFAULT_DEBUG.excludeBootFromResults),
    strategy: readStringParam(searchParams, 'strategy'),
  }), [searchParams]);
  const [debugForm, setDebugForm] = useState<DebugForm>(initialForm);
  const [debugData, setDebugData] = useState<Record<string, unknown> | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setDebugForm(initialForm);
  }, [initialForm]);

  const buildDebugUrl = useCallback((form: DebugForm) => {
    return buildUrlWithSearchParams('/recall', searchParams, {
      query: form.query,
      session_id: form.sessionId,
      limit: form.limit,
      min_score: form.minScore,
      max_display_items: form.maxDisplayItems,
      min_display_score: form.minDisplayScore,
      score_precision: form.scorePrecision,
      read_node_display_mode: form.readNodeDisplayMode,
      exclude_boot_from_results: form.excludeBootFromResults,
      strategy: form.strategy,
    }, {
      query: DEFAULT_DEBUG.query,
      session_id: DEFAULT_DEBUG.sessionId,
      limit: DEFAULT_DEBUG.limit,
      min_score: DEFAULT_DEBUG.minScore,
      max_display_items: DEFAULT_DEBUG.maxDisplayItems,
      min_display_score: DEFAULT_DEBUG.minDisplayScore,
      score_precision: DEFAULT_DEBUG.scorePrecision,
      read_node_display_mode: DEFAULT_DEBUG.readNodeDisplayMode,
      exclude_boot_from_results: DEFAULT_DEBUG.excludeBootFromResults,
      strategy: DEFAULT_DEBUG.strategy,
    });
  }, [searchParams]);

  const patchForm = useCallback((p: Partial<DebugForm>) => setDebugForm((prev) => ({ ...prev, ...p })), []);

  const runDebug = useCallback(async (form: DebugForm) => {
    setDebugLoading(true);
    setDebugError('');
    try {
      const body: Record<string, unknown> = {
        query: form.query,
        session_id: form.sessionId || undefined,
        limit: asNumber(form.limit, 12),
        min_score: asNumber(form.minScore, 0),
        max_display_items: asNumber(form.maxDisplayItems, 3),
        min_display_score: asNumber(form.minDisplayScore, 0.60),
        score_precision: asNumber(form.scorePrecision, 2),
        read_node_display_mode: form.readNodeDisplayMode,
        exclude_boot_from_results: form.excludeBootFromResults,
        log_events: true,
      };
      if (form.strategy) body.strategy = form.strategy;
      const { data } = await api.post('/browse/recall/debug', body);
      setDebugData(data);
    } catch (error) {
      const axiosErr = error as AxiosError<{ detail?: string }>;
      setDebugError(axiosErr.response?.data?.detail || axiosErr.message || t('Debug request failed'));
    } finally {
      setDebugLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialForm.query.trim()) {
      setDebugData(null);
      setDebugError('');
      return;
    }
    void runDebug(initialForm);
  }, [initialForm, runDebug]);

  const submitDebug = useCallback(() => {
    const nextForm: DebugForm = {
      ...debugForm,
      query: debugForm.query.trim(),
      sessionId: debugForm.sessionId.trim() || DEFAULT_DEBUG.sessionId,
      readNodeDisplayMode: debugForm.readNodeDisplayMode || DEFAULT_DEBUG.readNodeDisplayMode,
      strategy: debugForm.strategy,
    };
    setDebugForm(nextForm);
    router.push(buildDebugUrl(nextForm));
  }, [buildDebugUrl, debugForm, router]);

  const runtime = (debugData?.runtime as Record<string, unknown>) || null;

  return (
    <PageCanvas maxWidth="5xl">
      <PageTitle
        eyebrow={t('Workbench')}
        title={t('Recall')}
        description={t('Inspect every stage of the retrieval pipeline — from raw path hits through merged ranking to prompt injection.')}
      />

      {/* Query card — custom container so we can use focus-within for a subtle glow */}
      <div className="animate-in stagger-1 mb-5">
        <div
          className={
            'rounded-2xl border bg-bg-elevated transition-colors duration-200 ease-spring ' +
            (focused ? 'border-sys-blue/40 shadow-[0_0_0_4px_rgba(10,132,255,0.08)]' : 'border-separator-thin')
          }
        >
          <div className="p-4 md:p-5 space-y-3 md:space-y-4">
            <AppTextArea
              rows={2}
              value={debugForm.query}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchForm({ query: e.target.value })}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className="w-full resize-none bg-transparent text-[16px] md:text-[18px] font-medium leading-snug text-txt-primary placeholder:text-txt-quaternary focus:outline-none focus-visible:shadow-none"
              placeholder={t('Ask the archive…')}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitDebug(); }}
              autoFocus
            />

            <div className="flex items-center justify-between gap-4 border-t border-separator-hairline pt-3">
              <div className="flex items-center gap-4 text-[12px] text-txt-tertiary">
                <AppCheckbox
                  checked={debugForm.excludeBootFromResults}
                  onValueChange={(checked) => patchForm({ excludeBootFromResults: checked })}
                  className="text-[12px] text-txt-tertiary"
                  size={14}
                >
                  {t('Exclude boot')}
                </AppCheckbox>
                <button
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-sys-blue hover:opacity-80"
                >
                  {showAdvanced ? t('Hide options') : t('More options')}
                </button>
              </div>
              <Button variant="primary" onClick={submitDebug} disabled={debugLoading || !debugForm.query.trim()}>
                {debugLoading ? t('Running…') : t('Run')}
              </Button>
            </div>

            {showAdvanced && (
              <div className="pt-2 border-t border-separator-hairline space-y-3">
                {/* Strategy selector — full width since label is long */}
                <label className="block">
                  <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Scoring strategy')}</span>
                  <AppSelect
                    value={debugForm.strategy}
                    onValueChange={(value) => patchForm({ strategy: value })}
                    options={STRATEGY_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.label) }))}
                    className="font-sans"
                  />
                </label>
                <div className="grid gap-x-6 gap-y-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                  <label className="block">
                    <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Session')}</span>
                    <AppInput value={debugForm.sessionId} onChange={(e: ChangeEvent<HTMLInputElement>) => patchForm({ sessionId: e.target.value })} />
                  </label>
                  {(
                    [
                      ['limit', t('Limit')],
                      ['minScore', t('Min score')],
                      ['maxDisplayItems', t('Max shown')],
                      ['minDisplayScore', t('Threshold')],
                      ['scorePrecision', t('Precision')],
                    ] as [keyof DebugForm, string][]
                  ).map(([key, label]) => (
                    <label key={key} className="block">
                      <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{label}</span>
                      <AppInput type="number" step="0.01" value={String(debugForm[key])} onChange={(e: ChangeEvent<HTMLInputElement>) => patchForm({ [key]: e.target.value } as Partial<DebugForm>)} className="font-mono tabular-nums" />
                    </label>
                  ))}
                  <label className="block">
                    <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Read mode')}</span>
                    <AppSelect
                      value={debugForm.readNodeDisplayMode}
                      onValueChange={(value) => patchForm({ readNodeDisplayMode: value })}
                      options={[
                        { value: 'soft', label: t('soft') },
                        { value: 'hard', label: t('hard') },
                      ]}
                      className="font-sans"
                    />
                  </label>
                </div>
              </div>
            )}

            {debugError && (
              <div className="rounded-xl bg-sys-red/10 border border-sys-red/20 px-3.5 py-2.5 text-[13px] text-sys-red">
                {debugError}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="animate-in stagger-2">
        {!debugData ? (
          <EmptyState text={t('Run a query to inspect each stage of retrieval.')} />
        ) : (
          <div className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-card p-5">
            <RecallStages
              data={debugData as Parameters<typeof RecallStages>[0]['data']}
              runtime={runtime as Parameters<typeof RecallStages>[0]['runtime']}
              minDisplayScore={asNumber(debugForm.minDisplayScore, 0.60)}
              maxDisplayItems={asNumber(debugForm.maxDisplayItems, 3)}
              scorePrecision={asNumber(debugForm.scorePrecision, 2)}
              sessionId={debugForm.sessionId}
              readNodeDisplayMode={debugForm.readNodeDisplayMode}
              initialStage="query"
            />
          </div>
        )}
      </div>

      {/* Runtime */}
      {runtime && (
        <div className="animate-in stagger-3 mt-5">
          <Section title={t('Runtime')} subtitle={t('Configuration at time of query')}>
            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Services & strategy')}</div>
                <dl className="space-y-2.5 text-[13px]">
                  {(
                    [
                      [t('Strategy'), (runtime.scoring as Record<string, unknown>)?.strategy],
                      [t('Query tokens'), (debugData?.retrieval_meta as Record<string, unknown>)?.query_tokens],
                      [t('Embedding'), (runtime.embedding as Record<string, unknown>)?.model],
                      [t('View LLM'), ((runtime.memory_views as Record<string, unknown>)?.llm as Record<string, unknown>)?.model],
                      [t('Boot URIs'), ((runtime.core_memory_uris as unknown[]) || []).length],
                    ] as [string, unknown][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-4 border-b border-separator-hairline pb-2.5 last:border-b-0">
                      <dt className="text-txt-tertiary">{k}</dt>
                      <dd className="font-mono text-txt-primary">{String(v ?? '—')}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-txt-tertiary">{t('Weights')}</div>
                <dl className="space-y-2.5 text-[13px]">
                  {(
                    [
                      ['w_exact', (runtime.normalized_linear as Record<string, unknown>)?.w_exact],
                      ['w_glossary_semantic', (runtime.normalized_linear as Record<string, unknown>)?.w_glossary_semantic],
                      ['w_dense', (runtime.normalized_linear as Record<string, unknown>)?.w_dense],
                      ['w_lexical', (runtime.normalized_linear as Record<string, unknown>)?.w_lexical],
                    ] as [string, unknown][]
                  ).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-4 border-b border-separator-hairline pb-2.5 last:border-b-0">
                      <dt className="font-mono text-txt-tertiary">{k}</dt>
                      <dd className="font-mono tabular-nums text-sys-blue">{fmt(v, 3)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </Section>
        </div>
      )}
    </PageCanvas>
  );
}
