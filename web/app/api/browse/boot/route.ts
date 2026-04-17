import { NextRequest, NextResponse } from 'next/server';
import { normalizeClientType, requireBearerAuth } from '@/server/auth';
import { jsonContractError } from '@/server/lore/contracts';
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
    return jsonContractError(error, 'Failed to load boot view');
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
    return jsonContractError(error, 'Failed to save boot nodes');
  }
}
