import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unsupported(): NextResponse {
  return NextResponse.json(
    {
      detail: 'Unknown API route. The legacy Python backend proxy is disabled in the Next.js build.',
    },
    { status: 404 },
  );
}

export async function GET(): Promise<NextResponse> {
  return unsupported();
}

export async function POST(): Promise<NextResponse> {
  return unsupported();
}

export async function PUT(): Promise<NextResponse> {
  return unsupported();
}

export async function DELETE(): Promise<NextResponse> {
  return unsupported();
}

export async function PATCH(): Promise<NextResponse> {
  return unsupported();
}
