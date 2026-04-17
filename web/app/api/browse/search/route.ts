import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../server/auth';
import { jsonContractError } from '../../../../server/lore/contracts';
import { searchMemories } from '../../../../server/lore/search/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  try {
    return NextResponse.json(await searchMemories({
      query: searchParams.get('q') || searchParams.get('query') || '',
      domain: searchParams.get('domain') || null,
      limit: Number(searchParams.get('limit') || 10),
      content_limit: Number(searchParams.get('content_limit') || 5),
    }));
  } catch (error) {
    return jsonContractError(error, 'Search failed');
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
      content_limit: Number(body?.content_limit || 5),
    }));
  } catch (error) {
    return jsonContractError(error, 'Search failed');
  }
}
