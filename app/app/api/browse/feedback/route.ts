import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../../server/auth';
import { getMemoryHealthReport, getDeadWrites, getPathEffectiveness } from '../../../../server/lore/recall/feedbackAnalytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const report = searchParams.get('report') || 'health';
  const days = Number(searchParams.get('days') || 30);
  const limit = Number(searchParams.get('limit') || 20);

  try {
    switch (report) {
      case 'health':
        return NextResponse.json(await getMemoryHealthReport({ days, limit }));
      case 'dead_writes':
        return NextResponse.json(await getDeadWrites({ days, limit }));
      case 'path_effectiveness':
        return NextResponse.json(await getPathEffectiveness({ days }));
      default:
        return NextResponse.json(
          { detail: `Unknown report type: ${report}. Use: health, dead_writes, path_effectiveness` },
          { status: 400 },
        );
    }
  } catch (error) {
    return NextResponse.json(
      { detail: (error as Error)?.message || 'Feedback analytics failed' },
      { status: Number((error as { status?: number })?.status || 500) },
    );
  }
}
