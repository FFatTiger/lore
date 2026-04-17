import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../server/auth';
import { jsonContractError } from '../../../../../server/lore/contracts';
import { markRecallEventsUsedInAnswer } from '../../../../../server/lore/recall/recallEventLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    return NextResponse.json(await markRecallEventsUsedInAnswer({
      queryId: body?.query_id,
      sessionId: body?.session_id,
      nodeUris: body?.node_uris,
      assistantText: body?.assistant_text,
      source: body?.source || 'agent_end',
      success: body?.success !== false,
    }));
  } catch (error) {
    return jsonContractError(error, 'Recall usage update failed');
  }
}
