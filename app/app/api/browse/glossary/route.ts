import { NextRequest, NextResponse } from 'next/server';
import { normalizeClientType, requireBearerAuth } from '../../../../server/auth';
import { addGlossaryKeyword, getGlossary, removeGlossaryKeyword } from '../../../../server/lore/search/glossary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await getGlossary());
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to load glossary' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const clientType = normalizeClientType(request.nextUrl.searchParams.get('client_type'));
    return NextResponse.json(await addGlossaryKeyword(await request.json(), { source: 'api:POST /browse/glossary', client_type: clientType }));
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to add glossary keyword' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const clientType = normalizeClientType(request.nextUrl.searchParams.get('client_type'));
    return NextResponse.json(await removeGlossaryKeyword(await request.json(), { source: 'api:DELETE /browse/glossary', client_type: clientType }));
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to remove glossary keyword' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
