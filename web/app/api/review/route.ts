import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../server/auth';
import { jsonContractError } from '../../../server/lore/contracts';
import { clearAllReviewGroups } from '../../../server/lore/ops/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await clearAllReviewGroups());
  } catch (error) {
    return jsonContractError(error, 'Failed to clear review groups');
  }
}
