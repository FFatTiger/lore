import type { ClientType } from '../../auth';

export interface WriteEventContext {
  source?: string;
  session_id?: string | null;
  client_type?: ClientType | null;
}

interface BuildWriteEventBaseOptions {
  node_uri: string;
  node_uuid?: string | null;
  domain?: string;
  path?: string;
  eventContext?: WriteEventContext;
}

export function buildWriteEventBase({
  node_uri,
  node_uuid = null,
  domain = 'core',
  path = '',
  eventContext = {},
}: BuildWriteEventBaseOptions) {
  return {
    node_uri,
    node_uuid,
    domain,
    path,
    source: eventContext.source || 'unknown',
    session_id: eventContext.session_id || null,
    client_type: eventContext.client_type || null,
  };
}
