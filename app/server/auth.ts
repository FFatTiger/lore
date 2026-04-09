import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

export function getApiToken(): string {
  return process.env.API_TOKEN || '';
}

function safeEqual(a: unknown, b: unknown): boolean {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function requireBearerAuth(request: { headers: Headers }): NextResponse | null {
  const expectedToken = getApiToken();
  if (!expectedToken) return null;

  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
  }

  const providedToken = authorization.slice('Bearer '.length).trim();
  if (!providedToken || !safeEqual(providedToken, expectedToken)) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
