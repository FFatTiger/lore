import { NextResponse } from 'next/server';
import { getCacheHealth } from '../../../server/cache';
import { sql } from '../../../server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = process.env.npm_package_version || '1.0.0';

export async function GET(): Promise<NextResponse> {
  try {
    await sql('SELECT 1');
    const cache = await getCacheHealth();
    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      cache: { provider: cache.provider, ok: cache.ok },
      version: VERSION,
      edition: 'oss',
      capabilities: { skills: false },
    });
  } catch {
    const cache = await getCacheHealth().catch(() => null);
    return NextResponse.json({
      status: 'degraded',
      database: 'disconnected',
      ...(cache ? { cache: { provider: cache.provider, ok: cache.ok } } : {}),
      version: VERSION,
      edition: 'oss',
      capabilities: { skills: false },
    }, { status: 503 });
  }
}
