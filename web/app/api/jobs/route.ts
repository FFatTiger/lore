import { NextRequest, NextResponse } from 'next/server';
import { requireBearerAuth } from '../../../server/auth';
import { jsonContractError } from '../../../server/lore/contracts';
import { listJobRuns } from '../../../server/lore/jobs/history';
import { toJsonSafeValue } from '../../../server/lore/jobs/jsonSafe';
import { listRegisteredJobs, runJobNow } from '../../../server/lore/jobs/registry';
import type { RegisteredJob } from '../../../server/lore/jobs/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function serializeJob({ run: _run, ...job }: RegisteredJob): Omit<RegisteredJob, 'run'> {
  return job;
}

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const job_id = searchParams.get('job_id') || undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam === null ? undefined : Number(limitParam);
    const recent_runs = await listJobRuns({ job_id, limit });
    const jobs = listRegisteredJobs().map(serializeJob);

    return NextResponse.json({ jobs, recent_runs });
  } catch (error) {
    return jsonContractError(error, 'Jobs API failed');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({}));
    const job_id = typeof body.job_id === 'string' ? body.job_id.trim() : '';
    if (!job_id) {
      return NextResponse.json({ detail: 'Missing job_id' }, { status: 400 });
    }

    const result = await runJobNow(job_id);
    return NextResponse.json(toJsonSafeValue(result));
  } catch (error) {
    return jsonContractError(error, 'Job failed');
  }
}
