import type { QueryResult, PoolClient } from 'pg';

// === Core Data Model ===
export interface URI {
  domain: string;
  path: string;
}

export interface MemoryNode {
  id: number;
  node_uuid: string;
  memory_id: number;
  domain: string;
  path: string;
  full_path: string;
  parent_path: string | null;
}

export interface MemoryContent {
  memory_id: number;
  title: string;
  content: string;
  priority: number;
  disclosure: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryNodePayload extends MemoryNode, MemoryContent {
  aliases: string[];
  glossary_keywords: string[];
  children: MemoryChildNode[];
}

export interface MemoryChildNode {
  domain: string;
  path: string;
  title: string;
  priority: number;
  child_count: number;
}

// === Recall ===
export interface RecallCandidate {
  uri: string;
  node_uuid: string;
  memory_id: number;
  domain: string;
  path: string;
  title: string;
  priority: number;
  disclosure: string | null;
  view_type: string;
  dense_score: number;
  lexical_score: number;
  exact_score: number;
  glossary_score: number;
  recency_bonus: number;
  final_score: number;
}

export interface RecallResult {
  uri: string;
  node_uuid: string;
  title: string;
  priority: number;
  disclosure: string | null;
  score: number;
  display: boolean;
  scores: ScoreBreakdown;
  rank: number;
}

export interface ScoreBreakdown {
  dense: number;
  lexical: number;
  exact: number;
  glossary: number;
  recency: number;
  final: number;
}

export interface ScoringConfig {
  strategy: string;
  weights: Record<string, number>;
  min_display_score: number;
  max_display: number;
  recency_half_life_days: number;
  query_token_count: number;
}

export interface DisplayConfig {
  min_display_score: number;
  max_display: number;
  boot_uris: string[];
}

// === Embedding ===
export interface EmbeddingConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export type FtsConfigName = 'zhparser' | 'jiebacfg' | 'simple';

// === Memory Views ===
export interface SourceDocument {
  memory_id: number;
  node_uuid: string;
  domain: string;
  path: string;
  title: string;
  content: string;
  priority: number;
  disclosure: string | null;
  glossary_keywords: string[];
  signature: string;
}

export interface MemoryViewRecord {
  memory_id: number;
  node_uuid: string;
  view_type: 'gist' | 'question';
  text: string;
  domain: string;
  path: string;
  embedding: number[] | null;
  signature: string;
}

// === Settings ===
export type SettingType = 'number' | 'integer' | 'string' | 'enum' | 'boolean';

export interface SettingDef {
  key: string;
  type: SettingType;
  default: string | number | boolean;
  label: string;
  section: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  envKey?: string;
}

export interface SettingSection {
  key: string;
  label: string;
}

export interface SettingSnapshot {
  key: string;
  value: string | number | boolean;
  default: string | number | boolean;
  source: 'db' | 'env' | 'default';
}

// === Events ===
export interface MemoryEvent {
  id: number;
  event_type: 'create' | 'update' | 'delete' | 'move';
  node_uuid: string;
  uri: string;
  source: string;
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  created_at: string;
}

export interface RecallEvent {
  id: number;
  query_hash: string;
  query_text: string;
  node_uri: string;
  node_uuid: string;
  signal_type: string;
  raw_score: number;
  final_score: number;
  displayed: boolean;
  used_in_answer: boolean;
  strategy: string;
  created_at: string;
}

// === Dream ===
export interface DreamRun {
  id: number;
  narrative: string;
  memory_changes: DreamChange[];
  model: string;
  turns_used: number;
  started_at: string;
  finished_at: string;
}

export interface DreamChange {
  action: string;
  uri: string;
  detail: string;
}

export interface DreamConfig {
  enabled: boolean;
  schedule_hour: number;
  schedule_minute: number;
  timezone: string;
  model: string;
  max_turns: number;
}

// === Backup ===
export interface BackupManifest {
  version: number;
  tables: string[];
  row_counts: Record<string, number>;
  timestamp: string;
}

export interface BackupData {
  manifest: BackupManifest;
  data: Record<string, unknown[]>;
}

// === MCP ===
export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// === Policy ===
export interface PolicyResult {
  ok: boolean;
  warnings: string[];
}

// === Database helpers ===
export type SqlFn = (text: string, params?: unknown[]) => Promise<QueryResult>;
export type TransactionClient = PoolClient;

// === Search ===
export interface SearchResult {
  uri: string;
  node_uuid: string;
  title: string;
  snippet: string;
  priority: number;
  score: number;
  score_breakdown: { fts: number; exact: number; semantic: number };
  matched_on: string[];
}

// === Review ===
export interface ReviewGroup {
  node_uuid: string;
  uri: string;
  title: string;
  change_count: number;
  change_types: string[];
}

export interface ReviewDiff {
  node_uuid: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changes: Array<{ field: string; old: unknown; new: unknown }>;
}
