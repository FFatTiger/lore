import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../server/auth';
import { getSchema, getSettingsSnapshot, updateSettings } from '../../../server/lore/config/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const snapshot = await getSettingsSnapshot();
    const { schema, sections } = getSchema();
    return NextResponse.json({ schema, sections, ...snapshot });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to load settings' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json();
    const snapshot = await updateSettings(body?.patch || {});
    const { schema, sections } = getSchema();
    return NextResponse.json({ schema, sections, ...snapshot });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to update settings' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
