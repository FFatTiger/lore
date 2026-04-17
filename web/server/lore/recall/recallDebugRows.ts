import { extractCueTerms } from '../view/memoryViewQueries';

export interface SanitizedDenseRow {
  uri: string;
  view_type: string;
  weight: number;
  semantic_score: number;
  cue_terms: string[];
  llm_refined: boolean;
  llm_model: string | null;
  disclosure: string;
}

export interface SanitizedLexicalRow {
  uri: string;
  view_type: string;
  weight: number;
  lexical_score: number;
  fts_hit: boolean;
  text_hit: boolean;
  uri_hit: boolean;
  cue_terms: string[];
  llm_refined: boolean;
  llm_model: string | null;
  disclosure: string;
}

export interface SanitizedExactRow {
  uri: string;
  exact_score: number;
  path_exact_hit: boolean;
  glossary_exact_hit: boolean;
  glossary_text_hit: boolean;
  query_contains_glossary_hit: boolean;
  glossary_fts_hit: boolean;
  cue_terms: string[];
  disclosure: string;
}

export interface SanitizedGlossarySemanticRow {
  uri: string;
  keyword: string;
  glossary_semantic_score: number;
  cue_terms: string[];
  disclosure: string;
}

export function sanitizeGlossarySemanticRow(row: Record<string, unknown>): SanitizedGlossarySemanticRow {
  return {
    uri: row.uri as string,
    keyword: (row.keyword as string) || '',
    glossary_semantic_score: Number(Number(row.glossary_semantic_score || 0).toFixed(6)),
    cue_terms: extractCueTerms(row),
    disclosure: (row.disclosure as string) || '',
  };
}

export function sanitizeDenseRow(row: Record<string, unknown>): SanitizedDenseRow {
  const metadata = (row.metadata as Record<string, unknown>) || {};
  return {
    uri: row.uri as string,
    view_type: row.view_type as string,
    weight: Number(row.weight || 0),
    semantic_score: Number(Number(row.semantic_score || 0).toFixed(6)),
    cue_terms: extractCueTerms(row),
    llm_refined: metadata.llm_refined === true,
    llm_model: (metadata.llm_model as string) || null,
    disclosure: (row.disclosure as string) || '',
  };
}

export function sanitizeLexicalRow(row: Record<string, unknown>): SanitizedLexicalRow {
  const metadata = (row.metadata as Record<string, unknown>) || {};
  return {
    uri: row.uri as string,
    view_type: row.view_type as string,
    weight: Number(row.weight || 0),
    lexical_score: Number(Number(row.lexical_score || 0).toFixed(6)),
    fts_hit: row.fts_hit === true,
    text_hit: row.text_hit === true,
    uri_hit: row.uri_hit === true,
    cue_terms: extractCueTerms(row),
    llm_refined: metadata.llm_refined === true,
    llm_model: (metadata.llm_model as string) || null,
    disclosure: (row.disclosure as string) || '',
  };
}

export function sanitizeExactRow(row: Record<string, unknown>): SanitizedExactRow {
  return {
    uri: row.uri as string,
    exact_score: Number(Number(row.exact_score || 0).toFixed(6)),
    path_exact_hit: row.path_exact_hit === true,
    glossary_exact_hit: row.glossary_exact_hit === true,
    glossary_text_hit: row.glossary_text_hit === true,
    query_contains_glossary_hit: row.query_contains_glossary_hit === true,
    glossary_fts_hit: row.glossary_fts_hit === true,
    cue_terms: extractCueTerms(row),
    disclosure: (row.disclosure as string) || '',
  };
}
