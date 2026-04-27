import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../../server/auth';
import { getOrphanDetail, permanentlyDeleteDeprecatedMemory } from '../../../../../server/lore/ops/maintenance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ memoryId: string }> }): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { memoryId: rawId } = await params;
  const memoryId = Number(rawId);
  try {
    const detail = await getOrphanDetail(memoryId);
    if (!detail) return NextResponse.json({ detail: `Memory ${memoryId} not found` }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to load orphan detail' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ memoryId: string }> }): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { memoryId: rawId } = await params;
  const memoryId = Number(rawId);
  try {
    return NextResponse.json(await permanentlyDeleteDeprecatedMemory(memoryId, { source: 'api:DELETE /maintenance/orphans' }));
  } catch (error) {
    return NextResponse.json(
      { detail: (error as Error)?.message || 'Failed to delete orphan memory' },
      { status: Number((error as { status?: number })?.status || 500) },
    );
  }
}
