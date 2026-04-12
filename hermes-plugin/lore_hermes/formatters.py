"""
Formatters - Output formatting for Lore memory data
"""

from typing import Any, List, Dict, Optional


def format_node(data: Dict) -> str:
    """Format a memory node for display"""
    node = data.get("node", {})
    children = data.get("children", [])
    
    lines = []
    lines.append(f"URI: {node.get('uri', '')}")
    
    if node.get("node_uuid"):
        lines.append(f"Node UUID: {node['node_uuid']}")
    
    lines.append(f"Priority: {node.get('priority', '')}")
    
    if node.get("disclosure"):
        lines.append(f"Disclosure: {node['disclosure']}")
    
    if node.get("aliases"):
        lines.append(f"Aliases: {', '.join(node['aliases'])}")
    
    lines.append("")
    lines.append(node.get("content", "(empty)"))
    
    if children:
        lines.append("")
        lines.append("Children:")
        for child in children:
            lines.append(f"- {child.get('uri', '')} (priority: {child.get('priority', '')})")
            if child.get("content_snippet"):
                lines.append(f"  {child['content_snippet']}")
    
    if node.get("glossary_keywords"):
        lines.append("")
        lines.append(f"Glossary keywords: {', '.join(node['glossary_keywords'])}")
    
    return "\n".join(lines)


def format_boot_view(data: Dict) -> str:
    """Format boot memory view"""
    core_memories = data.get("core_memories", [])
    recent_memories = data.get("recent_memories", [])
    failed = data.get("failed", [])
    loaded = data.get("loaded", len(core_memories))
    total = data.get("total", len(core_memories))
    
    lines = []
    lines.append("# Core Memories")
    lines.append(f"# Loaded: {loaded}/{total} memories")
    lines.append("")
    
    if failed:
        lines.append("## Failed to load:")
        lines.extend(failed)
        lines.append("")
    
    if core_memories:
        lines.append("## Contents:")
        lines.append("")
        lines.append("For full memory index, use: lore_list_domains and lore_get_node.")
        lines.append("For recent memories, see below.")
        lines.append("")
        
        for memory in core_memories:
            lines.append(f"### {memory.get('uri', '')}")
            if memory.get("priority") is not None:
                lines.append(f"Priority: {memory['priority']}")
            if memory.get("disclosure"):
                lines.append(f"Disclosure: {memory['disclosure']}")
            if memory.get("node_uuid"):
                lines.append(f"Node UUID: {memory['node_uuid']}")
            lines.append("")
            lines.append(memory.get("content", "(empty)"))
            lines.append("")
    else:
        lines.append("(No core memories loaded. Run migration first.)")
    
    if recent_memories:
        lines.append("---")
        lines.append("")
        lines.append("# Recent Memories")
        for memory in recent_memories:
            meta = []
            if memory.get("priority") is not None:
                meta.append(f"priority: {memory['priority']}")
            if memory.get("created_at"):
                meta.append(f"created: {memory['created_at']}")
            suffix = f" ({', '.join(meta)})" if meta else ""
            lines.append(f"- {memory.get('uri', '')}{suffix}")
            if memory.get("disclosure"):
                lines.append(f"  Disclosure: {memory['disclosure']}")
    
    return "\n".join(lines).strip()


def format_search_results(results: List[Dict], meta: Optional[Dict] = None) -> str:
    """Format search results"""
    if not results:
        return "No matching memories found."
    
    lines = []
    for idx, item in enumerate(results, 1):
        parts = [f"{idx}. {item.get('uri', '')} (priority: {item.get('priority', '')}"]
        
        if item.get("score") is not None:
            parts.append(f"score: {item['score']:.3f}")
        
        if item.get("matched_on"):
            parts.append(f"via: {'+'.join(item['matched_on'])}")
        
        lines.append(f"{', '.join(parts)})")
        lines.append(f"   {item.get('snippet', '')}")
    
    text = "\n".join(lines)
    
    if meta and meta.get("semantic_error"):
        text += f"\n\nSemantic fallback skipped: {meta['semantic_error']}"
    
    return text


def format_recall_block(items: List[Dict], session_id: Optional[str] = None, query_id: Optional[str] = None) -> str:
    """Format recall results as a block"""
    if not items:
        return ""
    
    attrs = []
    if session_id:
        attrs.append(f'session_id="{session_id}"')
    if query_id:
        attrs.append(f'query_id="{query_id}"')
    
    lines = [f"<recall {' '.join(attrs)}>" if attrs else "<recall>"]
    
    for item in items:
        score = item.get("score_display")
        if score is not None:
            score_str = f"{score:.2f}"
        else:
            score_str = str(item.get("score", ""))
        
        cues = item.get("cues", [])
        cue_parts = []
        if item.get("read"):
            cue_parts.append("read")
        cue_parts.extend(str(c).strip() for c in cues[:3] if c)
        cue_text = " · ".join(cue_parts)
        
        line = f"{score_str} | {item.get('uri', '')}"
        if cue_text:
            line += f" | {cue_text}"
        lines.append(line)
    
    lines.append("</recall>")
    return "\n".join(lines)


def format_domains(domains: List[Dict]) -> str:
    """Format domain list"""
    if not domains:
        return "No domains found."
    
    lines = [f"- {d.get('domain', '')} ({d.get('root_count', 0)})" for d in domains]
    return "\n".join(lines)


def format_session_reads(reads: List[Dict]) -> str:
    """Format session read list"""
    if not reads:
        return "No read nodes tracked for this session."
    
    lines = [f"- {r.get('uri', '')} ({r.get('read_count', 0)})" for r in reads]
    return "\n".join(lines)
