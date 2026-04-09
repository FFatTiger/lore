import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../server/auth';
import { getSchema, resetSettings } from '../../../../server/lore/config/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json();
    const keys = Array.isArray(body?.keys) ? body.keys : body?.key ? [body.key] : [];
    if (!keys.length) {
      return NextResponse.json({ detail: 'keys is required' }, { status: 400 });
    }
    const snapshot = await resetSettings(keys);
    const { schema, sections } = getSchema();
    return NextResponse.json({ schema, sections, ...snapshot });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to reset settings' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
