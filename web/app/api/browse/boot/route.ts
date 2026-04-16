import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../server/auth';
import { bootView } from '../../../../server/lore/memory/boot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    return NextResponse.json(await bootView());
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to load boot view' }, { status: 500 });
  }
}
