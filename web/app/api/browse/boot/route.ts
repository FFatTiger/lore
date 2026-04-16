import { NextRequest, NextResponse } from 'next/server';
import { normalizeClientType, requireBearerAuth } from '@/server/auth';
import { bootView } from '@/server/lore/memory/boot';
import { saveBootNodes } from '@/server/lore/memory/bootSetup';

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

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const clientType = normalizeClientType(new URL(request.url).searchParams.get('client_type'));

  try {
    const body = await request.json();
    const data = await saveBootNodes(
      { nodes: body?.nodes },
      {
        source: 'api:PUT /browse/boot',
        session_id: body?.session_id || null,
        client_type: clientType,
      },
    );
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { detail: (error as Error)?.message || 'Failed to save boot nodes' },
      { status: Number((error as { status?: number })?.status || 500) },
    );
  }
}
