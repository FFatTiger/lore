import { NextRequest, NextResponse } from 'next/server';
import { normalizeClientType, requireBearerAuth } from '../../../../server/auth';
import { jsonContractError } from '../../../../server/lore/contracts';
import { getNodeHistory, rollbackNodeToEvent } from '../../../../server/lore/memory/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseNodeQuery(request: NextRequest): { domain: string; path: string } {
  const { searchParams } = new URL(request.url);
  return {
    domain: (searchParams.get('domain') || 'core').trim() || 'core',
    path: (searchParams.get('path') || '').trim().replace(/^\/+|\/+$/g, ''),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const { domain, path } = parseNodeQuery(request);
  const limit = Number(searchParams.get('limit') || 50);

  try {
    return NextResponse.json(await getNodeHistory({ domain, path, limit }));
  } catch (error) {
    return jsonContractError(error, 'Failed to load node history');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const { domain, path } = parseNodeQuery(request);
  const clientType = normalizeClientType(searchParams.get('client_type'));

  try {
    const body = await request.json();
    const receipt = await rollbackNodeToEvent(
      { domain, path, eventId: Number(body?.event_id) },
      {
        source: 'api:POST /browse/history',
        session_id: body?.session_id || null,
        client_type: clientType,
      },
    );
    return NextResponse.json(receipt);
  } catch (error) {
    return jsonContractError(error, 'Failed to rollback node');
  }
}
