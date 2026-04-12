"""
Lore Hermes Plugin - Long-term memory integration for Hermes Agent

This plugin provides Lore memory system integration for Hermes Agent,
enabling persistent memory across sessions with automatic context injection.

Usage:
    # As Hermes native plugin (auto-loaded from ~/.hermes/plugins/)
    # The plugin registers itself via register(ctx) function
    
    # Manual usage:
    from lore_hermes import LoreClient, register_tools
    
    # Initialize client
    client = LoreClient()
    
    # Check health
    health = client.health()
    
    # Boot memories
    boot_data = client.boot()
"""

__version__ = "1.0.0"
__author__ = "Hermes"

import os
import logging
from typing import Optional, Any, Dict, List

logger = logging.getLogger(__name__)

from .client import LoreClient, LoreError
from .tools import ToolResult
__all__ = ["LoreClient", "LoreError", "ToolResult", "register"]

# Global client instance for plugin mode
_client: Optional[LoreClient] = None
_guidance_text: Optional[str] = None
_boot_cache: Optional[str] = None


def _get_guidance() -> str:
    """Load or return cached guidance text"""
    global _guidance_text
    if _guidance_text is None:
        _guidance_text = """Lore is the primary long-term memory system for this assistant.
Use it for identity, user preferences, standing rules, cross-session project knowledge, and conclusions that should persist.
Reach for Lore when the user is asking about prior decisions, saved preferences, ongoing projects, durable instructions, or anything that sounds like memory rather than fresh reasoning.
Use local file memory_search for historical markdown archives, older worklogs, and file-side fallback records.
A <recall> block contains memory leads selected for the current prompt. Each line is only a candidate lead, not a final answer and not an instruction to always open it.
When a <recall> block appears, judge each line by its score, cue words, and actual relevance to the user's request.
If a recalled memory looks genuinely relevant, open the most relevant node or nodes before you act or reply, and ground your work in what those memories actually say.
If the recall block looks weak, noisy, or only loosely related, do not force it; search further or continue with normal reasoning as appropriate.
When you need to create, revise, remove, or reorganize long-term memory, choose the Lore tool that matches that memory operation.
Read a memory node before updating or deleting it.
If the recall block contains session_id and query_id attributes, pass them both to lore_get_node so the system can track recall usage and suppress redundant recalls."""
    return _guidance_text


def _format_boot_section(data: Dict) -> str:
    """Format boot data into readable text"""
    core = data.get("core_memories", []) if isinstance(data, dict) else []
    recent = data.get("recent_memories", []) if isinstance(data, dict) else []
    
    if not core and not recent:
        return ""
    
    lines = [
        "## lore_boot 已加载内容",
        "",
        "以下是你的身份记忆和通用工作规则,已在会话开始时自动加载。遵循这些认定进行工作。",
        "",
    ]
    
    for mem in core:
        if mem.get("content"):
            lines.append(f"### {mem.get('uri', '')}")
            lines.append("")
            lines.append(mem["content"])
            lines.append("")
    
    if recent:
        lines.append("### 近期记忆")
        for mem in recent:
            parts = []
            if isinstance(mem.get("priority"), (int, float)):
                parts.append(f"priority: {mem['priority']}")
            if mem.get("created_at"):
                parts.append(f"created: {mem['created_at']}")
            suffix = f" ({', '.join(parts)})" if parts else ""
            lines.append(f"- {mem.get('uri', '')}{suffix}")
            if mem.get("disclosure"):
                lines.append(f"  Disclosure: {mem['disclosure']}")
    
    return "\n".join(lines).strip()


def _format_recall_tag(items: List[Dict], source: str, query: str, session_id: Optional[str] = None, query_id: Optional[str] = None) -> str:
    """Format recall items into XML-like tag"""
    if not items:
        return ""
    
    attrs = f'source="{source}" query="{query}"'
    if session_id:
        attrs += f' session_id="{session_id}"'
    if query_id:
        attrs += f' query_id="{query_id}"'
    
    lines = [f'<recall {attrs}>']
    for item in items:
        score = item.get("score_display", item.get("score", ""))
        if isinstance(score, float):
            score = f"{score:.2f}"
        
        cues = item.get("cues", [])
        if cues:
            cue_text = " · ".join(str(c) for c in cues[:3])
            lines.append(f"{score} | {item.get('uri', '')} | {cue_text}")
        else:
            lines.append(f"{score} | {item.get('uri', '')}")
    
    lines.append("</recall>")
    return "\n".join(lines)


def _register_tools(ctx: Any, client: LoreClient) -> None:
    """Register all Lore tools with Hermes"""
    from . import formatters
    
    # ---- Status & Boot ----
    
    def lore_status() -> str:
        """Check Lore server health"""
        try:
            data = client.health()
            return f"Lore online\n\nBase URL: {client.base_url}\nHealth: {data}"
        except LoreError as e:
            return f"Lore offline: {e}"
    
    ctx.register_tool(
        name="lore_status",
        toolset="lore",
        schema={
            "name": "lore_status",
            "description": "Check Lore memory backend availability and connection health",
            "parameters":                 {
                                "type": "object",
                                "properties": {},
                                "required": []
                }
        },
        handler=lambda args, **kw: lore_status(),
        description="Check Lore memory backend availability and connection health",
        emoji="🧠"
    )
    
    def lore_boot() -> str:
        """Load boot memory view"""
        try:
            data = client.boot()
            return formatters.format_boot_view(data)
        except LoreError as e:
            return f"Lore boot failed: {e}"
    
    ctx.register_tool(
        name="lore_boot",
        toolset="lore",
        schema={
            "name": "lore_boot",
            "description": "Load the boot memory view that restores long-term identity and core operating context",
            "parameters":                 {
                                "type": "object",
                                "properties": {},
                                "required": []
                }
        },
        handler=lambda args, **kw: lore_boot(),
        description="Load the boot memory view that restores long-term identity and core operating context",
        emoji="🧠"
    )
    
    # ---- Node Operations ----
    
    def lore_get_node(uri: str, nav_only: bool = False, session_id: Optional[str] = None, query_id: Optional[str] = None) -> str:
        """Get a memory node by URI"""
        try:
            domain, path = client.parse_uri(uri)
            data = client.get_node(domain, path, nav_only)
            
            node = data.get("node", {})
            if session_id and node.get("uri"):
                try:
                    client.mark_session_read(
                        session_id=session_id,
                        uri=node["uri"],
                        node_uuid=node.get("node_uuid"),
                        source="tool:lore_get_node"
                    )
                except Exception:
                    pass  # best effort
            
            if query_id and node.get("uri"):
                try:
                    client.mark_recall_used(
                        query_id=query_id,
                        session_id=session_id or "hermes-embedded",
                        node_uris=[node["uri"]],
                        source="tool:lore_get_node",
                        success=True
                    )
                except Exception:
                    pass
            
            return formatters.format_node(data)
        except LoreError as e:
            return f"Error: {e}"
    
    ctx.register_tool(
        name="lore_get_node",
        toolset="lore",
        schema={
            "name": "lore_get_node",
            "description": "Read a memory node by its URI",
            "parameters":                 {
                                "type": "object",
                                "properties": {
                                                "uri": {
                                                                "type": "string",
                                                                "description": "Memory URI (e.g., 'core://identity', 'project://myapp/arch')"
                                                },
                                                "nav_only": {
                                                                "type": "boolean",
                                                                "description": "If true, return only navigation info without full content"
                                                },
                                                "session_id": {
                                                                "type": "string",
                                                                "description": "Optional session ID for read tracking"
                                                },
                                                "query_id": {
                                                                "type": "string",
                                                                "description": "Query ID from the <recall> tag for recall usage tracking"
                                                }
                                },
                                "required": [
                                                "uri"
                                ]
                }
        },
        handler=lambda args, **kw: lore_get_node(args.get("uri"), args.get("nav_only", False), args.get("session_id"), args.get("query_id")),
        description="Read a memory node by its URI",
        emoji="🧠"
    )
    
    def lore_create_node(
        content: str,
        priority: int = 2,
        title: Optional[str] = None,
        domain: str = "core",
        parent_path: str = "",
        disclosure: Optional[str] = None,
        uri: Optional[str] = None,
        glossary: Optional[List[str]] = None
    ) -> str:
        """Create a new memory node"""
        try:
            if uri:
                parsed_domain, parsed_path = client.parse_uri(uri)
                if domain != "core" and parsed_domain != domain:
                    raise LoreError(f"URI domain ({parsed_domain}) conflicts with explicit domain ({domain})")
                # Derive parent_path and title from parsed_path
                parts = parsed_path.split("/")
                if parts:
                    derived_title = parts[-1]
                    derived_parent_path = "/".join(parts[:-1]) if len(parts) > 1 else ""
                else:
                    derived_title = ""
                    derived_parent_path = ""
                if title and title.strip() and title.strip() != derived_title:
                    raise LoreError(f"URI tail ({derived_title}) conflicts with explicit title ({title})")
                effective_domain = parsed_domain
                effective_parent_path = derived_parent_path
                effective_title = derived_title
            else:
                effective_domain = domain
                effective_parent_path = parent_path
                effective_title = title
            
            data = client.create_node(
                domain=effective_domain,
                parent_path=effective_parent_path,
                title=effective_title,
                content=content,
                priority=priority,
                disclosure=disclosure,
                glossary=glossary
            )
            node = data.get("node", {})
            return f"Created: {node.get('uri', '')}\n\n{node.get('content', '')[:500]}"
        except LoreError as e:
            return f"Error: {e}"
    
    ctx.register_tool(
        name="lore_create_node",
        toolset="lore",
        schema={
            "name": "lore_create_node",
            "description": "Create a new memory node",
            "parameters":                 {
                                "type": "object",
                                "properties": {
                                                "content": {
                                                                "type": "string",
                                                                "description": "Memory content"
                                                },
                                                "priority": {
                                                                "type": "integer",
                                                                "description": "Priority level (0=core, 1=important, 2+=normal)"
                                                },
                                                "title": {
                                                                "type": "string",
                                                                "description": "Node title (optional)"
                                                },
                                                "domain": {
                                                                "type": "string",
                                                                "description": "Memory domain"
                                                },
                                                "parent_path": {
                                                                "type": "string",
                                                                "description": "Parent path within domain"
                                                },
                                                "disclosure": {
                                                                "type": "string",
                                                                "description": "When to disclose this memory"
                                                },
                                                "uri": {
                                                                "type": "string",
                                                                "description": "Optional final memory URI, e.g. project://myapp/arch"
                                                },
                                                "glossary": {
                                                                "type": "array",
                                                                "items": {"type": "string"},
                                                                "description": "Glossary keywords for better recall"
                                                }
                                },
                                "required": [
                                                "content"
                                ]
                }
        },
        handler=lambda args, **kw: lore_create_node(
            args.get("content"),
            args.get("priority", 2),
            args.get("title"),
            args.get("domain", "core"),
            args.get("parent_path", ""),
            args.get("disclosure"),
            args.get("uri"),
            args.get("glossary")
        ),
        description="Create a new memory node",
        emoji="🧠"
    )
    
    def lore_update_node(
        uri: str,
        content: Optional[str] = None,
        priority: Optional[int] = None,
        disclosure: Optional[str] = None,
        session_id: Optional[str] = None,
        glossary_add: Optional[List[str]] = None,
        glossary_remove: Optional[List[str]] = None
    ) -> str:
        """Update an existing memory node"""
        try:
            domain, path = client.parse_uri(uri)
            data = client.update_node(
                domain=domain,
                path=path,
                content=content,
                priority=priority,
                disclosure=disclosure,
                session_id=session_id,
                glossary_add=glossary_add,
                glossary_remove=glossary_remove
            )
            node = data.get("node", {})
            return f"Updated: {node.get('uri', '')}"
        except LoreError as e:
            return f"Error: {e}"
    
    ctx.register_tool(
        name="lore_update_node",
        toolset="lore",
        schema={
            "name": "lore_update_node",
            "description": "Update an existing memory node",
            "parameters":                 {
                                "type": "object",
                                "properties": {
                                                "uri": {
                                                                "type": "string",
                                                                "description": "Memory URI to update"
                                                },
                                                "content": {
                                                                "type": "string",
                                                                "description": "New content (optional)"
                                                },
                                                "priority": {
                                                                "type": "integer",
                                                                "description": "New priority (optional)"
                                                },
                                                "disclosure": {
                                                                "type": "string",
                                                                "description": "New disclosure (optional)"
                                                },
                                                "session_id": {
                                                                "type": "string",
                                                                "description": "Session ID for policy validation"
                                                },
                                                "glossary_add": {
                                                                "type": "array",
                                                                "items": {"type": "string"},
                                                                "description": "Glossary keywords to add"
                                                },
                                                "glossary_remove": {
                                                                "type": "array",
                                                                "items": {"type": "string"},
                                                                "description": "Glossary keywords to remove"
                                                }
                                },
                                "required": [
                                                "uri"
                                ]
                }
        },
        handler=lambda args, **kw: lore_update_node(
            args.get("uri"),
            args.get("content"),
            args.get("priority"),
            args.get("disclosure"),
            args.get("session_id"),
            args.get("glossary_add"),
            args.get("glossary_remove")
        ),
        description="Update an existing memory node",
        emoji="🧠"
    )
    
    def lore_delete_node(uri: str, session_id: Optional[str] = None) -> str:
        """Delete a memory node"""
        try:
            domain, path = client.parse_uri(uri)
            client.delete_node(domain, path, session_id=session_id)
            return f"Deleted: {uri}"
        except LoreError as e:
            return f"Error: {e}"
    
    ctx.register_tool(
        name="lore_delete_node",
        toolset="lore",
        schema={
            "name": "lore_delete_node",
            "description": "Delete a memory node",
            "parameters":                 {
                                "type": "object",
                                "properties": {
                                                "uri": {
                                                                "type": "string",
                                                                "description": "Memory URI to delete"
                                                },
                                                "session_id": {
                                                                "type": "string",
                                                                "description": "Session ID for policy validation"
                                                }
                                },
                                "required": [
                                                "uri"
                                ]
                }
        },
        handler=lambda args, **kw: lore_delete_node(args.get("uri"), args.get("session_id")),
        description="Delete a memory node",
        emoji="🧠"
    )
    
    def lore_move_node(old_uri: str, new_uri: str) -> str:
        """Move/rename a memory node"""
        try:
            client.move_node(old_uri, new_uri)
            return f"Moved: {old_uri} → {new_uri}"
        except LoreError as e:
            return f"Error: {e}"
    
    ctx.register_tool(
        name="lore_move_node",
        toolset="lore",
        schema={
            "name": "lore_move_node",
            "description": "Move or rename a memory node",
            "parameters":                 {
                                "type": "object",
                                "properties": {
                                                "old_uri": {
                                                                "type": "string",
                                                                "description": "Source URI"
                                                },
                                                "new_uri": {
                                                                "type": "string",
                                                                "description": "Destination URI"
                                                }
                                },
                                "required": [
                                                "old_uri",
                                                "new_uri"
                                ]
                }
        },
        handler=lambda args, **kw: lore_move_node(args.get("old_uri"), args.get("new_uri")),
        description="Move or rename a memory node",
        emoji="🧠"
    )
    
    # ---- Search & Recall ----
    
    def lore_search(query: str, domain: Optional[str] = None, limit: int = 10) -> str:
        """Search memories by keyword"""
        try:
            data = client.search(query, domain, limit)
            return formatters.format_search_results(data.get("results", []), data.get("meta"))
        except LoreError as e:
            return f"Error: {e}"
    
    ctx.register_tool(
        name="lore_search",
        toolset="lore",
        schema={
            "name": "lore_search",
            "description": "Search memories using keyword search",
            "parameters":                 {
                                "type": "object",
                                "properties": {
                                                "query": {
                                                                "type": "string",
                                                                "description": "Search query"
                                                },
                                                "domain": {
                                                                "type": "string",
                                                                "description": "Optional domain filter"
                                                },
                                                "limit": {
                                                                "type": "integer",
                                                                "description": "Max results"
                                                }
                                },
                                "required": [
                                                "query"
                                ]
                }
        },
        handler=lambda args, **kw: lore_search(args.get("query"), args.get("domain"), args.get("limit", 10)),
        description="Search memories using keyword search",
        emoji="🧠"
    )
    
    def lore_list_domains() -> str:
        """List all memory domains"""
        try:
            data = client.list_domains()
            return formatters.format_domains(data)
        except LoreError as e:
            return f"Error: {e}"
    
    ctx.register_tool(
        name="lore_list_domains",
        toolset="lore",
        schema={
            "name": "lore_list_domains",
            "description": "List all available memory domains",
            "parameters":                 {
                                "type": "object",
                                "properties": {},
                                "required": []
                }
        },
        handler=lambda args, **kw: lore_list_domains(),
        description="List all available memory domains",
        emoji="🧠"
    )
    
    # ---- Session Tracking ----
    
    def lore_list_session_reads(session_id: str) -> str:
        """List nodes read in this session"""
        try:
            data = client.list_session_reads(session_id)
            return formatters.format_session_reads(data)
        except LoreError as e:
            return f"Error: {e}"
    
    ctx.register_tool(
        name="lore_list_session_reads",
        toolset="lore",
        schema={
            "name": "lore_list_session_reads",
            "description": "Show which memory nodes have been read in this session",
            "parameters":                 {
                                "type": "object",
                                "properties": {
                                                "session_id": {
                                                                "type": "string",
                                                                "description": "Session ID"
                                                }
                                },
                                "required": [
                                                "session_id"
                                ]
                }
        },
        handler=lambda args, **kw: lore_list_session_reads(args.get("session_id")),
        description="Show which memory nodes have been read in this session",
        emoji="🧠"
    )
    
    def lore_clear_session_reads(session_id: str) -> str:
        """Clear session read tracking"""
        try:
            client.clear_session_reads(session_id)
            return f"Cleared read tracking for session: {session_id}"
        except LoreError as e:
            return f"Error: {e}"
    
    ctx.register_tool(
        name="lore_clear_session_reads",
        toolset="lore",
        schema={
            "name": "lore_clear_session_reads",
            "description": "Clear the session read tracking list",
            "parameters":                 {
                                "type": "object",
                                "properties": {
                                                "session_id": {
                                                                "type": "string",
                                                                "description": "Session ID"
                                                }
                                },
                                "required": [
                                                "session_id"
                                ]
                }
        },
        handler=lambda args, **kw: lore_clear_session_reads(args.get("session_id")),
        description="Clear the session read tracking list",
        emoji="🧠"
    )


def _register_hooks(ctx: Any, client: LoreClient) -> None:
    """Register lifecycle hooks for context injection"""
    global _boot_cache
    
    # Hook: pre_llm_call - inject boot context and recall
    def on_pre_llm_call(conversation_history: List[Dict], **kwargs) -> Optional[Dict]:
        """Inject Lore context before LLM call."""
        global _boot_cache, _client, _guidance_text
        if not conversation_history:
            return None
        
        # Find the last user message
        last_user_msg = None
        for msg in reversed(conversation_history):
            if msg.get("role") == "user":
                last_user_msg = msg
                break
        
        if not last_user_msg:
            return None
        
        # Get user content
        user_content = last_user_msg.get("content", "")
        if isinstance(user_content, list):
            # Handle content blocks
            texts = []
            for block in user_content:
                if isinstance(block, dict) and block.get("type") == "text":
                    texts.append(block.get("text", ""))
            user_content = "\n".join(texts)
        
        if not user_content or not user_content.strip():
            return None
        
        result_parts = []
        
        # 1. Inject boot content (once per process)
        if _boot_cache is None:
            try:
                boot_data = client.boot()
                boot_text = _format_boot_section(boot_data)
                if boot_text:
                    guidance = _get_guidance()
                    _boot_cache = f"{guidance}\n\n{boot_text}"
                else:
                    _boot_cache = _get_guidance()
            except Exception as e:
                logger.warning(f"Lore boot failed: {e}")
                _boot_cache = _get_guidance()
        
        # 2. Perform recall based on user message (place before boot so it's prominent)
        try:
            session_id = kwargs.get("session_id")
            recall_data = client.recall(user_content.strip()[:500], session_id=session_id)  # Limit query length
            items = recall_data.get("items", [])
            if items:
                recall_block = formatters.format_recall_block(
                    items,
                    session_id=session_id,
                    query_id=recall_data.get("event_log", {}).get("query_id")
                )
                if recall_block:
                    result_parts.append("以下记忆节点与当前查询相关,建议提前读取。\n\n" + recall_block)
        except Exception as e:
            logger.debug(f"Lore recall failed: {e}")
        
        # 3. Append boot cache after recall so recall stays prominent
        if _boot_cache:
            result_parts.append(_boot_cache)
        
        if result_parts:
            return {"context": "\n\n".join(result_parts)}
        
        return None
    
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    
    # Hook: on_session_end - cleanup
    def on_session_end(session_id: str, **kwargs) -> None:
        """Clear session tracking on session end"""
        try:
            client.clear_session_reads(session_id)
        except Exception:
            pass
    
    ctx.register_hook("on_session_end", on_session_end)


def register(ctx: Any) -> None:
    """
    Hermes native plugin entry point.
    
    This function is called by Hermes when loading the plugin.
    It registers all tools and hooks.
    
    Args:
        ctx: PluginContext provided by Hermes
    """
    global _client
    
    # Initialize Lore client
    base_url = os.environ.get("LORE_BASE_URL", "http://127.0.0.1:18901")
    api_token = os.environ.get("LORE_API_TOKEN", "")
    default_domain = os.environ.get("LORE_DEFAULT_DOMAIN", "core")
    
    _client = LoreClient(
        base_url=base_url,
        api_token=api_token,
        default_domain=default_domain
    )
    
    # Register tools
    _register_tools(ctx, _client)
    
    # Register hooks for context injection
    _register_hooks(ctx, _client)
    
    logger.info(f"Lore plugin registered (server: {base_url})")
