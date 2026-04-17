import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../server/auth';
import { jsonContractError } from '../../../../../server/lore/contracts';
import { clearSessionReads, listSessionReads, markSessionRead } from '../../../../../server/lore/memory/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  try {
    return NextResponse.json(await listSessionReads(searchParams.get('session_id') || ''));
  } catch (error) {
    return jsonContractError(error, 'Failed to list session reads');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await markSessionRead(await request.json()));
  } catch (error) {
    return jsonContractError(error, 'Failed to mark session read');
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  try {
    return NextResponse.json(await clearSessionReads(searchParams.get('session_id') || ''));
  } catch (error) {
    return jsonContractError(error, 'Failed to clear session reads');
  }
}
