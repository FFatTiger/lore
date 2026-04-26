import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth, requireBearerAuth } from '../../../../server/auth';
import { jsonContractError } from '../../../../server/lore/contracts';
import { getDreamDiary, getDreamEntry, getDreamConfig, updateDreamConfig, rollbackDream } from '../../../../server/lore/dream/dreamDiary';
import { runJobNow } from '../../../../server/lore/jobs/registry';
import {
  isDreamWorkflowTerminalEvent,
  listDreamWorkflowEvents,
  subscribeDreamWorkflow,
} from '../../../../server/lore/dream/dreamWorkflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || '';

  if (action === 'workflow_stream') {
    const unauthorized = requireApiAuth(request);
    if (unauthorized) return unauthorized;

    const id = Number(searchParams.get('id') || 0);
    const sinceId = Number(searchParams.get('since_id') || 0);
    const entry = await getDreamEntry(id);
    if (!entry) return jsonContractError(Object.assign(new Error('Entry not found'), { status: 404 }), 'Entry not found');

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sseEvent(event, data)));

        try {
          const existing = await listDreamWorkflowEvents(id, sinceId);
          for (const workflowEvent of existing) {
            send('workflow_event', workflowEvent);
          }

          if (entry.status !== 'running') {
            send('done', { id, status: entry.status });
            controller.close();
            return;
          }

          unsubscribe = subscribeDreamWorkflow(id, (workflowEvent) => {
            send('workflow_event', workflowEvent);
            if (isDreamWorkflowTerminalEvent(workflowEvent.event_type)) {
              send('done', { id, status: workflowEvent.event_type === 'run_completed' ? 'completed' : 'error' });
              unsubscribe?.();
              unsubscribe = null;
              controller.close();
            }
          });
        } catch (error) {
          send('error', { detail: (error as Error).message || 'Workflow stream failed' });
          controller.close();
        }
      },
      cancel() {
        unsubscribe?.();
        unsubscribe = null;
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    if (action === 'entry') {
      const id = Number(searchParams.get('id'));
      const entry = await getDreamEntry(id);
      if (!entry) return jsonContractError(Object.assign(new Error('Entry not found'), { status: 404 }), 'Entry not found');
      return NextResponse.json(entry);
    }
    if (action === 'config') {
      return NextResponse.json(await getDreamConfig());
    }
    // Default: diary list
    const limit = Number(searchParams.get('limit') || 20);
    const offset = Number(searchParams.get('offset') || 0);
    return NextResponse.json(await getDreamDiary({ limit, offset }));
  } catch (error) {
    return jsonContractError(error, 'Dream API failed');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireBearerAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'run';

    if (action === 'config') {
      return NextResponse.json(await updateDreamConfig(body));
    }
    if (action === 'rollback') {
      return NextResponse.json(await rollbackDream(body.id));
    }
    // Default: run dream
    const result = await runJobNow('dream');
    return NextResponse.json(result.result);
  } catch (error) {
    return jsonContractError(error, 'Dream failed');
  }
}
