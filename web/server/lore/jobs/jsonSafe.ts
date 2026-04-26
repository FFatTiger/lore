export function toJsonSafeValue(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      return { result_type: typeof value };
    }
    return JSON.parse(serialized);
  } catch {
    return { result_type: typeof value };
  }
}
