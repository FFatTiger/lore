'use client';

import React, { useState, useCallback, KeyboardEvent, ChangeEvent } from 'react';
import { api } from '../../lib/api';
import {
  PageCanvas, PageTitle, Section, Button, EmptyState, inputClass,
  fmt, asNumber,
} from '../../components/ui';
import RecallStages from '../../components/RecallStages';
import { useT } from '../../lib/i18n';
import { AxiosError } from 'axios';

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
  { value: '', label: '默认（跟随 /settings）' },
  { value: 'raw_plus_lex_damp', label: 'raw_plus_lex_damp — 原始分+lex长压 · 推荐 · 抗长query' },
  { value: 'raw_score', label: 'raw_score — 原始分相加 · 最诚实 · 质量=分数' },
  { value: 'normalized_linear', label: 'normalized_linear — 排名归一化 · 旧默认 · 长query虚高' },
  { value: 'weighted_rrf', label: 'weighted_rrf — 加权rank融合 · 用路径权重 · 0-0.3分' },
  { value: 'rrf', label: 'rrf — rank融合 · 0-0.2分 · 只看排名' },
  { value: 'max_signal', label: 'max_signal — 取最强信号 · 多路径加分 · 宽容' },
  { value: 'cascade', label: 'cascade — 信号分级 · exact>gs>dense · 可超1.0' },
  { value: 'dense_floor', label: 'dense_floor — 语义阈值 · 余弦低砍掉 · 激进' },
];

export default function RecallWorkbench(): React.JSX.Element {
  const { t } = useT();
  const [debugForm, setDebugForm] = useState<DebugForm>(DEFAULT_DEBUG);
  const [debugData, setDebugData] = useState<Record<string, unknown> | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [focused, setFocused] = useState(false);

  const patchForm = useCallback((p: Partial<DebugForm>) => setDebugForm((prev) => ({ ...prev, ...p })), []);

  async function runDebug() {
    setDebugLoading(true);
    setDebugError('');
    try {
      const body: Record<string, unknown> = {
        query: debugForm.query,
        session_id: debugForm.sessionId || undefined,
        limit: asNumber(debugForm.limit, 12),
        min_score: asNumber(debugForm.minScore, 0),
        max_display_items: asNumber(debugForm.maxDisplayItems, 3),
        min_display_score: asNumber(debugForm.minDisplayScore, 0.60),
        score_precision: asNumber(debugForm.scorePrecision, 2),
        read_node_display_mode: debugForm.readNodeDisplayMode,
        exclude_boot_from_results: debugForm.excludeBootFromResults,
        log_events: true,
      };
      if (debugForm.strategy) body.strategy = debugForm.strategy;
      const { data } = await api.post('/browse/recall/debug', body);
      setDebugData(data);
    } catch (error) {
      const axiosErr = error as AxiosError<{ detail?: string }>;
      setDebugError(axiosErr.response?.data?.detail || axiosErr.message || 'Debug request failed');
    } finally {
      setDebugLoading(false);
    }
  }

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
            <textarea
              rows={2}
              value={debugForm.query}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchForm({ query: e.target.value })}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className="w-full resize-none bg-transparent text-[16px] md:text-[18px] font-medium leading-snug text-txt-primary placeholder:text-txt-quaternary focus:outline-none focus-visible:shadow-none"
              placeholder={t('Ask the archive…')}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runDebug(); }}
              autoFocus
            />

            <div className="flex items-center justify-between gap-4 border-t border-separator-hairline pt-3">
              <div className="flex items-center gap-4 text-[12px] text-txt-tertiary">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={debugForm.excludeBootFromResults}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => patchForm({ excludeBootFromResults: e.target.checked })}
                    className="accent-sys-blue h-3.5 w-3.5"
                  />
                  {t('Exclude boot')}
                </label>
                <button
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-sys-blue hover:opacity-80"
                >
                  {showAdvanced ? t('Hide options') : t('More options')}
                </button>
              </div>
              <Button variant="primary" onClick={runDebug} disabled={debugLoading || !debugForm.query.trim()}>
                {debugLoading ? t('Running…') : t('Run')}
              </Button>
            </div>

            {showAdvanced && (
              <div className="pt-2 border-t border-separator-hairline space-y-3">
                {/* Strategy selector — full width since label is long */}
                <label className="block">
                  <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Scoring strategy')}</span>
                  <select value={debugForm.strategy} onChange={(e: ChangeEvent<HTMLSelectElement>) => patchForm({ strategy: e.target.value })} className={inputClass + ' cursor-pointer'}>
                    {STRATEGY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-x-6 gap-y-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
                  <label className="block">
                    <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Session')}</span>
                    <input value={debugForm.sessionId} onChange={(e: ChangeEvent<HTMLInputElement>) => patchForm({ sessionId: e.target.value })} className={inputClass} />
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
                      <input type="number" step="0.01" value={String(debugForm[key])} onChange={(e: ChangeEvent<HTMLInputElement>) => patchForm({ [key]: e.target.value } as Partial<DebugForm>)} className={inputClass + ' tabular-nums'} />
                    </label>
                  ))}
                  <label className="block">
                    <span className="block mb-1 text-[11px] font-medium text-txt-tertiary">{t('Read mode')}</span>
                    <select value={debugForm.readNodeDisplayMode} onChange={(e: ChangeEvent<HTMLSelectElement>) => patchForm({ readNodeDisplayMode: e.target.value })} className={inputClass + ' cursor-pointer'}>
                      <option value="soft">soft</option>
                      <option value="hard">hard</option>
                    </select>
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
