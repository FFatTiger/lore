import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

export const CLIENT_TYPES = ['claudecode', 'openclaw', 'hermes', 'codex', 'mcp', 'admin'] as const;
export type ClientType = typeof CLIENT_TYPES[number];

const CLIENT_TYPE_SET = new Set<string>(CLIENT_TYPES);

export function normalizeClientType(value: unknown): ClientType | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = String(raw || '').trim().toLowerCase();
  return CLIENT_TYPE_SET.has(text) ? (text as ClientType) : null;
}

export function getApiToken(): string {
  return process.env.API_TOKEN || '';
}

function safeEqual(a: unknown, b: unknown): boolean {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function extractBearerToken(request: { headers: Headers }): string {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return '';
  return authorization.slice('Bearer '.length).trim();
}

function extractCookieToken(request: { headers: Headers; cookies?: { get(name: string): { value: string } | undefined } }): string {
  const cookieToken = request.cookies?.get('api_token')?.value;
  if (cookieToken) return cookieToken;

  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)api_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export function isAuthorizedRequest(request: { headers: Headers; cookies?: { get(name: string): { value: string } | undefined } }): boolean {
  const expectedToken = getApiToken();
  if (!expectedToken) return true;

  const bearerToken = extractBearerToken(request);
  if (bearerToken && safeEqual(bearerToken, expectedToken)) return true;

  const cookieToken = extractCookieToken(request);
  if (cookieToken && safeEqual(cookieToken, expectedToken)) return true;

  return false;
}

export function requireBearerAuth(request: { headers: Headers }): NextResponse | null {
  const expectedToken = getApiToken();
  if (!expectedToken) return null;

  const providedToken = extractBearerToken(request);
  if (!providedToken || !safeEqual(providedToken, expectedToken)) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

export function requireApiAuth(request: { headers: Headers; cookies?: { get(name: string): { value: string } | undefined } }): NextResponse | null {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
