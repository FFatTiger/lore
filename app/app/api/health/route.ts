import { NextResponse } from 'next/server';
import { sql } from '../../../server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = process.env.npm_package_version || '1.0.0';

export async function GET(): Promise<NextResponse> {
  try {
    await sql('SELECT 1');
    return NextResponse.json({ status: 'ok', database: 'connected', version: VERSION });
  } catch {
    return NextResponse.json({ status: 'degraded', database: 'disconnected', version: VERSION }, { status: 503 });
  }
}
