import { NextResponse, type NextRequest } from 'next/server';
import { requireBearerAuth } from './auth';

type RouteHandler = (request: NextRequest, context?: unknown) => Promise<NextResponse>;

export function withAuth(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    const authError = requireBearerAuth(request);
    if (authError) return authError;
    return handler(request, context);
  };
}

export function jsonError(message: string, status: number = 500): NextResponse {
  return NextResponse.json({ detail: message }, { status });
}

export async function withErrorHandler(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error: unknown) {
    const status = (error as Record<string, unknown>)?.status as number || 500;
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ detail: message }, { status });
  }
}
