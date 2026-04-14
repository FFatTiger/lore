import { NextRequest, NextResponse } from 'next/server';
import { normalizeClientType, requireBearerAuth } from '../../../../server/auth';
import { getNodePayload } from '../../../../server/lore/memory/browse';
import { createNode, deleteNodeByPath, updateNodeByPath } from '../../../../server/lore/memory/write';
import { validateCreatePolicy, validateUpdatePolicy, validateDeletePolicy } from '../../../../server/lore/ops/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asBoolean(value: string): boolean {
  return value === '1' || value === 'true';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const domain = (searchParams.get('domain') || 'core').trim() || 'core';
  const path = (searchParams.get('path') || '').trim().replace(/^\/+|\/+$/g, '');
  const navOnly = asBoolean((searchParams.get('nav_only') || '').toLowerCase());

  try {
    const data = await getNodePayload({ domain, path, navOnly });
    return NextResponse.json(data);
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 500);
    return NextResponse.json(
      { detail: (error as Error)?.message || 'Failed to load node' },
      { status },
    );
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const domain = (searchParams.get('domain') || 'core').trim() || 'core';
  const path = (searchParams.get('path') || '').trim().replace(/^\/+|\/+$/g, '');
  const clientType = normalizeClientType(searchParams.get('client_type'));

  try {
    const body = await request.json();
    const policyResult = await validateUpdatePolicy({
      domain, path,
      priority: body?.priority,
      disclosure: Object.prototype.hasOwnProperty.call(body || {}, 'disclosure') ? body.disclosure : undefined,
      sessionId: body?.session_id || null,
    });
    if (policyResult.errors.length > 0) {
      return NextResponse.json({ detail: policyResult.errors.join('; '), policy_warnings: policyResult.warnings }, { status: 422 });
    }
    const data = await updateNodeByPath({
      domain,
      path,
      content: body?.content,
      priority: body?.priority,
      disclosure: Object.prototype.hasOwnProperty.call(body || {}, 'disclosure') ? body.disclosure : undefined,
    }, { source: 'api:PUT /browse/node', client_type: clientType });
    return NextResponse.json({ ...data, policy_warnings: policyResult.warnings });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to update node' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const clientType = normalizeClientType(request.nextUrl.searchParams.get('client_type'));

  try {
    const body = await request.json();
    const policyResult = await validateCreatePolicy({
      priority: Number(body?.priority ?? 0),
      disclosure: body?.disclosure ?? null,
    });
    if (policyResult.errors.length > 0) {
      return NextResponse.json({ detail: policyResult.errors.join('; '), policy_warnings: policyResult.warnings }, { status: 422 });
    }
    const data = await createNode({
      domain: (body?.domain || 'core').trim() || 'core',
      parentPath: String(body?.parent_path || '').trim().replace(/^\/+|\/+$/g, ''),
      content: String(body?.content || ''),
      priority: Number(body?.priority ?? 0),
      title: body?.title || '',
      disclosure: body?.disclosure ?? null,
    }, { source: 'api:POST /browse/node', client_type: clientType });
    return NextResponse.json({ ...data, policy_warnings: policyResult.warnings });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to create node' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const domain = (searchParams.get('domain') || 'core').trim() || 'core';
  const path = (searchParams.get('path') || '').trim().replace(/^\/+|\/+$/g, '');
  const clientType = normalizeClientType(searchParams.get('client_type'));

  try {
    const sessionId = new URL(request.url).searchParams.get('session_id') || null;
    const policyResult = await validateDeletePolicy({ domain, path, sessionId });
    if (policyResult.errors.length > 0) {
      return NextResponse.json({ detail: policyResult.errors.join('; '), policy_warnings: policyResult.warnings }, { status: 422 });
    }
    const deleteResult = await deleteNodeByPath({ domain, path }, { source: 'api:DELETE /browse/node', client_type: clientType });
    return NextResponse.json({ ...deleteResult, policy_warnings: policyResult.warnings });
  } catch (error) {
    return NextResponse.json({ detail: (error as Error)?.message || 'Failed to delete node' }, { status: Number((error as { status?: number })?.status || 500) });
  }
}
