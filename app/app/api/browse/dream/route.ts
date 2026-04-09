import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../server/auth';
import { runDream, getDreamDiary, getDreamEntry, getDreamConfig, updateDreamConfig, rollbackDream } from '../../../../server/lore/dream/dreamDiary';
import { initDreamScheduler } from '../../../../server/lore/dream/dreamScheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Start scheduler on first module load (idempotent)
initDreamScheduler();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || '';

  try {
    if (action === 'entry') {
      const id = Number(searchParams.get('id'));
      const entry = await getDreamEntry(id);
      if (!entry) return NextResponse.json({ detail: 'Entry not found' }, { status: 404 });
      return NextResponse.json(entry);
    }
    if (action === 'config') {
      return NextResponse.json(await getDreamConfig());
    }
    // Default: diary list
    const limit = Number(searchParams.get('limit') || 20);
    const offset = Number(searchParams.get('offset') || 0);
    return NextResponse.json(await getDreamDiary({ limit, offset }));
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Dream API failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'run';

    if (action === 'config') {
      return NextResponse.json(await updateDreamConfig(body));
    }
    if (action === 'rollback') {
      return NextResponse.json(await rollbackDream(body.id));
    }
    // Default: run dream
    const result = await runDream();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Dream failed' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
