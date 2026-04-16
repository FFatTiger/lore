const DEFAULT_RECALL_SCORE_PRECISION = 2;

export function formatNode(data: any) {
  const node = data?.node || {};
  const children = Array.isArray(data?.children) ? data.children : [];
  const lines: string[] = [];
  lines.push(`URI: ${node.uri || ""}`);
  if (node.node_uuid) lines.push(`Node UUID: ${node.node_uuid}`);
  lines.push(`Priority: ${node.priority ?? ""}`);
  if (node.disclosure) lines.push(`Disclosure: ${node.disclosure}`);
  if (Array.isArray(node.aliases) && node.aliases.length > 0) {
    lines.push(`Aliases: ${node.aliases.join(", ")}`);
  }
  lines.push("");
  lines.push(node.content || "(empty)");
  if (children.length > 0) {
    lines.push("");
    lines.push("Children:");
    for (const child of children) {
      lines.push(`- ${child.uri} (priority: ${child.priority ?? ""})`);
      if (child.content_snippet) lines.push(`  ${child.content_snippet}`);
    }
  }
  if (Array.isArray(node.glossary_keywords) && node.glossary_keywords.length > 0) {
    lines.push("");
    lines.push(`Glossary keywords: ${node.glossary_keywords.join(", ")}`);
  }
  return lines.join("\n");
}

export function formatBootView(data: any) {
  const coreMemories = Array.isArray(data?.core_memories) ? data.core_memories : [];
  const recentMemories = Array.isArray(data?.recent_memories) ? data.recent_memories : [];
  const failed = Array.isArray(data?.failed) ? data.failed : [];
  const loaded = Number.isFinite(data?.loaded) ? data.loaded : coreMemories.length;
  const total = Number.isFinite(data?.total) ? data.total : coreMemories.length;
  const lines: string[] = [];

  lines.push("# Core Memories");
  lines.push(`# Loaded: ${loaded}/${total} memories`);
  lines.push("");

  if (failed.length > 0) {
    lines.push("## Failed to load:");
    lines.push(...failed);
    lines.push("");
  }

  if (coreMemories.length > 0) {
    lines.push("## Fixed boot baseline:");
    lines.push("");
    lines.push("Lore boot deterministically loads three fixed startup nodes inside Lore:");
    lines.push("- core://agent — workflow constraints");
    lines.push("- core://soul — style / persona / self-definition");
    lines.push("- preferences://user — stable user definition / durable user context");
    lines.push("");
    for (const memory of coreMemories) {
      lines.push(`### ${memory?.uri || ""}`);
      if (memory?.boot_role_label) lines.push(`Role: ${memory.boot_role_label}`);
      if (memory?.boot_purpose) lines.push(`Purpose: ${memory.boot_purpose}`);
      if (Number.isFinite(memory?.priority)) lines.push(`Priority: ${memory.priority}`);
      if (memory?.disclosure) lines.push(`Disclosure: ${memory.disclosure}`);
      if (memory?.node_uuid) lines.push(`Node UUID: ${memory.node_uuid}`);
      lines.push("");
      lines.push(memory?.content || "(empty)");
      lines.push("");
    }
  } else {
    lines.push("(No core memories loaded.)");
  }

  if (recentMemories.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("# Recent Memories");
    for (const memory of recentMemories) {
      const meta: string[] = [];
      if (Number.isFinite(memory?.priority)) meta.push(`priority: ${memory.priority}`);
      if (memory?.created_at) meta.push(`created: ${memory.created_at}`);
      const suffix = meta.length > 0 ? ` (${meta.join(", ")})` : "";
      lines.push(`- ${memory?.uri || ""}${suffix}`);
      if (memory?.disclosure) lines.push(`  Disclosure: ${memory.disclosure}`);
    }
  }

  return lines.join("\n").trim();
}

export function readCueList(item: any) {
  const cues = Array.isArray(item?.cues) ? item.cues : [];
  const cleaned = cues.map((x: any) => String(x || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return cleaned.slice(0, 3);
}

export function formatRecallBlock(items: any, precision = DEFAULT_RECALL_SCORE_PRECISION, sessionId?: string, queryId?: string) {
  if (!Array.isArray(items) || items.length === 0) return "";
  const attrs = [sessionId && `session_id="${sessionId}"`, queryId && `query_id="${queryId}"`].filter(Boolean).join(" ");
  const lines = [attrs ? `<recall ${attrs}>` : "<recall>"];
  for (const item of items) {
    const score = Number.isFinite(item?.score_display) ? Number(item.score_display).toFixed(precision) : String(item?.score ?? "");
    const cues = readCueList(item);
    const cueText = `${item?.read ? "read · " : ""}${cues.join(" · ")}`.trim();
    lines.push(`${score} | ${item?.uri || ""}${cueText ? ` | ${cueText}` : ""}`);
  }
  lines.push("</recall>");
  return lines.join("\n");
}

export function normalizeSearchResults(data: any) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

export function normalizeKeywordList(values: any) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out: string[] = [];
  for (const value of values) {
    const keyword = String(value || "").trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }
  return out;
}

export function normalizeUriList(items: any) {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.map((item: any) => String(item?.uri || item || "").trim()).filter(Boolean))];
}
