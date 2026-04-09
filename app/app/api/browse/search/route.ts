import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../server/auth';
import { searchMemories } from '../../../../server/lore/search/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  try {
    return NextResponse.json(await searchMemories({
      query: searchParams.get('query') || '',
      domain: searchParams.get('domain') || null,
      limit: Number(searchParams.get('limit') || 10),
      hybrid: searchParams.get('hybrid') !== 'false',
    }));
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Search failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    return NextResponse.json(await searchMemories({
      query: body?.query || '',
      domain: body?.domain || null,
      limit: Number(body?.limit || 10),
      embedding: body?.embedding || null,
      hybrid: body?.hybrid !== false,
    }));
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Search failed' }, { status: 500 });
  }
}
