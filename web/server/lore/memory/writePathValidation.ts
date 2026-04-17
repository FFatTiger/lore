const PATH_SEGMENT_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function assertValidPathSegment(value: unknown, label = 'path segment'): string {
  const segment = String(value || '').trim();
  if (!segment) {
    const error = Object.assign(new Error(`${label} is required`), { status: 422 });
    throw error;
  }
  if (!PATH_SEGMENT_RE.test(segment)) {
    const error = Object.assign(
      new Error(
        `${label} must use snake_case ASCII only (lowercase letters, digits, underscores; no Chinese, spaces, or hyphens)`,
      ),
      { status: 422 },
    );
    throw error;
  }
  return segment;
}

export function assertValidPathSegments(path: unknown, label = 'path'): string[] {
  const segments = String(path || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) {
    const error = Object.assign(
      new Error(`${label} must include at least one path segment`),
      { status: 422 },
    );
    throw error;
  }
  for (const segment of segments) {
    assertValidPathSegment(segment, label);
  }
  return segments;
}
