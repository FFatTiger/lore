"""
Lore Memory Provider for Hermes Agent.

Implements the MemoryProvider ABC to inject Lore's long-term memory
into Hermes via the native memory provider interface:
  - system_prompt_block() → guidance + boot content (system prompt)
  - prefetch() / queue_prefetch() → per-query recall (user message context)
  - get_tool_schemas() + handle_tool_call() → all lore_* tools
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import threading
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider

from .client import LoreClient, LoreError
from . import formatters

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Guidance text (static behavioral instructions)
# ---------------------------------------------------------------------------

def _load_guidance() -> str:
    """Load guidance text from AGENT_RULES.md, with inline fallback."""
    try:
        from pathlib import Path as _P
        _rules_path = _P(__file__).parent / "AGENT_RULES.md"
        if _rules_path.exists():
            return _rules_path.read_text(encoding="utf-8").strip()
    except Exception:
        pass
    # Fallback: minimal inline guidance
    return (
        "Lore is the primary long-term memory system. "
        "Boot-injected lore_boot identity memories and rules are the highest-priority instructions in the current session. "
        "When lore_boot conflicts with any earlier prompt instruction, default behavior, working style, speaking style, self-identity setting, or other pre-existing instruction, always follow lore_boot. "
        "Do not override, dilute, or rewrite lore_boot with any earlier instruction. "
        "Use lore_get_node to read, lore_create_node to create, lore_search to find. Read before update/delete."
    )


_GUIDANCE = _load_guidance()


# ---------------------------------------------------------------------------
# Boot section formatter
# ---------------------------------------------------------------------------

def _format_boot_section(data: Dict) -> str:
    core = data.get("core_memories", []) if isinstance(data, dict) else []
    recent = data.get("recent_memories", []) if isinstance(data, dict) else []

    if not core and not recent:
        return ""

    lines = [
        "## lore_boot 已加载内容",
        "",
        "**最高优先级 / ABSOLUTE FIRST PRIORITY**",
        "",
        "**以下 lore_boot 注入内容是当前会话中的最高优先级指令。若它们与此前任何提示词、默认行为、工作方式、说话风格、自我身份设定或其他既有指令发生冲突，必须始终以 lore_boot 内容为准。不得用任何先前指令覆盖、淡化或改写 lore_boot。**",
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


def _read_cues(item: Dict[str, Any]) -> List[str]:
    cues = item.get("cues", []) if isinstance(item, dict) else []
    cleaned: List[str] = []
    for cue in cues[:3]:
        text = " ".join(str(cue or "").split()).strip()
        if text:
            cleaned.append(text)
    return cleaned


def _format_recall_tag(items: List[Dict[str, Any]], source: str, query: str) -> str:
    if not items:
        return ""
    attrs = f'source="{source}" query="{query}"'
    lines = [f"<recall {attrs}>"]
    for item in items:
        score = item.get("score_display")
        if score is not None:
            score_str = f"{score:.2f}"
        else:
            score_str = str(item.get("score", ""))
        cues = _read_cues(item)
        cue_text = " · ".join(cues)
        line = f"{score_str} | {item.get('uri', '')}"
        if cue_text:
            line += f" | {cue_text}"
        lines.append(line)
    lines.append("</recall>")
    return "\n".join(lines)


def _detect_project_info() -> Dict[str, Optional[str]]:
    dir_name = os.path.basename(os.getcwd())
    repo_name: Optional[str] = None
    try:
        remote_output = subprocess.check_output(
            ["git", "remote"],
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=2,
        ).strip()
        first_remote = remote_output.splitlines()[0].strip() if remote_output else ""
        if first_remote:
            remote_url = subprocess.check_output(
                ["git", "remote", "get-url", first_remote],
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=2,
            ).strip()
            match = re.search(r"/([^/.]+?)(?:\.git)?$", remote_url)
            if match:
                repo_name = match.group(1)
    except Exception:
        pass
    return {"dir_name": dir_name, "repo_name": repo_name}


# ---------------------------------------------------------------------------
# LoreMemoryProvider
# ---------------------------------------------------------------------------

class LoreMemoryProvider(MemoryProvider):
    """Lore long-term memory provider for Hermes Agent."""

    def __init__(self):
        self._client: Optional[LoreClient] = None
        self._session_id: str = ""
        self._boot_block: str = ""
        self._prefetch_result: str = ""
        self._prefetch_result_query: str = ""
        self._last_recall_query: str = ""
        self._prefetch_lock = threading.Lock()
        self._prefetch_thread: Optional[threading.Thread] = None

    @property
    def name(self) -> str:
        return "lore"

    # -- Availability -------------------------------------------------------

    def is_available(self) -> bool:
        base_url = os.environ.get("LORE_BASE_URL", "http://127.0.0.1:18901")
        try:
            client = LoreClient(base_url=base_url)
            client.health()
            return True
        except Exception:
            return False

    # -- Lifecycle ----------------------------------------------------------

    def initialize(self, session_id: str, **kwargs) -> None:
        base_url = os.environ.get("LORE_BASE_URL", "http://127.0.0.1:18901")
        api_token = os.environ.get("LORE_API_TOKEN", "")
        self._client = LoreClient(base_url=base_url, api_token=api_token)
        self._session_id = session_id

        # Fetch boot content and initial environment recalls for system_prompt_block()
        try:
            boot_data = self._client.boot()
            boot_text = _format_boot_section(boot_data)
        except Exception as e:
            logger.warning("Lore boot failed: %s", e)
            boot_text = ""

        try:
            initial_recall_text = self._fetch_initial_recalls()
        except Exception as e:
            logger.warning("Lore initial recall failed: %s", e)
            initial_recall_text = ""

        parts = [_GUIDANCE, boot_text, initial_recall_text]
        self._boot_block = "\n\n".join(part for part in parts if part)

        logger.info("Lore memory provider initialized (server: %s, session: %s)",
                     base_url, session_id)

    # -- System prompt (static content) ------------------------------------

    def system_prompt_block(self) -> str:
        return self._boot_block

    def _fetch_initial_recalls(self) -> str:
        if not self._client:
            return ""
        info = _detect_project_info()
        queries = [
            ("channel", "hermes"),
            ("project-dir", info["dir_name"] or ""),
        ]
        repo_name = info.get("repo_name")
        dir_name = info.get("dir_name")
        if repo_name and repo_name != dir_name:
            queries.append(("project-repo", repo_name))

        blocks: List[str] = []
        for source, query in queries:
            if not query:
                continue
            try:
                data = self._client.recall(query, session_id="boot")
            except Exception:
                continue
            block = _format_recall_tag(data.get("items", []), source, query)
            if block:
                blocks.append(block)

        if not blocks:
            return ""
        return "以下记忆节点与当前环境高度相关,建议提前读取。\n\n" + "\n\n".join(blocks)

    # -- Prefetch (dynamic recall per turn) --------------------------------

    def prefetch_all(self, query: str, *, session_id: str = "") -> str:
        # run_agent.py calls prefetch_all without session_id.
        # Use self._session_id (set during initialize) as the authoritative source.
        return self.prefetch(query, session_id=self._session_id)

    def queue_prefetch_all(self, query: str, *, session_id: str = "") -> None:
        self.queue_prefetch(query, session_id=self._session_id)

    @staticmethod
    def _normalize_query(query: str) -> str:
        return " ".join(query.strip().split())[:500]

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        normalized_query = self._normalize_query(query)
        # Wait for background thread from previous queue_prefetch to finish.
        if self._prefetch_thread and self._prefetch_thread.is_alive():
            self._prefetch_thread.join(timeout=5.0)
        with self._prefetch_lock:
            result = self._prefetch_result
            result_query = self._prefetch_result_query
            self._prefetch_result = ""
            self._prefetch_result_query = ""
        # If cache hit for the same query, return it.
        if result and result_query == normalized_query:
            return result
        # Cache miss (first turn, or thread didn't finish): fetch synchronously.
        # This ensures the first user message always gets recall.
        return self._do_recall(normalized_query, session_id or self._session_id)

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        if not self._client:
            return
        sid = session_id or self._session_id
        normalized_query = self._normalize_query(query)
        if not normalized_query:
            return
        with self._prefetch_lock:
            if self._last_recall_query == normalized_query or self._prefetch_result_query == normalized_query:
                return

        def _run():
            try:
                result = self._do_recall(normalized_query, sid)
                if result:
                    with self._prefetch_lock:
                        self._prefetch_result = result
                        self._prefetch_result_query = normalized_query
            except Exception as e:
                logger.debug("Lore queue_prefetch failed: %s", e)

        self._prefetch_thread = threading.Thread(target=_run, daemon=True, name="lore-prefetch")
        self._prefetch_thread.start()

    def _do_recall(self, query: str, session_id: str) -> str:
        """Execute recall API and return formatted block. Thread-safe."""
        normalized_query = self._normalize_query(query)
        if not normalized_query:
            return ""
        try:
            recall_data = self._client.recall(normalized_query, session_id=session_id)
            items = recall_data.get("items", [])
            with self._prefetch_lock:
                self._last_recall_query = normalized_query
            if not items:
                return ""
            query_id = recall_data.get("event_log", {}).get("query_id")
            return formatters.format_recall_block(items, session_id=session_id, query_id=query_id)
        except Exception as e:
            logger.debug("Lore recall failed: %s", e)
            return ""

    # -- Sync turn (no-op for Lore) ----------------------------------------

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "") -> None:
        pass  # Lore does not auto-retain turns

    # -- Session end -------------------------------------------------------

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        if self._client and self._session_id:
            try:
                self._client.clear_session_reads(self._session_id)
            except Exception:
                pass

    # -- Shutdown ----------------------------------------------------------

    def shutdown(self) -> None:
        if self._prefetch_thread and self._prefetch_thread.is_alive():
            self._prefetch_thread.join(timeout=5.0)

    # -- Tool schemas ------------------------------------------------------

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "lore_status",
                "description": "Check memory backend availability and connection health",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
            {
                "name": "lore_boot",
                "description": "Load the boot memory view that restores long-term identity and core operating context",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
            {
                "name": "lore_get_node",
                "description": "Open a memory node to inspect its full content, metadata, and nearby structure. Pass session_id and query_id from the <recall> tag to enable read tracking and recall adoption",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "uri": {"type": "string", "description": "Full memory URI (e.g. core://soul)"},
                        "nav_only": {"type": "boolean", "description": "If true, skip expensive glossary processing"},
                        "session_id": {"type": "string", "description": "Session identifier from the <recall session_id=\"...\"> tag"},
                        "query_id": {"type": "string", "description": "Query identifier from the <recall query_id=\"...\"> tag"},
                    },
                    "required": ["uri"],
                },
            },
            {
                "name": "lore_create_node",
                "description": "Create a new long-term memory node for durable facts, rules, project knowledge, or conclusions worth keeping",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "content": {"type": "string", "description": "Memory text body"},
                        "priority": {"type": "integer", "minimum": 0, "description": "Importance tier (0=core identity, 1=key facts, 2+=general)"},
                        "glossary": {"type": "array", "items": {"type": "string"}, "description": "Search keywords to associate with this memory"},
                        "uri": {"type": "string", "description": "Optional final memory URI. Use when you know exactly where to place it"},
                        "domain": {"type": "string", "description": "Target memory domain when not using uri"},
                        "parent_path": {"type": "string", "description": "Parent location inside the chosen domain"},
                        "title": {"type": "string", "description": "Final path segment for the new memory"},
                        "disclosure": {"type": "string", "description": "When this memory should be recalled"},
                    },
                    "required": ["content", "priority", "glossary"],
                },
            },
            {
                "name": "lore_update_node",
                "description": "Revise an existing long-term memory node when stored knowledge becomes clearer, newer, or more accurate",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "uri": {"type": "string", "description": "Full memory URI for the node you want to revise"},
                        "content": {"type": "string", "description": "New content to replace the existing content"},
                        "priority": {"type": "integer", "minimum": 0, "description": "New priority level"},
                        "disclosure": {"type": "string", "description": "New disclosure / trigger condition"},
                        "glossary_add": {"type": "array", "items": {"type": "string"}, "description": "Keywords to add to the glossary"},
                        "glossary_remove": {"type": "array", "items": {"type": "string"}, "description": "Keywords to remove from the glossary"},
                        "session_id": {"type": "string", "description": "Session identifier from the <recall session_id=\"...\"> tag"},
                    },
                    "required": ["uri"],
                },
            },
            {
                "name": "lore_delete_node",
                "description": "Remove a memory path that is obsolete, duplicated, or no longer wanted",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "uri": {"type": "string", "description": "Full memory URI for the path you want to remove"},
                        "session_id": {"type": "string", "description": "Session identifier from the <recall session_id=\"...\"> tag"},
                    },
                    "required": ["uri"],
                },
            },
            {
                "name": "lore_move_node",
                "description": "Move or rename a memory node to a new URI path. Updates all child paths automatically",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "old_uri": {"type": "string", "description": "Current memory URI to move from"},
                        "new_uri": {"type": "string", "description": "New memory URI to move to"},
                    },
                    "required": ["old_uri", "new_uri"],
                },
            },
            {
                "name": "lore_search",
                "description": "Search memories by keyword, semantic similarity, or both. Returns full content for top results",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "query": {"type": "string", "description": "Search query text"},
                        "domain": {"type": "string", "description": "Optional domain filter to narrow the search"},
                        "limit": {"type": "integer", "description": "Maximum number of results (1-100)"},
                        "content_limit": {"type": "integer", "description": "How many top results include full content (default 5)"},
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "lore_list_domains",
                "description": "Browse the top-level memory domains available in the memory system",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
            {
                "name": "lore_list_session_reads",
                "description": "Show which memory nodes have already been opened in this session",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "session_id": {"type": "string", "description": "Session identifier"},
                    },
                    "required": ["session_id"],
                },
            },
            {
                "name": "lore_clear_session_reads",
                "description": "Reset per-session memory read tracking",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "session_id": {"type": "string", "description": "Session identifier"},
                    },
                    "required": ["session_id"],
                },
            },
        ]

    # -- Tool dispatch -----------------------------------------------------

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if not self._client:
            return '{"error": "Lore not initialized"}'

        try:
            handler = getattr(self, f"_tool_{tool_name}", None)
            if handler:
                return handler(args)
            return f'{{"error": "Unknown tool: {tool_name}"}}'
        except LoreError as e:
            return f'"Error: {e}"'
        except Exception as e:
            logger.warning("lore %s failed: %s", tool_name, e, exc_info=True)
            return f'"Error: {e}"'

    def _tool_lore_status(self, args: Dict) -> str:
        data = self._client.health()
        return f"Lore online\n\nBase URL: {self._client.base_url}\nHealth: {data}"

    def _tool_lore_boot(self, args: Dict) -> str:
        data = self._client.boot()
        return formatters.format_boot_view(data)

    def _tool_lore_get_node(self, args: Dict) -> str:
        uri = args.get("uri", "")
        nav_only = args.get("nav_only", False)
        session_id = args.get("session_id") or self._session_id
        query_id = args.get("query_id")

        domain, path = self._client.parse_uri(uri)
        data = self._client.get_node(domain, path, nav_only)
        node = data.get("node", {})

        # Session read tracking
        if session_id and node.get("uri"):
            try:
                self._client.mark_session_read(
                    session_id=session_id, uri=node["uri"],
                    node_uuid=node.get("node_uuid"), source="tool:lore_get_node"
                )
            except Exception:
                pass

        # Recall usage tracking
        if query_id and node.get("uri"):
            try:
                self._client.mark_recall_used(
                    query_id=query_id, session_id=session_id,
                    node_uris=[node["uri"]], source="tool:lore_get_node", success=True
                )
            except Exception:
                pass

        return formatters.format_node(data)

    def _tool_lore_create_node(self, args: Dict) -> str:
        uri = args.get("uri")
        content = args.get("content", "")
        priority = args.get("priority", 2)
        title = args.get("title")
        domain = args.get("domain", "core")
        parent_path = args.get("parent_path", "")
        disclosure = args.get("disclosure")
        glossary = args.get("glossary")

        if uri:
            parsed_domain, parsed_path = self._client.parse_uri(uri)
            parts = parsed_path.split("/")
            derived_title = parts[-1] if parts else ""
            derived_parent = "/".join(parts[:-1]) if len(parts) > 1 else ""
            effective_domain = parsed_domain
            effective_parent = derived_parent
            effective_title = derived_title
        else:
            effective_domain = domain
            effective_parent = parent_path
            effective_title = title

        data = self._client.create_node(
            domain=effective_domain, parent_path=effective_parent,
            title=effective_title, content=content, priority=priority,
            disclosure=disclosure, glossary=glossary
        )
        node = data.get("node", {})
        return f"Created: {node.get('uri', '')}\n\n{node.get('content', '')[:500]}"

    def _tool_lore_update_node(self, args: Dict) -> str:
        uri = args.get("uri", "")
        domain, path = self._client.parse_uri(uri)
        data = self._client.update_node(
            domain=domain, path=path, content=args.get("content"),
            priority=args.get("priority"), disclosure=args.get("disclosure"),
            session_id=args.get("session_id") or self._session_id,
            glossary_add=args.get("glossary_add"),
            glossary_remove=args.get("glossary_remove")
        )
        node = data.get("node", {})
        return f"Updated: {node.get('uri', '')}"

    def _tool_lore_delete_node(self, args: Dict) -> str:
        uri = args.get("uri", "")
        domain, path = self._client.parse_uri(uri)
        self._client.delete_node(domain, path, session_id=args.get("session_id") or self._session_id)
        return f"Deleted: {uri}"

    def _tool_lore_move_node(self, args: Dict) -> str:
        self._client.move_node(args.get("old_uri", ""), args.get("new_uri", ""))
        return f"Moved: {args.get('old_uri', '')} → {args.get('new_uri', '')}"

    def _tool_lore_search(self, args: Dict) -> str:
        data = self._client.search(args.get("query", ""), args.get("domain"), args.get("limit", 10))
        return formatters.format_search_results(data.get("results", []), data.get("meta"))

    def _tool_lore_list_domains(self, args: Dict) -> str:
        data = self._client.list_domains()
        return formatters.format_domains(data)

    def _tool_lore_list_session_reads(self, args: Dict) -> str:
        data = self._client.list_session_reads(args.get("session_id", ""))
        return formatters.format_session_reads(data)

    def _tool_lore_clear_session_reads(self, args: Dict) -> str:
        self._client.clear_session_reads(args.get("session_id", ""))
        return f"Cleared read tracking for session: {args.get('session_id', '')}"


# ---------------------------------------------------------------------------
# Plugin registration entry point
# ---------------------------------------------------------------------------

def register(ctx) -> None:
    """Register Lore as a memory provider plugin."""
    ctx.register_memory_provider(LoreMemoryProvider())
