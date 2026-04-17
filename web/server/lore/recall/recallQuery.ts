// Strip known chat-platform metadata PREFIX from recall queries.
// OpenClaw prepends structured blocks before the user's actual message:
//   "Conversation info (untrusted metadata): ```json ... ```"
//   "Sender (untrusted metadata): ```json ... ```"
// Only strips blocks that appear at the START of the query with known labels,
// so user content containing similar patterns mid-message is left untouched.
const METADATA_PREFIX_RE =
  /^(?:\s*(?:Conversation info|Sender|Channel info|Reply info)\s*\(untrusted metadata\)\s*:\s*```[a-z]*[\s\S]*?```\s*)+/i;

export function sanitizeRecallQuery(raw: string): string {
  if (!raw) return '';
  return raw.replace(METADATA_PREFIX_RE, '').trim();
}

export function resolveRecallQuery(raw: string): string {
  const sanitized = sanitizeRecallQuery(raw);
  return sanitized || raw;
}
