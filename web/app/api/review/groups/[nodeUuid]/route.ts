import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../server/auth';
import { jsonContractError } from '../../../../../server/lore/contracts';
import { approveReviewGroup, rollbackReviewGroup } from '../../../../../server/lore/ops/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, { params }: { params: { nodeUuid: string } }): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await approveReviewGroup(params.nodeUuid));
  } catch (error) {
    return jsonContractError(error, 'Failed to approve review group');
  }
}

export async function POST(request: NextRequest, { params }: { params: { nodeUuid: string } }): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await rollbackReviewGroup(params.nodeUuid));
  } catch (error) {
    return jsonContractError(error, 'Failed to rollback review group');
  }
}
