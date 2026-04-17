import { NextResponse } from 'next/server';

export type MutationOperation = 'create' | 'update' | 'delete' | 'move';

export interface MutationReceiptBase {
  success: true;
  operation: MutationOperation;
  uri: string;
  path: string;
  node_uuid: string | null;
}

export interface CreateMutationReceipt extends MutationReceiptBase {
  operation: 'create';
  node_uuid: string;
}

export interface UpdateMutationReceipt extends MutationReceiptBase {
  operation: 'update';
  node_uuid: string;
}

export interface DeleteMutationReceipt extends MutationReceiptBase {
  operation: 'delete';
  node_uuid: string;
  deleted_uri: string;
}

export interface MoveMutationReceipt extends MutationReceiptBase {
  operation: 'move';
  node_uuid: string;
  old_uri: string;
  new_uri: string;
}

export interface ContractWarningEnvelope {
  warnings: string[];
  policy_warnings: string[];
}

export interface ContractErrorEnvelope extends Partial<ContractWarningEnvelope> {
  detail: string;
  code?: string;
}

function normalizeWarnings(warnings: string[] | null | undefined): string[] {
  if (!Array.isArray(warnings)) return [];
  return warnings.map((warning) => String(warning || '').trim()).filter(Boolean);
}

export function buildCreateMutationReceipt({
  uri,
  path,
  node_uuid,
}: {
  uri: string;
  path: string;
  node_uuid: string;
}): CreateMutationReceipt {
  return {
    success: true,
    operation: 'create',
    uri,
    path,
    node_uuid,
  };
}

export function buildUpdateMutationReceipt({
  uri,
  path,
  node_uuid,
}: {
  uri: string;
  path: string;
  node_uuid: string;
}): UpdateMutationReceipt {
  return {
    success: true,
    operation: 'update',
    uri,
    path,
    node_uuid,
  };
}

export function buildDeleteMutationReceipt({
  uri,
  path,
  node_uuid,
}: {
  uri: string;
  path: string;
  node_uuid: string;
}): DeleteMutationReceipt {
  return {
    success: true,
    operation: 'delete',
    uri,
    path,
    node_uuid,
    deleted_uri: uri,
  };
}

export function buildMoveMutationReceipt({
  old_uri,
  new_uri,
  path,
  node_uuid,
}: {
  old_uri: string;
  new_uri: string;
  path: string;
  node_uuid: string;
}): MoveMutationReceipt {
  return {
    success: true,
    operation: 'move',
    uri: new_uri,
    path,
    node_uuid,
    old_uri,
    new_uri,
  };
}

export function withContractWarnings<T extends object>(
  body: T,
  warnings?: string[] | null,
): T & ContractWarningEnvelope {
  const normalized = normalizeWarnings(warnings);
  return {
    ...body,
    warnings: normalized,
    policy_warnings: normalized,
  } as T & ContractWarningEnvelope;
}

export function withLegacyNodeCompat<T extends { uri: string; node_uuid?: string | null }>(
  body: T,
  extras: { content?: string } = {},
): T & { node: { uri: string; node_uuid: string | null; content?: string } } {
  const node: { uri: string; node_uuid: string | null; content?: string } = {
    uri: String(body.uri || ''),
    node_uuid: body.node_uuid == null ? null : String(body.node_uuid),
  };
  if (extras.content !== undefined) node.content = extras.content;
  return {
    ...body,
    node,
  };
}

export function getErrorStatus(error: unknown, fallback = 500): number {
  const status = Number((error as { status?: number })?.status || fallback);
  return Number.isFinite(status) && status > 0 ? status : fallback;
}

export function normalizeErrorCode(error: unknown, status: number): string | undefined {
  const explicit = typeof (error as { code?: unknown })?.code === 'string'
    ? String((error as { code?: string }).code || '').trim()
    : '';
  if (explicit) return explicit;
  switch (status) {
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'validation_error';
    default:
      return undefined;
  }
}

export function buildContractError(
  error: unknown,
  fallbackMessage: string,
  warnings?: string[] | null,
): ContractErrorEnvelope {
  const status = getErrorStatus(error);
  const detail = error instanceof Error ? error.message : fallbackMessage;
  const code = normalizeErrorCode(error, status);
  const base: ContractErrorEnvelope = code ? { detail, code } : { detail };
  return warnings == null
    ? base
    : {
        ...base,
        warnings: normalizeWarnings(warnings),
        policy_warnings: normalizeWarnings(warnings),
      };
}

export function jsonContractError(
  error: unknown,
  fallbackMessage: string,
  warnings?: string[] | null,
): NextResponse {
  const status = getErrorStatus(error);
  return NextResponse.json(buildContractError(error, fallbackMessage, warnings), { status });
}
