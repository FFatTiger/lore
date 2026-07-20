/** Minimal TOML section helpers for Codex config.toml (not a full TOML parser). */

/**
 * Upsert keys inside a TOML table section. Values are written as provided
 * (caller supplies already-quoted strings when needed).
 */
export function setTomlSectionKeys(
  content: string,
  sectionHeader: string,
  setKeys: Record<string, string>,
  removeKeyPrefixes: string[] = [],
): string {
  const lines = content.length ? content.split(/\r?\n/) : [];
  const out: string[] = [];
  let i = 0;
  let found = false;
  const written = new Set<string>();

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === sectionHeader) {
      found = true;
      out.push(line);
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith('[')) {
        const stripped = lines[i].trim();
        if (removeKeyPrefixes.some((p) => stripped.startsWith(p))) {
          i += 1;
          continue;
        }
        let replaced = false;
        for (const [k, v] of Object.entries(setKeys)) {
          if (stripped === k || stripped.startsWith(`${k} `) || stripped.startsWith(`${k}=`)) {
            out.push(`${k} = ${v}`);
            written.add(k);
            replaced = true;
            break;
          }
        }
        if (!replaced) out.push(lines[i]);
        i += 1;
      }
      for (const [k, v] of Object.entries(setKeys)) {
        if (!written.has(k)) out.push(`${k} = ${v}`);
      }
      continue;
    }
    out.push(line);
    i += 1;
  }

  if (!found) {
    if (out.length && out[out.length - 1] !== '') out.push('');
    out.push(sectionHeader);
    for (const [k, v] of Object.entries(setKeys)) {
      out.push(`${k} = ${v}`);
    }
  }

  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

export function removeTomlSection(content: string, sectionHeader: string): string {
  const lines = content.length ? content.split(/\r?\n/) : [];
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === sectionHeader) {
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith('[')) i += 1;
      if (out.length && out[out.length - 1] === '') out.pop();
      continue;
    }
    out.push(lines[i]);
    i += 1;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.length ? `${out.join('\n')}\n` : '';
}
