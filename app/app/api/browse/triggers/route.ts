import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../server/auth';
import { manageTriggers } from '../../../../server/lore/search/glossary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await manageTriggers(await request.json(), { source: 'api:POST /browse/triggers' }));
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to update triggers' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
