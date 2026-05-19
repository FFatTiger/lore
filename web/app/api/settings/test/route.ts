import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '@/server/auth';
import { testSettingsConnection, type SettingsConnectionSection } from '@/server/lore/llm/connectionTest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({}));
    const result = await testSettingsConnection(
      body?.section as SettingsConnectionSection,
      body?.patch && typeof body.patch === 'object' ? body.patch : {},
    );
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { detail: (error as Error)?.message || 'Failed to test connection' },
      { status: Number((error as { status?: number })?.status || 500) },
    );
  }
}
