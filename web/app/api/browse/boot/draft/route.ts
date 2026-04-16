import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '@/server/auth';
import { generateBootDrafts } from '@/server/lore/memory/bootSetup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const data = await generateBootDrafts({
      uris: body?.uris,
      shared_context: body?.shared_context,
      node_context: body?.node_context,
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { detail: (error as Error)?.message || 'Failed to generate boot drafts' },
      { status: Number((error as { status?: number })?.status || 500) },
    );
  }
}
