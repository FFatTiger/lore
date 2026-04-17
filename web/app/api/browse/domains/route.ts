import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../server/auth';
import { jsonContractError } from '../../../../server/lore/contracts';
import { listDomains } from '../../../../server/lore/memory/browse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const data = await listDomains();
    return NextResponse.json(data);
  } catch (error) {
    return jsonContractError(error, 'Failed to load domains');
  }
}
