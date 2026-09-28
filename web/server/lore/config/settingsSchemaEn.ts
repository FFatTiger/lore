/**
 * English copy for the settings schema. The schema itself is authored in Chinese;
 * these entries are attached as `label_en` / `description_en` so the UI can show
 * the right language. Keep keys in sync with SETTINGS_SCHEMA / SECTIONS.
 */

export interface EnglishCopy {
  label: string;
  description?: string;
}

export const SECTIONS_EN: Record<string, EnglishCopy> = {
  cache: { label: 'Cache', description: 'Toggle caching; the Redis backend is enabled automatically by REDIS_URL' },
  lifecycle: {
    label: 'Lifecycle injection',
    description: 'Server-side context returned to each agent on session.start / prompt.submit',
  },
  prompts: { label: 'Server prompts', description: 'Server-side LLM prompt templates for views, boot drafts, and Dream' },
  recall_weights: { label: 'Recall weights', description: 'Linear weights of the four scoring signals (should sum to 1)' },
  recall_bonus: { label: 'Bonuses', description: 'Bonuses for priority and multi-view hits' },
  recall_recency: { label: 'Recency decay', description: 'Rank recently updated memories higher (off by default)' },
  recall_display: { label: 'Display threshold', description: 'Decides which candidates are injected into the prompt' },
  recall_safety: {
    label: 'Recall safeguards',
    description: 'Limit oversized and slow queries so recall never blocks the main flow',
  },
  views: { label: 'View weights', description: 'Weights and priors of gist/question views' },
  embedding: { label: 'Embedding service', description: 'Embedding model endpoint (e.g. http://127.0.0.1:8090/v1)' },
  view_llm: {
    label: 'View LLM',
    description: 'LLM used for view refinement (e.g. http://127.0.0.1:8090/v1; leave empty to disable)',
  },
  policy: { label: 'Write policy', description: 'Automatic checks applied before MCP writes' },
  dream: { label: 'Dream schedule', description: 'Schedule for automatic memory consolidation (requires View LLM)' },
  backup: { label: 'Data backup', description: 'Automatic database backup and restore' },
  review: { label: 'Review', description: 'Local storage location for review changesets' },
};

export const SETTINGS_EN: Record<string, EnglishCopy> = {
  'cache.enabled': {
    label: 'Enable cache',
    description: 'When off, all cache reads and writes are skipped. On by default. Whether Redis is used is decided by REDIS_URL.',
  },
  'lifecycle.guidance.enabled': {
    label: 'Enable startup guidance',
    description: 'When off, session.start no longer injects the global Lore usage rules; only boot nodes and startup recall remain.',
  },
  'lifecycle.guidance.global': {
    label: 'Global Lore usage rules',
    description: 'Fixed guidance injected by the server into session.start. Plugins no longer bundle this text.',
  },
  'lifecycle.boot.preamble': {
    label: 'Boot block preamble',
    description: 'Text shown before the boot node list. Node content is still read via lore_boot.',
  },
  'lifecycle.startup_recall.preamble': {
    label: 'Startup recall preamble',
    description: 'Shown before the <recall> block when startup recall finds memories for the runtime/project.',
  },
  'lifecycle.prompt_recall.preamble': {
    label: 'Prompt recall preamble',
    description: 'Shown before the <recall> block whenever prompt.submit recalls memories; leave empty to inject only the <recall> block.',
  },
  'prompts.view_generation.system': {
    label: 'View generation system prompt',
    description: 'System prompt sent to the View LLM when generating gist/question retrieval views.',
  },
  'prompts.boot_draft.system': {
    label: 'Boot draft system prompt',
    description: 'System prompt for drafting fixed boot memories; use {{instructions}} to insert node-specific constraints.',
  },
  'prompts.boot_draft.instructions.role_agent': {
    label: 'Boot draft: agent node instructions',
    description: 'Role instructions when drafting core://agent and agent runtime nodes.',
  },
  'prompts.boot_draft.instructions.role_soul': {
    label: 'Boot draft: soul node instructions',
    description: 'Role instructions when drafting core://soul.',
  },
  'prompts.boot_draft.instructions.role_user': {
    label: 'Boot draft: user node instructions',
    description: 'Role instructions when drafting preferences://user.',
  },
  'prompts.boot_draft.instructions.global_agent_extra': {
    label: 'Boot draft: global agent extras',
    description: 'Extra constraints appended when drafting the global core://agent.',
  },
  'prompts.boot_draft.instructions.client_extra': {
    label: 'Boot draft: common client instructions',
    description: 'Common constraints appended when drafting core://agent/<client_type>; use {{client_type}}.',
  },
  'prompts.boot_draft.instructions.client_claudecode': {
    label: 'Boot draft: Claude Code instructions',
    description: 'Constraints appended when drafting core://agent/claudecode.',
  },
  'prompts.boot_draft.instructions.client_openclaw': {
    label: 'Boot draft: OpenClaw instructions',
    description: 'Constraints appended when drafting core://agent/openclaw.',
  },
  'prompts.boot_draft.instructions.client_hermes': {
    label: 'Boot draft: Hermes instructions',
    description: 'Constraints appended when drafting core://agent/hermes.',
  },
  'prompts.boot_draft.instructions.client_codex': {
    label: 'Boot draft: Codex instructions',
    description: 'Constraints appended when drafting core://agent/codex.',
  },
  'prompts.boot_draft.instructions.client_pi': {
    label: 'Boot draft: Pi instructions',
    description: 'Constraints appended when drafting core://agent/pi.',
  },
  'prompts.boot_draft.instructions.client_opencode': {
    label: 'Boot draft: OpenCode instructions',
    description: 'Constraints appended when drafting core://agent/opencode.',
  },
  'prompts.boot_draft.instructions.client_zcode': {
    label: 'Boot draft: ZCode instructions',
    description: 'Constraints appended when drafting core://agent/zcode.',
  },
  'prompts.dream.system': {
    label: 'Dream system prompt',
    description: 'Main system prompt of the Dream consolidation agent; supports template variables such as {{guidance}} and {{boot_baseline_json}}.',
  },
  'prompts.dream.poetic_diary': {
    label: 'Dream diary rewrite prompt',
    description: 'System prompt used to rewrite the raw Dream audit into a diary.',
  },
  'prompts.dream.phase.diagnose': {
    label: 'Dream diagnose phase prompt',
    description: 'User prompt sent to the LLM in the Dream diagnose phase.',
  },
  'prompts.dream.phase.plan': {
    label: 'Dream plan phase prompt',
    description: 'User prompt for the Dream plan phase; use {{diagnosis}}.',
  },
  'prompts.dream.phase.preflight': {
    label: 'Dream preflight phase prompt',
    description: 'User prompt for the Dream preflight phase; use {{plan_json}}.',
  },
  'prompts.dream.phase.apply': {
    label: 'Dream apply phase prompt',
    description: 'User prompt for the Dream apply phase; use {{plan_json}} and {{preflight}}.',
  },
  'prompts.dream.phase.audit': {
    label: 'Dream audit phase prompt',
    description: 'User prompt for the Dream audit phase; use {{diagnosis}}, {{plan_json}}, {{preflight}}, and {{apply}}.',
  },
  'recall.weights.w_exact': { label: 'Exact match weight', description: 'Weight of exact / URI / glossary hit scores' },
  'recall.weights.w_glossary_semantic': {
    label: 'Glossary semantic weight',
    description: 'Weight of glossary-level semantic similarity',
  },
  'recall.weights.w_dense': { label: 'Dense vector weight', description: 'Weight of whole-text embedding similarity' },
  'recall.weights.w_lexical': { label: 'Lexical (FTS) weight', description: 'Weight of full-text search token hits' },
  'recall.bonus.priority_base': { label: 'Priority base', description: 'Maximum bonus at priority 0' },
  'recall.bonus.priority_step': { label: 'Priority step', description: 'Bonus deducted for each +1 in priority' },
  'recall.bonus.multi_view_step': {
    label: 'Multi-view step',
    description: 'Bonus added for each additional view type that matches',
  },
  'recall.bonus.multi_view_cap': { label: 'Multi-view cap', description: 'Upper bound of the multi-view bonus' },
  'recall.recency.enabled': {
    label: 'Enable recency decay',
    description: 'When on, recently updated memories get an extra bonus and older ones get less. When off, behavior matches previous versions exactly.',
  },
  'recall.recency.half_life_days': {
    label: 'Half-life (days)',
    description: 'After this many days the recency bonus drops to half its maximum. 180 days is gentle; 30 days favors recent memories.',
  },
  'recall.recency.max_bonus': {
    label: 'Max recency bonus',
    description: 'Maximum bonus for a just-updated memory (similar magnitude to priority_base 0.05).',
  },
  'recall.recency.priority_exempt': {
    label: 'Decay-exempt priority',
    description: 'Memories with priority <= this value never decay and always get the full bonus. -1 means every memory decays.',
  },
  'recall.display.min_display_score': {
    label: 'Minimum display score',
    description: 'Candidates below this score are not injected into the prompt (0.60 suggested for default scoring)',
  },
  'recall.display.max_display_items': {
    label: 'Max displayed items',
    description: 'Maximum number of memories injected per recall',
  },
  'recall.safety.max_query_chars': {
    label: 'Max recall query characters',
    description: 'For long user input, recall only uses the first N characters and notes the truncation in its output.',
  },
  'recall.safety.timeout_ms': {
    label: 'Recall timeout (ms)',
    description: 'Recall is skipped with a notice after this long, so long text or slow queries never block the main flow.',
  },
  'views.weight.gist': { label: 'Gist view weight', description: 'Multiplier in dense/lexical ranking' },
  'views.weight.question': { label: 'Question view weight', description: 'Multiplier in dense/lexical ranking' },
  'views.prior.gist': { label: 'Gist view prior', description: 'view_bonus added when a gist view matches' },
  'views.prior.question': { label: 'Question view prior', description: 'view_bonus added when a question view matches' },
  'embedding.provider': {
    label: 'Embedding provider',
    description: 'Embedding API protocol. OpenAI-compatible /embeddings is currently supported.',
  },
  'embedding.base_url': {
    label: 'Embedding base URL',
    description: 'Base URL of the embedding service (OpenAI-compatible /embeddings; e.g. http://127.0.0.1:8090/v1)',
  },
  'embedding.api_key': { label: 'Embedding API key', description: 'API key for the embedding service' },
  'embedding.model': { label: 'Embedding model', description: 'e.g. text-embedding-3-small' },
  'view_llm.provider': {
    label: 'View LLM provider',
    description: 'LLM API protocol used by views and Dream. Defaults to the existing OpenAI-style /chat/completions.',
  },
  'view_llm.base_url': {
    label: 'View LLM base URL',
    description: 'LLM base URL for view generation and Dream, e.g. http://127.0.0.1:8090/v1; leave empty to disable LLM refinement and Dream runs',
  },
  'view_llm.api_key': { label: 'View LLM API key', description: 'LLM API key for view generation and Dream' },
  'view_llm.model': { label: 'View LLM model', description: 'LLM model name used to generate gist/question views' },
  'view_llm.temperature': {
    label: 'View LLM temperature',
    description: 'Sampling temperature (0 = deterministic, >1 = more random)',
  },
  'view_llm.max_docs_per_run': {
    label: 'View LLM docs per index run',
    description: 'Maximum documents refined by the LLM in a single index build',
  },
  'view_llm.timeout_ms': { label: 'View LLM timeout (ms)', description: 'Request timeout for View/Dream LLM calls' },
  'view_llm.api_version': {
    label: 'View LLM API version',
    description: 'Optional API version header; usually needed for native Anthropic endpoints.',
  },
  'policy.priority_budget_enabled': {
    label: 'Priority budget check',
    description: 'On create/update, check library-wide caps for priority 0/1 (level 0 ≤ 5, level 1 ≤ 15)',
  },
  'policy.disclosure_warning_enabled': {
    label: 'Disclosure quality check',
    description: 'On create, check that a disclosure exists and contains no OR logic',
  },
  'dream.enabled': {
    label: 'Scheduled dreaming',
    description: 'When on, memory consolidation runs daily at the scheduled time (requires View LLM)',
  },
  'dream.cron': {
    label: 'Dream cron',
    description: '5-field cron expression for scheduled dreaming (minute hour day month weekday, in the configured timezone)',
  },
  'dream.auto_approve_changes': {
    label: 'Auto-approve Dream changes',
    description: 'When on, memory changes from Dream are marked approved automatically; when off they stay pending review.',
  },
  'backup.enabled': {
    label: 'Scheduled backup',
    description: 'When on, the database is backed up daily at the scheduled time',
  },
  'backup.cron': {
    label: 'Backup cron',
    description: '5-field cron expression for scheduled backups (minute hour day month weekday; use 0 * * * * for hourly)',
  },
  'backup.retention_count': {
    label: 'Backups to keep',
    description: 'Keep the latest N backups and delete older ones automatically',
  },
  'backup.local.enabled': { label: 'Local backup', description: 'Save backups to the local file system' },
  'backup.webdav.enabled': { label: 'WebDAV backup', description: 'Upload backups to a WebDAV server' },
  'backup.webdav.url': {
    label: 'WebDAV URL',
    description: 'WebDAV server address (e.g. https://dav.example.com/backups/)',
  },
  'backup.webdav.username': { label: 'WebDAV username' },
  'backup.webdav.password': { label: 'WebDAV password' },
  'backup.include_recall_events': {
    label: 'Include recall events',
    description: 'Include the recall_events table in backups (can be large)',
  },
};
