/**
 * Settings schema: single source of truth for UI + validation + defaults.
 *
 * Separated from runtime operations so that callers that only need schema
 * metadata (e.g. UI rendering) don't pull in DB or cache dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingType = 'number' | 'integer' | 'string' | 'enum' | 'boolean';

export interface SettingDef {
  key: string;
  section: string;
  label: string;
  type: SettingType;
  default: string | number | boolean;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Valid options for enum type */
  options?: string[];
  /** Display labels for enum options (keyed by option value) */
  option_labels?: Record<string, string>;
  /** Environment variable to read as fallback (before hard-coded default) */
  env?: string;
}

export interface SettingSection {
  id: string;
  label: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Schema: single source of truth for UI + validation + defaults
// ---------------------------------------------------------------------------

export const SETTINGS_SCHEMA: SettingDef[] = [
  // -- Scoring strategy -----------------------------------------------------
  {
    key: 'recall.scoring.strategy',
    section: 'recall_scoring',
    label: '评分策略',
    type: 'enum',
    default: 'raw_plus_lex_damp',
    options: ['raw_plus_lex_damp', 'raw_score', 'normalized_linear', 'weighted_rrf', 'rrf', 'max_signal', 'cascade', 'dense_floor'],
    option_labels: {
      raw_plus_lex_damp: '原始分+lex长压 · 推荐 · 抗长query',
      raw_score: '原始分相加 · 最诚实 · 质量=分数',
      normalized_linear: '排名归一化 · 旧默认 · 长query虚高',
      weighted_rrf: '加权rank融合 · 用路径权重 · 0-0.3分',
      rrf: 'rank融合 · 0-0.2分 · 只看排名',
      max_signal: '取最强信号 · 多路径加分 · 宽容',
      cascade: '信号分级 · exact>gs>dense · 可超1.0',
      dense_floor: '语义阈值 · 余弦低砍掉 · 激进',
    },
    description: '决定 4 路分数如何合成 final score。不同策略得分绝对值范围不同，切换后可能要调 min_display_score。',
  },
  {
    key: 'recall.scoring.rrf_k',
    section: 'recall_scoring',
    label: 'RRF k 常数',
    type: 'integer', default: 20, min: 5, max: 200, step: 1,
    description: '仅用于 rrf 策略：越小越倾向 top-rank，典型 20-60',
  },
  {
    key: 'recall.scoring.dense_floor',
    section: 'recall_scoring',
    label: 'Dense 余弦下限',
    type: 'number', default: 0.50, min: 0, max: 0.9, step: 0.01,
    description: '仅用于 dense_floor 策略：低于此的 dense 余弦相似度视为 0',
  },
  {
    key: 'recall.scoring.gs_floor',
    section: 'recall_scoring',
    label: 'Glossary Semantic 下限',
    type: 'number', default: 0.40, min: 0, max: 0.9, step: 0.01,
    description: '仅用于 dense_floor 策略：低于此的 glossary 语义分视为 0',
  },

  // -- Recall weights (applied across all strategies except rrf) ------------
  {
    key: 'recall.weights.w_exact',
    section: 'recall_weights',
    label: '精确匹配权重',
    type: 'number', default: 0.30, min: 0, max: 1, step: 0.01,
    description: '精确/URI/术语命中得分的权重',
  },
  {
    key: 'recall.weights.w_glossary_semantic',
    section: 'recall_weights',
    label: '术语语义权重',
    type: 'number', default: 0.25, min: 0, max: 1, step: 0.01,
    description: '术语级语义相似度的权重',
  },
  {
    key: 'recall.weights.w_dense',
    section: 'recall_weights',
    label: '语义向量权重',
    type: 'number', default: 0.30, min: 0, max: 1, step: 0.01,
    description: '整段文本向量相似度的权重',
  },
  {
    key: 'recall.weights.w_lexical',
    section: 'recall_weights',
    label: '词法（FTS）权重',
    type: 'number', default: 0.05, min: 0, max: 1, step: 0.01,
    description: '全文检索分词命中的权重',
  },

  // -- Bonus parameters -----------------------------------------------------
  {
    key: 'recall.bonus.priority_base',
    section: 'recall_bonus',
    label: '优先级基数',
    type: 'number', default: 0.05, min: 0, max: 0.5, step: 0.005,
    description: '优先级 0 时的加分上限',
  },
  {
    key: 'recall.bonus.priority_step',
    section: 'recall_bonus',
    label: '优先级衰减步长',
    type: 'number', default: 0.01, min: 0, max: 0.1, step: 0.001,
    description: '优先级每 +1 扣除的加分',
  },
  {
    key: 'recall.bonus.multi_view_step',
    section: 'recall_bonus',
    label: '多视图命中步长',
    type: 'number', default: 0.015, min: 0, max: 0.1, step: 0.001,
    description: '每多一个 view 类型命中增加的加分',
  },
  {
    key: 'recall.bonus.multi_view_cap',
    section: 'recall_bonus',
    label: '多视图加分上限',
    type: 'number', default: 0.05, min: 0, max: 0.3, step: 0.005,
    description: '多视图加分的封顶',
  },

  // -- Recency bonus --------------------------------------------------------
  {
    key: 'recall.recency.enabled',
    section: 'recall_recency',
    label: '启用时间衰减',
    type: 'boolean', default: true,
    description: '开启后，最近更新的记忆获得额外加分，年久的记忆加分降低。关闭时行为与旧版完全一致。',
  },
  {
    key: 'recall.recency.half_life_days',
    section: 'recall_recency',
    label: '半衰期（天）',
    type: 'number', default: 180, min: 7, max: 3650, step: 1,
    description: '经过此天数后，时间加分衰减到最大值的一半。180天=较温和；30天=偏向近期。',
  },
  {
    key: 'recall.recency.max_bonus',
    section: 'recall_recency',
    label: '最大时间加分',
    type: 'number', default: 0.04, min: 0, max: 0.3, step: 0.005,
    description: '刚更新的记忆获得的最大加分（与 priority_base 0.05 相近量级）。',
  },
  {
    key: 'recall.recency.priority_exempt',
    section: 'recall_recency',
    label: '免衰减优先级阈值',
    type: 'integer', default: 1, min: -1, max: 10, step: 1,
    description: '优先级 <= 此值的记忆不衰减，始终获得满额加分。-1 表示所有记忆都衰减。',
  },

  // -- Display thresholds ---------------------------------------------------
  {
    key: 'recall.display.min_display_score',
    section: 'recall_display',
    label: '最低展示分数',
    type: 'number', default: 0.60, min: 0, max: 1, step: 0.01,
    description: '低于此分数的候选不会注入到 prompt（raw_plus_lex_damp 建议 0.60；normalized_linear 旧默认 0.45；rrf 建议 0.10）',
  },
  {
    key: 'recall.display.max_display_items',
    section: 'recall_display',
    label: '最多展示条数',
    type: 'integer', default: 3, min: 1, max: 20, step: 1,
    description: '一次召回最多注入几条记忆',
  },
  {
    key: 'recall.display.read_node_display_mode',
    section: 'recall_display',
    label: '已读节点策略',
    type: 'enum', default: 'soft', options: ['soft', 'hard'],
    description: 'soft=分数足够高才展示；hard=完全隐藏',
  },

  // -- View weights / priors ------------------------------------------------
  {
    key: 'views.weight.gist',
    section: 'views',
    label: 'gist 视图权重',
    type: 'number', default: 1.0, min: 0, max: 2, step: 0.01,
    description: '在 dense/lexical 排序中的乘子',
  },
  {
    key: 'views.weight.question',
    section: 'views',
    label: 'question 视图权重',
    type: 'number', default: 0.96, min: 0, max: 2, step: 0.01,
    description: '在 dense/lexical 排序中的乘子',
  },
  {
    key: 'views.prior.gist',
    section: 'views',
    label: 'gist 视图 prior',
    type: 'number', default: 0.03, min: 0, max: 0.2, step: 0.005,
    description: '命中 gist 视图时附加的 view_bonus',
  },
  {
    key: 'views.prior.question',
    section: 'views',
    label: 'question 视图 prior',
    type: 'number', default: 0.02, min: 0, max: 0.2, step: 0.005,
    description: '命中 question 视图时附加的 view_bonus',
  },

  // -- Embedding service ----------------------------------------------------
  {
    key: 'embedding.base_url',
    section: 'embedding',
    label: 'Embedding Base URL',
    type: 'string', default: '', env: 'LORE_EMBEDDING_BASE_URL',
    description: 'OpenAI 兼容的 embedding 服务 URL',
  },
  {
    key: 'embedding.model',
    section: 'embedding',
    label: 'Embedding Model',
    type: 'string', default: '', env: 'LORE_EMBEDDING_MODEL',
    description: '如 Qwen/Qwen3-Embedding-0.6B',
  },

  // -- View LLM -------------------------------------------------------------
  {
    key: 'view_llm.base_url',
    section: 'view_llm',
    label: 'View LLM Base URL',
    type: 'string', default: '', env: 'LORE_VIEW_LLM_BASE_URL',
    description: '生成视图的 chat completion 端点，留空则禁用 LLM 精炼',
  },
  {
    key: 'view_llm.model',
    section: 'view_llm',
    label: 'View LLM Model',
    type: 'string', default: 'glm-5.1', env: 'LORE_VIEW_LLM_MODEL',
    description: '用于生成 gist/question 的 LLM 模型名',
  },
  {
    key: 'view_llm.temperature',
    section: 'view_llm',
    label: 'View LLM Temperature',
    type: 'number', default: 0.2, min: 0, max: 2, step: 0.05,
    env: 'LORE_VIEW_LLM_TEMPERATURE',
    description: 'LLM 生成温度（0=确定性，>1=更随机）',
  },
  {
    key: 'view_llm.max_docs_per_run',
    section: 'view_llm',
    label: 'View LLM 每次索引处理文档数',
    type: 'integer', default: 4, min: 0, max: 100, step: 1,
    env: 'LORE_VIEW_LLM_MAX_DOCS_PER_RUN',
    description: '单次索引构建最多调用 LLM 精炼的文档数',
  },
  {
    key: 'view_llm.timeout_ms',
    section: 'view_llm',
    label: 'View LLM 超时 (ms)',
    type: 'integer', default: 30000, min: 1000, max: 120000, step: 1000,
    env: 'LORE_VIEW_LLM_TIMEOUT_MS',
    description: 'LLM 请求超时时间',
  },

  // -- Write policy ---------------------------------------------------------
  {
    key: 'policy.priority_budget_enabled',
    section: 'policy',
    label: 'Priority 容量检查',
    type: 'boolean', default: true,
    description: '创建/更新时检查 priority 0/1 的全库容量上限（0 级 ≤5, 1 级 ≤15）',
  },
  {
    key: 'policy.read_before_modify_enabled',
    section: 'policy',
    label: '改前必读检查',
    type: 'boolean', default: true,
    description: '更新/删除前检查是否在本次会话中读取过该节点',
  },
  {
    key: 'policy.read_before_modify_window_minutes',
    section: 'policy',
    label: '改前必读时间窗口（分钟）',
    type: 'integer', default: 10, min: 1, max: 60, step: 1,
    description: '必须在此时间窗口内读取过节点，才算满足"改前必读"',
  },
  {
    key: 'policy.disclosure_warning_enabled',
    section: 'policy',
    label: 'Disclosure 质量检查',
    type: 'boolean', default: true,
    description: '创建时检查 disclosure 是否存在，以及是否包含 OR 逻辑',
  },

  // -- Dream schedule -------------------------------------------------------
  {
    key: 'dream.enabled',
    section: 'dream',
    label: '定时做梦',
    type: 'boolean', default: true,
    description: '启用后，系统每天在指定时间自动执行记忆整理（需配置 View LLM）',
  },
  {
    key: 'dream.schedule_hour',
    section: 'dream',
    label: '做梦时间（小时）',
    type: 'integer', default: 3, min: 0, max: 23, step: 1,
    description: '每天自动做梦的小时（0-23，按时区设置）',
  },
  {
    key: 'dream.timezone',
    section: 'dream',
    label: '时区',
    type: 'string', default: 'Asia/Shanghai',
    description: '做梦调度的时区（IANA 格式，如 Asia/Shanghai、America/New_York）',
  },

  // -- Backup schedule ------------------------------------------------------
  {
    key: 'backup.enabled',
    section: 'backup',
    label: '定时备份',
    type: 'boolean', default: false,
    description: '启用后，系统每天在指定时间自动执行数据库备份',
  },
  {
    key: 'backup.schedule_hour',
    section: 'backup',
    label: '备份时间（小时）',
    type: 'integer', default: 4, min: 0, max: 23, step: 1,
    description: '每天自动备份的小时（0-23，按时区设置）',
  },
  {
    key: 'backup.timezone',
    section: 'backup',
    label: '时区',
    type: 'string', default: 'Asia/Shanghai',
    description: '备份调度的时区（IANA 格式）',
  },
  {
    key: 'backup.retention_count',
    section: 'backup',
    label: '保留备份数量',
    type: 'integer', default: 7, min: 1, max: 100, step: 1,
    description: '保留最近 N 个备份，超出的自动删除',
  },
  {
    key: 'backup.local.enabled',
    section: 'backup',
    label: '本地备份',
    type: 'boolean', default: true,
    description: '将备份保存到本地文件系统',
  },
  {
    key: 'backup.webdav.enabled',
    section: 'backup',
    label: 'WebDAV 备份',
    type: 'boolean', default: false,
    description: '将备份上传到 WebDAV 服务器',
  },
  {
    key: 'backup.webdav.url',
    section: 'backup',
    label: 'WebDAV URL',
    type: 'string', default: '',
    description: 'WebDAV 服务器地址（如 https://dav.example.com/backups/）',
  },
  {
    key: 'backup.webdav.username',
    section: 'backup',
    label: 'WebDAV 用户名',
    type: 'string', default: '',
  },
  {
    key: 'backup.webdav.password',
    section: 'backup',
    label: 'WebDAV 密码',
    type: 'string', default: '',
  },
  {
    key: 'backup.include_recall_events',
    section: 'backup',
    label: '包含召回事件',
    type: 'boolean', default: false,
    description: '备份中包含 recall_events 表（数据量可能很大）',
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export const SCHEMA_BY_KEY = new Map<string, SettingDef>(
  SETTINGS_SCHEMA.map((item) => [item.key, item]),
);

// ---------------------------------------------------------------------------
// UI sections
// ---------------------------------------------------------------------------

export const SECTIONS: SettingSection[] = [
  { id: 'recall_scoring', label: '评分策略', description: '选择评分算法（影响 score 的绝对值与长 query 行为）' },
  { id: 'recall_weights', label: '召回权重', description: '四路评分的线性权重（建议和为 1）' },
  { id: 'recall_bonus', label: '加分参数', description: '优先级和多视图命中的加分' },
  { id: 'recall_recency', label: '时间衰减', description: '让近期更新的记忆排名更高（默认关闭）' },
  { id: 'recall_display', label: '展示阈值', description: '决定哪些候选注入到 prompt' },
  { id: 'views', label: '视图权重', description: 'gist/question 视图的权重与 prior' },
  { id: 'embedding', label: 'Embedding 服务', description: '向量化模型端点' },
  { id: 'view_llm', label: 'View LLM', description: '用于视图精炼的 LLM（可留空禁用）' },
  { id: 'policy', label: '写入策略', description: '控制 MCP 写入前的自动检查规则' },
  { id: 'dream', label: '做梦计划', description: '自动记忆整理的执行计划（需 View LLM 配置）' },
  { id: 'backup', label: '数据备份', description: '自动备份与恢复数据库' },
];
