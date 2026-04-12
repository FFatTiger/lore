"""
Tools - Hermes tool registration for Lore

This module provides tools that can be registered with Hermes Agent
to interact with the Lore memory system.
"""

from typing import Dict, List, Optional, Any, Callable
from .client import LoreClient, LoreError
from .formatters import (
    format_node,
    format_boot_view,
    format_search_results,
    format_domains,
    format_session_reads,
    format_recall_block
)


class ToolResult:
    """Tool execution result"""
    def __init__(self, text: str, ok: bool = True, **kwargs):
        self.text = text
        self.ok = ok
        self.details = kwargs
    
    def __str__(self) -> str:
        return self.text


def register_tools(register_fn: Callable[[str, str, Dict, Callable], None], client: Optional[LoreClient] = None):
    """
    Register all Lore tools with Hermes
    
    Args:
        register_fn: Function to register a tool (name, description, schema, handler)
        client: Optional LoreClient instance (creates default if not provided)
    """
    if client is None:
        client = LoreClient()
    
    # ---- Status & Boot ----
    
    def lore_status() -> ToolResult:
        """Check Lore server health"""
        try:
            data = client.health()
            return ToolResult(
                f"Lore online\n\n{str(data)}",
                ok=True,
                health=data,
                base_url=client.base_url
            )
        except LoreError as e:
            return ToolResult(
                f"Lore offline: {e}",
                ok=False,
                error=str(e),
                base_url=client.base_url
            )
    
    register_fn(
        "lore_status",
        "Check Lore memory backend availability and connection health",
        {},
        lore_status
    )
    
    def lore_boot() -> ToolResult:
        """Load boot memory view"""
        try:
            data = client.boot()
            content = format_boot_view(data)
            return ToolResult(content, ok=True, boot=data)
        except LoreError as e:
            return ToolResult(f"Lore boot failed: {e}", ok=False, error=str(e))
    
    register_fn(
        "lore_boot",
        "Load the boot memory view that restores long-term identity and core operating context",
        {},
        lore_boot
    )
    
    # ---- Node Operations ----
    
    def lore_get_node(uri: str, nav_only: bool = False, session_id: Optional[str] = None) -> ToolResult:
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
                except:
                    pass  # Best effort
            
            return ToolResult(format_node(data), ok=True, node=node, children=data.get("children", []))
        except LoreError as e:
            return ToolResult(f"Lore get node failed: {e}", ok=False, error=str(e))
    
    register_fn(
        "lore_get_node",
        "Open a memory node to inspect its full content, metadata, and nearby structure",
        {
            "uri": {"type": "string", "description": "Full memory URI (e.g., core://soul)"},
            "nav_only": {"type": "boolean", "description": "Skip expensive glossary processing"},
            "session_id": {"type": "string", "description": "Session ID for read tracking"}
        },
        lore_get_node
    )
    
    def lore_create_node(
        content: str,
        priority: int,
        glossary: List[str],
        uri: Optional[str] = None,
        domain: Optional[str] = None,
        parent_path: Optional[str] = None,
        title: Optional[str] = None,
        disclosure: Optional[str] = None
    ) -> ToolResult:
        """Create a new memory node"""
        try:
            # Determine target location
            if uri:
                target_domain, target_path = client.parse_uri(uri)
                parts = target_path.split("/")
                if not title and parts:
                    title = parts[-1]
                    parent_path = "/".join(parts[:-1]) if len(parts) > 1 else ""
                else:
                    parent_path = target_path
                domain = target_domain
            else:
                domain = domain or client.default_domain
                parent_path = parent_path or ""
            
            data = client.create_node(
                domain=domain,
                parent_path=parent_path,
                content=content,
                priority=priority,
                title=title,
                disclosure=disclosure
            )
            
            # Add glossary keywords
            node_uuid = data.get("node_uuid")
            added_glossary = []
            if node_uuid and glossary:
                for keyword in glossary:
                    try:
                        client.add_glossary(keyword, node_uuid)
                        added_glossary.append(keyword)
                    except:
                        pass
            
            suffix = f"\nGlossary: {', '.join(added_glossary)}" if added_glossary else ""
            return ToolResult(
                f"Created {data.get('uri', f'{domain}://{parent_path}')}{suffix}",
                ok=True,
                result=data,
                glossary=added_glossary
            )
        except LoreError as e:
            return ToolResult(f"Lore create failed: {e}", ok=False, error=str(e))
    
    register_fn(
        "lore_create_node",
        "Create a new long-term memory node for durable facts, rules, project knowledge",
        {
            "content": {"type": "string", "description": "Memory content"},
            "priority": {"type": "integer", "description": "Importance tier (0=core, 1=key, 2+=general)"},
            "glossary": {"type": "array", "items": {"type": "string"}, "description": "Keywords for search indexing"},
            "uri": {"type": "string", "description": "Full target URI (optional)"},
            "domain": {"type": "string", "description": "Target domain (if not using uri)"},
            "parent_path": {"type": "string", "description": "Parent path (if not using uri)"},
            "title": {"type": "string", "description": "Final path segment"},
            "disclosure": {"type": "string", "description": "When to recall this memory"}
        },
        lore_create_node
    )
    
    def lore_update_node(
        uri: str,
        content: Optional[str] = None,
        priority: Optional[int] = None,
        disclosure: Optional[str] = None,
        glossary_add: Optional[List[str]] = None,
        glossary_remove: Optional[List[str]] = None
    ) -> ToolResult:
        """Update an existing memory node"""
        try:
            domain, path = client.parse_uri(uri)
            
            # Update node
            data = client.update_node(
                domain=domain,
                path=path,
                content=content,
                priority=priority,
                disclosure=disclosure
            )
            
            # Handle glossary mutations
            added = []
            removed = []
            if glossary_add or glossary_remove:
                # Get node UUID
                node_data = client.get_node(domain, path)
                node_uuid = node_data.get("node", {}).get("node_uuid")
                
                if node_uuid:
                    for keyword in glossary_add or []:
                        try:
                            client.add_glossary(keyword, node_uuid)
                            added.append(keyword)
                        except:
                            pass
                    for keyword in glossary_remove or []:
                        try:
                            client.remove_glossary(keyword, node_uuid)
                            removed.append(keyword)
                        except:
                            pass
            
            parts = [f"Updated {domain}://{path}"]
            if added:
                parts.append(f"glossary+ {', '.join(added)}")
            if removed:
                parts.append(f"glossary- {', '.join(removed)}")
            
            return ToolResult("\n".join(parts), ok=True, result=data)
        except LoreError as e:
            return ToolResult(f"Lore update failed: {e}", ok=False, error=str(e))
    
    register_fn(
        "lore_update_node",
        "Revise an existing long-term memory node",
        {
            "uri": {"type": "string", "description": "Full memory URI"},
            "content": {"type": "string", "description": "New content"},
            "priority": {"type": "integer", "description": "New priority"},
            "disclosure": {"type": "string", "description": "New disclosure"},
            "glossary_add": {"type": "array", "items": {"type": "string"}},
            "glossary_remove": {"type": "array", "items": {"type": "string"}}
        },
        lore_update_node
    )
    
    def lore_delete_node(uri: str) -> ToolResult:
        """Delete a memory node"""
        try:
            domain, path = client.parse_uri(uri)
            data = client.delete_node(domain, path)
            return ToolResult(f"Deleted {domain}://{path}", ok=True, result=data)
        except LoreError as e:
            return ToolResult(f"Lore delete failed: {e}", ok=False, error=str(e))
    
    register_fn(
        "lore_delete_node",
        "Remove a memory path that is obsolete, duplicated, or no longer wanted",
        {"uri": {"type": "string", "description": "Full memory URI to delete"}},
        lore_delete_node
    )
    
    def lore_move_node(old_uri: str, new_uri: str) -> ToolResult:
        """Move/rename a memory node"""
        try:
            data = client.move_node(old_uri, new_uri)
            return ToolResult(f"Moved {old_uri} → {new_uri}", ok=True, result=data)
        except LoreError as e:
            return ToolResult(f"Lore move failed: {e}", ok=False, error=str(e))
    
    register_fn(
        "lore_move_node",
        "Move or rename a memory node to a new URI path",
        {
            "old_uri": {"type": "string", "description": "Current URI"},
            "new_uri": {"type": "string", "description": "New URI"}
        },
        lore_move_node
    )
    
    # ---- Search & Recall ----
    
    def lore_search(query: str, domain: Optional[str] = None, limit: int = 10) -> ToolResult:
        """Search memories by keyword"""
        try:
            data = client.search(query, domain=domain, limit=limit)
            results = data.get("results", [])
            meta = data.get("meta")
            text = format_search_results(results, meta)
            return ToolResult(text, ok=True, results=results, meta=meta)
        except LoreError as e:
            return ToolResult(f"Lore search failed: {e}", ok=False, error=str(e))
    
    register_fn(
        "lore_search",
        "Find relevant memories by keyword or domain",
        {
            "query": {"type": "string", "description": "Search query"},
            "domain": {"type": "string", "description": "Optional domain filter"},
            "limit": {"type": "integer", "description": "Max results (1-100)", "default": 10}
        },
        lore_search
    )
    
    def lore_recall(query: str, session_id: Optional[str] = None) -> ToolResult:
        """Recall relevant memories for a query"""
        try:
            data = client.recall(query, session_id=session_id)
            items = data.get("items", [])
            query_id = data.get("event_log", {}).get("query_id", "")
            block = format_recall_block(items, session_id, query_id)
            return ToolResult(block or "No relevant memories recalled.", ok=True, items=items, query_id=query_id)
        except LoreError as e:
            return ToolResult(f"Lore recall failed: {e}", ok=False, error=str(e))
    
    register_fn(
        "lore_recall",
        "Recall relevant memories before processing a user query",
        {
            "query": {"type": "string", "description": "Query to find relevant memories"},
            "session_id": {"type": "string", "description": "Session ID for tracking"}
        },
        lore_recall
    )
    
    # ---- Domains ----
    
    def lore_list_domains() -> ToolResult:
        """List all memory domains"""
        try:
            domains = client.list_domains()
            text = format_domains(domains)
            return ToolResult(text, ok=True, domains=domains)
        except LoreError as e:
            return ToolResult(f"Lore list domains failed: {e}", ok=False, error=str(e))
    
    register_fn(
        "lore_list_domains",
        "Browse the top-level memory domains available",
        {},
        lore_list_domains
    )
    
    # ---- Session Tracking ----
    
    def lore_list_session_reads(session_id: str) -> ToolResult:
        """List session read tracking"""
        try:
            reads = client.list_session_reads(session_id)
            text = format_session_reads(reads)
            return ToolResult(text, ok=True, reads=reads)
        except LoreError as e:
            return ToolResult(f"Lore session reads failed: {e}", ok=False, error=str(e))
    
    register_fn(
        "lore_list_session_reads",
        "Show which memory nodes have already been opened in this session",
        {"session_id": {"type": "string", "description": "Session ID"}},
        lore_list_session_reads
    )
    
    def lore_clear_session_reads(session_id: str) -> ToolResult:
        """Clear session read tracking"""
        try:
            data = client.clear_session_reads(session_id)
            return ToolResult(f"Cleared Lore read tracking for {session_id}", ok=True, result=data)
        except LoreError as e:
            return ToolResult(f"Lore clear session reads failed: {e}", ok=False, error=str(e))
    
    register_fn(
        "lore_clear_session_reads",
        "Reset per-session memory read tracking",
        {"session_id": {"type": "string", "description": "Session ID"}},
        lore_clear_session_reads
    )
