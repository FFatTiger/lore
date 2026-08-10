"""
Lore Memory Provider for Hermes Agent.

Implements the MemoryProvider ABC to inject Lore's long-term memory
into Hermes via the native memory provider interface:
  - system_prompt_block() → guidance + boot content (system prompt)
  - prefetch() / queue_prefetch() → per-query recall (user message context)
  - get_tool_schemas() + handle_tool_call() → all lore_* tools
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import threading
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider

from .client import LoreClient, LoreError
from . import formatters
from . import skill_workcopy

logger = logging.getLogger(__name__)
RECALL_GET_NODE_DESCRIPTION = "Open a memory node. REQUIRED when opening a URI from a <recall>: copy the exact session_id and query_id from that <recall> tag."
RECALL_SESSION_ID_DESCRIPTION = "REQUIRED when the URI came from <recall>: copy the exact session_id from that <recall> tag."
RECALL_QUERY_ID_DESCRIPTION = "REQUIRED when the URI came from <recall>: copy the exact query_id from that <recall> tag."

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


class _PrefetchFlight:
    """Single-flight recall operation shared by queue and foreground paths."""

    def __init__(self, *, key: str, session_id: str, generation: int, payload: str):
        self.key = key
        self.session_id = session_id
        self.generation = generation
        self.payload = payload
        self.done = threading.Event()
        self.result = ""
        self.thread: Optional[threading.Thread] = None


# ---------------------------------------------------------------------------
# LoreMemoryProvider
# ---------------------------------------------------------------------------

class LoreMemoryProvider(MemoryProvider):
    """Lore long-term memory provider for Hermes Agent."""

    _PREFETCH_WAIT_SECONDS = 5.0
    _SHUTDOWN_WAIT_SECONDS = 5.0

    def __init__(self):
        self._client: Optional[LoreClient] = None
        self._session_id: str = ""
        self._boot_block: str = ""
        self._prefetch_lock = threading.Lock()
        # Retained for compatibility with tests that inspect the latest thread.
        self._prefetch_thread: Optional[threading.Thread] = None
        self._prefetch_threads: set = set()
        self._generation = 0
        self._ready_key: Optional[str] = None
        self._ready_result: str = ""
        self._inflight: Dict[str, "_PrefetchFlight"] = {}
        # Skill session identity (catalog only; no auto-download).
        self._skill_project_id: str = ""
        self._skill_catalog_revision: str = ""
        self._skill_last_error: str = ""

    @property
    def name(self) -> str:
        return "lore"

    # -- Availability -------------------------------------------------------

    def is_available(self) -> bool:
        try:
            client = LoreClient()
            client.health()
            return True
        except Exception:
            return False

    # -- Lifecycle ----------------------------------------------------------

    def initialize(self, session_id: str, **kwargs) -> None:
        self._client = LoreClient()
        self._session_id = session_id
        resolved_base_url = getattr(self._client, "base_url", "http://127.0.0.1:18901")

        self._boot_block = ""
        try:
            lifecycle = self._client.lifecycle_event(
                "session.start",
                session_id=session_id,
                project=_detect_project_info(),
            )
            output = lifecycle.get("host_output", {}) or {}
            value = output.get("value", {}) if output.get("mode") == "return_value" else {}
            system_context = str((value or {}).get("system_context") or "").strip()
            if system_context:
                self._boot_block = system_context
            # Record project/catalog identity only — never auto-download skills.
            catalog = skill_workcopy.read_skill_catalog(lifecycle)
            if catalog and catalog.get("project_id"):
                self._skill_project_id = catalog["project_id"]
                self._skill_catalog_revision = catalog.get("catalog_revision") or ""
        except Exception as e:
            logger.debug("Lore lifecycle startup failed: %s", e)

        logger.info("Lore memory provider initialized (server: %s, session: %s)",
                     resolved_base_url, session_id)

    def on_session_switch(
        self,
        new_session_id: str,
        *,
        parent_session_id: str = "",
        reset: bool = False,
        rewound: bool = False,
        **kwargs,
    ) -> None:
        """Rebind provider session identity without re-running session.start."""
        with self._prefetch_lock:
            self._session_id = new_session_id or ""
            self._generation += 1
            self._ready_key = None
            self._ready_result = ""
            # Detach all joinable flights so a same-key request after rewind/reset
            # starts current-generation work instead of joining stale/wedged work.
            # Old threads may finish but cannot publish current ready cache.
            self._inflight.clear()

    # -- System prompt (static content) ------------------------------------

    def system_prompt_block(self) -> str:
        return self._boot_block

    # -- Prefetch (dynamic recall per turn) --------------------------------

    def prefetch_all(self, query: str, *, session_id: str = "") -> str:
        return self.prefetch(query, session_id=session_id or self._session_id)

    def queue_prefetch_all(self, query: str, *, session_id: str = "") -> None:
        self.queue_prefetch(query, session_id=session_id or self._session_id)

    @staticmethod
    def _normalize_full_query(query: str) -> str:
        return " ".join(str(query or "").strip().split())

    @classmethod
    def _payload_prompt(cls, query: str) -> str:
        # Existing API constraint: lifecycle payload is truncated to 500 chars.
        return cls._normalize_full_query(query)[:500]

    @classmethod
    def _identity_key(cls, session_id: str, query: str) -> str:
        full = cls._normalize_full_query(query)
        digest = hashlib.sha256(full.encode("utf-8")).hexdigest()
        return f"{session_id}:{digest}"

    def _register_flight_locked(
        self,
        *,
        key: str,
        session_id: str,
        payload: str,
    ) -> "_PrefetchFlight":
        """Register a new flight. Caller must hold _prefetch_lock; start thread after unlock."""
        flight = _PrefetchFlight(
            key=key,
            session_id=session_id,
            generation=self._generation,
            payload=payload,
        )
        self._inflight[key] = flight
        thread = threading.Thread(
            target=self._run_flight,
            args=(flight,),
            daemon=True,
            name="lore-prefetch",
        )
        flight.thread = thread
        self._prefetch_thread = thread
        self._prefetch_threads.add(thread)
        return flight

    def _claim_or_join(
        self,
        session_id: str,
        query: str,
        *,
        for_queue: bool = False,
    ) -> Optional[Any]:
        """Atomically decide ready consume / join / register under one lock.

        Returns:
          - ("ready", result) for prefetch consume-once
          - ("join", flight) to wait on an existing same-generation in-flight flight
          - ("start", flight) newly registered; caller must start flight.thread after unlock
          - None when there is nothing to do (no payload/client, or queue skip)

        Only callers that claim/join while a flight is still in `_inflight` share its
        result. Completed flights are never retained for later same-text joins, so a
        sequential same-session/same-text prefetch is always a new operation.
        """
        payload = self._payload_prompt(query)
        if not payload or not self._client:
            return None
        key = self._identity_key(session_id, query)
        flight_to_start: Optional[_PrefetchFlight] = None
        outcome: Optional[Any] = None
        with self._prefetch_lock:
            if for_queue:
                if self._ready_key == key or key in self._inflight:
                    return None
                flight_to_start = self._register_flight_locked(
                    key=key,
                    session_id=session_id,
                    payload=payload,
                )
                outcome = ("start", flight_to_start)
            else:
                if self._ready_key == key:
                    result = self._ready_result
                    self._ready_key = None
                    self._ready_result = ""
                    return ("ready", result)
                existing = self._inflight.get(key)
                if existing is not None and existing.generation == self._generation:
                    return ("join", existing)
                flight_to_start = self._register_flight_locked(
                    key=key,
                    session_id=session_id,
                    payload=payload,
                )
                outcome = ("start", flight_to_start)
        # Start outside the lock so completion cannot deadlock on the same lock.
        if flight_to_start is not None and flight_to_start.thread is not None:
            flight_to_start.thread.start()
        return outcome

    def _run_flight(self, flight: "_PrefetchFlight") -> None:
        result = ""
        try:
            result = self._do_recall(flight.payload, flight.session_id)
        except Exception as e:
            logger.debug("Lore queue_prefetch failed: %s", e)
        finally:
            with self._prefetch_lock:
                if (
                    self._inflight.get(flight.key) is flight
                    and flight.generation == self._generation
                ):
                    # Keep ready cache even for empty results so a late timeout
                    # path that already joined does not immediately re-issue.
                    self._ready_key = flight.key
                    self._ready_result = result
                if self._inflight.get(flight.key) is flight:
                    del self._inflight[flight.key]
                if flight.thread is not None:
                    self._prefetch_threads.discard(flight.thread)
            flight.result = result
            flight.done.set()

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        sid = session_id or self._session_id
        payload = self._payload_prompt(query)
        if not payload:
            return ""
        key = self._identity_key(sid, query)

        claimed = self._claim_or_join(sid, query, for_queue=False)
        if claimed is None:
            return ""
        kind, value = claimed
        if kind == "ready":
            return value

        flight: _PrefetchFlight = value
        finished = flight.done.wait(timeout=float(self._PREFETCH_WAIT_SECONDS))
        if not finished:
            # Bounded wait only: never start a second request for the same key.
            return ""

        with self._prefetch_lock:
            if self._ready_key == key:
                result = self._ready_result
                self._ready_key = None
                self._ready_result = ""
                return result
        # Flight completed; same-flight waiters that joined before completion use
        # the shared result even if another waiter already consumed ready cache.
        if flight.generation == self._generation and flight.key == key:
            return flight.result
        return ""

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        if not self._client:
            return
        sid = session_id or self._session_id
        payload = self._payload_prompt(query)
        if not payload:
            return
        self._claim_or_join(sid, query, for_queue=True)

    def _do_recall(self, query: str, session_id: str) -> str:
        """Execute recall API and return formatted block. Thread-safe.

        Appends discovery-only <lore-skills> candidates from the lifecycle
        response (no auto-download / no local path). Skill discovery is returned
        even when memory host context is empty.
        """
        payload = self._payload_prompt(query)
        if not payload:
            return ""
        try:
            lifecycle = self._client.lifecycle_event(
                "prompt.submit",
                session_id=session_id,
                prompt=payload,
            )
            output = lifecycle.get("host_output", {}) or {}
            value = output.get("value", {}) if output.get("mode") == "return_value" else {}
            context = str((value or {}).get("context") or "").strip()

            # Catalog identity may update on prompt lifecycle without download.
            catalog = skill_workcopy.read_skill_catalog(lifecycle)
            if catalog and catalog.get("project_id"):
                self._skill_project_id = catalog["project_id"]
                self._skill_catalog_revision = catalog.get("catalog_revision") or ""

            candidates = skill_workcopy.read_skill_candidates(lifecycle)
            discovered = skill_workcopy.discovery_candidate_entries(candidates)
            skill_block = skill_workcopy.format_skill_candidate_block(discovered).strip()

            if context and skill_block:
                return f"{context}\n\n{skill_block}"
            if skill_block:
                return skill_block
            return context
        except Exception as e:
            logger.debug("Lore lifecycle recall failed: %s", e)
            return ""

    # -- Sync turn (no-op for Lore) ----------------------------------------

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "") -> None:
        pass  # Lore does not auto-retain turns

    # -- Session end -------------------------------------------------------

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        pass

    # -- Shutdown ----------------------------------------------------------

    def shutdown(self) -> None:
        # Snapshot provider-owned threads; never hold the lock while joining.
        with self._prefetch_lock:
            threads = {
                thread
                for thread in self._prefetch_threads
                if thread is not None and thread.is_alive()
            }
            if self._prefetch_thread is not None and self._prefetch_thread.is_alive():
                threads.add(self._prefetch_thread)
        if not threads:
            return

        import time

        deadline = time.monotonic() + float(self._SHUTDOWN_WAIT_SECONDS)
        for thread in threads:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            thread.join(timeout=remaining)

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
                "description": "Load the fixed boot memory view that restores the deterministic startup baseline and core operating context",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
            {
                "name": "lore_get_node",
                "description": RECALL_GET_NODE_DESCRIPTION,
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "uri": {"type": "string", "description": "Full memory URI (e.g. core://soul). Use core:// or project:// to browse a domain root; bare words are paths in the default domain."},
                        "nav_only": {"type": "boolean", "description": "If true, skip expensive glossary processing"},
                        "session_id": {"type": "string", "description": RECALL_SESSION_ID_DESCRIPTION},
                        "query_id": {"type": "string", "description": RECALL_QUERY_ID_DESCRIPTION},
                    },
                    "required": ["uri"],
                },
            },
            {
                "name": "lore_create_node",
                "description": "Create a new long-term memory concept in the Lore living semantic tree. A URI path names the concept identity with durable snake_case segments; event time belongs in the node narrative or in explicit archive, diary, release, or incident concepts. For multi-segment paths, first make the parent abstraction real with content, disclosure, and glossary, then place the child under that conceptual home. Prefer update or merge when an existing concept already owns the fact.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "content": {"type": "string", "description": "Memory text body"},
                        "priority": {"type": "integer", "minimum": 0, "description": "Importance tier (0=core identity, 1=key facts, 2+=general)"},
                        "glossary": {"type": "array", "items": {"type": "string"}, "description": "Initial glossary keywords written with this node create event"},
                        "uri": {"type": "string", "description": "Optional final memory URI. It names a durable concept identity; event time belongs in content or in explicit archive, diary, release, or incident concepts. Intermediate paths grow from real parent abstractions with content."},
                        "domain": {"type": "string", "description": "Target memory domain when not using uri"},
                        "parent_path": {"type": "string", "description": "Parent concept path inside the chosen domain; for multi-segment paths this parent abstraction explains why the children belong together and carries content, disclosure, and glossary."},
                        "title": {"type": "string", "description": "Final concept segment for the new memory; name the reusable idea, module, decision, preference, or archive concept."},
                        "disclosure": {"type": "string", "description": "When this memory should be recalled"},
                    },
                    "required": ["content", "priority", "glossary"],
                },
            },
            {
                "name": "lore_update_node",
                "description": "Revise an existing long-term memory node. Omitted content, metadata, and glossary mutation fields are left unchanged",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "uri": {"type": "string", "description": "Full memory URI for the node you want to revise"},
                        "content": {"type": "string", "description": "New content to replace the existing content; omit to leave content unchanged"},
                        "priority": {"type": "integer", "minimum": 0, "description": "New priority level; omit to leave priority unchanged"},
                        "disclosure": {"type": "string", "description": "New disclosure / trigger condition; omit to leave disclosure unchanged"},
                        "glossary_add": {"type": "array", "items": {"type": "string"}, "description": "Keywords to add as part of this same node update event"},
                        "glossary_remove": {"type": "array", "items": {"type": "string"}, "description": "Keywords to remove as part of this same node update event"},
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
                    },
                    "required": ["uri"],
                },
            },
            {
                "name": "lore_move_node",
                "description": "Move or rename a memory concept inside the semantic memory tree. The target parent represents the conceptual home; it must already be a real parent abstraction with memory content so the move can reparent the node and its subtree into that abstraction.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "old_uri": {"type": "string", "description": "Current memory URI to move from"},
                        "new_uri": {"type": "string", "description": "New memory URI. For multi-segment paths, the target parent is the parent abstraction that becomes the node conceptual home."},
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
                        "query": {"type": "string", "description": "Search query text. Not a wildcard — use a meaningful keyword or phrase. Passing an empty string or * with a domain filter browses that domain root."},
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
                "name": "lore_skill_list",
                "description": "List Lore skills for the active project, including disabled skills when requested.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "include_disabled": {
                            "type": "boolean",
                            "description": "Include disabled skills (default true).",
                        },
                    },
                    "required": [],
                },
            },
            {
                "name": "lore_skill_search",
                "description": "Search or recall Lore skills by query.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query."},
                        "limit": {
                            "type": "number",
                            "minimum": 1,
                            "maximum": 50,
                            "description": "Max candidates.",
                        },
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "lore_skill_get",
                "description": (
                    "Fetch a Lore skill and materialize a writable local work copy when missing "
                    "or when the server version differs. Returns local SKILL.md content and absolute "
                    "skill_dir. Same-version local edits are preserved."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "skill_id": {"type": "string", "description": "Skill id."},
                    },
                    "required": ["skill_id"],
                },
            },
            {
                "name": "lore_skill_create",
                "description": (
                    "Create a Lore skill on the server. Does not auto-materialize a local work copy; "
                    "call lore_skill_get later if needed."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Skill name."},
                        "enabled": {
                            "type": "boolean",
                            "description": "Whether the skill is enabled (default true).",
                        },
                        "files": {
                            "type": "array",
                            "description": "Skill files; must include SKILL.md.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "path": {
                                        "type": "string",
                                        "description": "Relative path inside the skill (must include SKILL.md).",
                                    },
                                    "content": {
                                        "type": "string",
                                        "description": "UTF-8 file content.",
                                    },
                                    "content_base64": {
                                        "type": "string",
                                        "description": "Base64 file content for binary files.",
                                    },
                                    "media_type": {
                                        "type": "string",
                                        "description": "Optional media type.",
                                    },
                                },
                                "required": ["path"],
                            },
                        },
                    },
                    "required": ["name", "files"],
                },
            },
            {
                "name": "lore_skill_update",
                "description": (
                    "Update a Lore skill on the server with optimistic concurrency via expected_version. "
                    "Does not auto-reconcile the local work copy; call lore_skill_get later if the version differs."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "skill_id": {"type": "string", "description": "Skill id."},
                        "expected_version": {
                            "type": "number",
                            "description": "Expected current integer version (optimistic concurrency).",
                        },
                        "enabled": {
                            "type": "boolean",
                            "description": "Enable or disable the skill.",
                        },
                        "upsert_files": {
                            "type": "array",
                            "description": "Files to create or replace.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "path": {
                                        "type": "string",
                                        "description": "Relative path inside the skill (must include SKILL.md).",
                                    },
                                    "content": {
                                        "type": "string",
                                        "description": "UTF-8 file content.",
                                    },
                                    "content_base64": {
                                        "type": "string",
                                        "description": "Base64 file content for binary files.",
                                    },
                                    "media_type": {
                                        "type": "string",
                                        "description": "Optional media type.",
                                    },
                                },
                                "required": ["path"],
                            },
                        },
                        "delete_paths": {
                            "type": "array",
                            "description": "Paths to delete.",
                            "items": {
                                "type": "string",
                                "description": "Relative path to delete.",
                            },
                        },
                    },
                    "required": ["skill_id", "expected_version"],
                },
            },
            {
                "name": "lore_skill_delete",
                "description": "Archive/delete a Lore skill on the server. Does not auto-remove the local work copy.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "skill_id": {"type": "string", "description": "Skill id."},
                    },
                    "required": ["skill_id"],
                },
            },
            {
                "name": "lore_skill_status",
                "description": (
                    "Report local writable skill work-copy states (ready/missing/outdated/unmanaged/invalid). "
                    "Read-only: never mutates or reconciles work copies."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                    "required": [],
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
            if tool_name.startswith("lore_skill_"):
                self._skill_last_error = str(e)
            return f'"Error: {e}"'
        except skill_workcopy.SkillWorkCopyError as e:
            self._skill_last_error = str(e)
            return f'"Error: {e}"'
        except Exception as e:
            if tool_name.startswith("lore_skill_"):
                self._skill_last_error = str(e)
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
        created_path = "/".join(part for part in [effective_parent, effective_title] if part)
        created_uri = data.get("uri") or self._client.build_uri(effective_domain, created_path)
        return f"Created: {created_uri}\n\n{content[:500]}"

    def _tool_lore_update_node(self, args: Dict) -> str:
        uri = args.get("uri", "")
        domain, path = self._client.parse_uri(uri)
        data = self._client.update_node(
            domain=domain, path=path, content=args.get("content"),
            priority=args.get("priority"), disclosure=args.get("disclosure"),
            glossary_add=args.get("glossary_add"),
            glossary_remove=args.get("glossary_remove")
        )
        updated_uri = data.get("uri") or uri
        return f"Updated: {updated_uri}"

    def _tool_lore_delete_node(self, args: Dict) -> str:
        uri = args.get("uri", "")
        domain, path = self._client.parse_uri(uri)
        data = self._client.delete_node(domain, path)
        deleted_uri = data.get("deleted_uri") or data.get("uri") or uri
        canonical_uri = data.get("uri") or deleted_uri
        if canonical_uri != deleted_uri:
            return f"Deleted: {deleted_uri} (canonical: {canonical_uri})"
        return f"Deleted: {deleted_uri}"

    def _tool_lore_move_node(self, args: Dict) -> str:
        data = self._client.move_node(args.get("old_uri", ""), args.get("new_uri", ""))
        old_uri = data.get("old_uri") or args.get("old_uri", "")
        new_uri = data.get("new_uri") or data.get("uri") or args.get("new_uri", "")
        return f"Moved: {old_uri} → {new_uri}"

    def _tool_lore_search(self, args: Dict) -> str:
        query = str(args.get("query", "")).strip()
        domain = str(args.get("domain", "")).strip() or None
        if domain and (not query or query == "*"):
            data = self._client.get_node(domain, "", True)
            return f"Domain root: {domain}://\n\n{formatters.format_node(data)}"
        data = self._client.search(
            query,
            domain,
            args.get("limit", 10),
            args.get("content_limit", 5),
        )
        results = data.get("results", [])
        if not results:
            return f"No matching memories found{' in domain ' + domain if domain else ''}."
        return formatters.format_search_results(results, data.get("meta"))

    def _tool_lore_list_domains(self, args: Dict) -> str:
        data = self._client.list_domains()
        return formatters.format_domains(data)

    # -- Skill tools -------------------------------------------------------

    def _tool_lore_skill_list(self, args: Dict) -> str:
        include_disabled = args.get("include_disabled") is not False
        data = self._client.list_skills(include_disabled=include_disabled)
        if data.get("project_id"):
            self._skill_project_id = str(data["project_id"])
        if data.get("catalog_revision") is not None:
            self._skill_catalog_revision = str(data.get("catalog_revision") or "")
        skills = data.get("skills") or []
        lines = []
        for s in skills:
            if not isinstance(s, dict):
                continue
            enabled = "disabled" if s.get("enabled") is False else "enabled"
            skill_id = skill_workcopy.skill_id_of(s)
            version = skill_workcopy.skill_version_of(s)
            lines.append(f"- {s.get('name')} ({skill_id}) {enabled} v{version if version is not None else '?'}")
        project_id = data.get("project_id") or "?"
        rev = data.get("catalog_revision") or "?"
        if lines:
            return f"Project {project_id} rev {rev}\n" + "\n".join(lines)
        return f"Project {project_id} rev {rev}\nNo skills."

    def _tool_lore_skill_search(self, args: Dict) -> str:
        query = str(args.get("query") or "")
        limit = args.get("limit")
        data = self._client.search_skills(query, limit=limit if isinstance(limit, (int, float)) else None)
        if isinstance(data.get("candidates"), list):
            data = dict(data)
            data["candidates"] = [
                skill_workcopy.normalize_skill_candidate(c)
                for c in data["candidates"]
                if isinstance(c, dict)
            ]
        return json.dumps(data, indent=2, ensure_ascii=False)

    def _tool_lore_skill_get(self, args: Dict) -> str:
        skill_id = str(args.get("skill_id") or "").strip()
        if not skill_id:
            raise LoreError("skill_id is required")
        lore_home = skill_workcopy.resolve_lore_home()

        def load_skill(sid: str):
            return skill_workcopy.normalize_skill_detail(self._client.get_skill(sid))

        def load_catalog():
            return self._client.list_skills(include_disabled=True)

        result = skill_workcopy.ensure_skill_work_copy(
            skill_id=skill_id,
            load_skill=load_skill,
            lore_home=lore_home,
            project_id=self._skill_project_id or None,
            load_catalog=load_catalog,
        )
        if result.get("project_id"):
            self._skill_project_id = str(result["project_id"])
        skill = result.get("skill") or {}
        lines = [
            f"Skill work copy ready: {skill.get('name') or skill_id}",
            f"skill_dir: {result['skill_dir']}",
            f"server_version: {result.get('server_version') if result.get('server_version') is not None else '?'}",
            f"local_version: {result.get('local_version')}",
            f"downloaded: {result.get('downloaded')}",
            "",
            result.get("skill_md") or "",
        ]
        return "\n".join(lines)

    def _tool_lore_skill_create(self, args: Dict) -> str:
        name = str(args.get("name") or "").strip()
        if not name:
            raise LoreError("name is required")
        body = {
            "name": name,
            "enabled": args.get("enabled") is not False,
            "files": args.get("files") if isinstance(args.get("files"), list) else [],
        }
        data = skill_workcopy.normalize_skill_detail(self._client.create_skill(body))
        if data.get("project_id"):
            self._skill_project_id = str(data["project_id"])
        skill_id = skill_workcopy.skill_id_of(data) or "?"
        version = skill_workcopy.skill_version_of(data)
        if version is not None and version != "":
            return f"Created skill {data.get('name') or name} (skill_id: {skill_id}, version: {version})"
        return f"Created skill {data.get('name') or name} (skill_id: {skill_id})"

    def _tool_lore_skill_update(self, args: Dict) -> str:
        skill_id = str(args.get("skill_id") or "").strip()
        if not skill_id:
            raise LoreError("skill_id is required")
        expected_raw = args.get("expected_version")
        # Accept int-like values; reject bools and non-positive.
        expected: Optional[int] = None
        if isinstance(expected_raw, bool):
            expected = None
        elif isinstance(expected_raw, int):
            expected = expected_raw
        elif isinstance(expected_raw, float) and expected_raw.is_integer():
            expected = int(expected_raw)
        if expected is None or expected < 1:
            raise LoreError("expected_version is required and must be a positive integer")
        body: Dict[str, Any] = {"expected_version": expected}
        if isinstance(args.get("enabled"), bool):
            body["enabled"] = args["enabled"]
        if isinstance(args.get("upsert_files"), list):
            body["upsert_files"] = args["upsert_files"]
        if isinstance(args.get("delete_paths"), list):
            body["delete_paths"] = args["delete_paths"]
        data = skill_workcopy.normalize_skill_detail(self._client.update_skill(skill_id, body))
        updated_id = skill_workcopy.skill_id_of(data) or skill_id
        version = skill_workcopy.skill_version_of(data)
        if version is not None and version != "":
            return f"Updated skill {data.get('name') or skill_id} (skill_id: {updated_id}, version: {version})"
        return f"Updated skill {data.get('name') or skill_id} (skill_id: {updated_id})"

    def _tool_lore_skill_delete(self, args: Dict) -> str:
        skill_id = str(args.get("skill_id") or "").strip()
        if not skill_id:
            raise LoreError("skill_id is required")
        data = self._client.delete_skill(skill_id) or {}
        if data.get("project_id"):
            self._skill_project_id = str(data["project_id"])
        if data.get("catalog_revision") is not None:
            self._skill_catalog_revision = str(data.get("catalog_revision") or "")
        return f"Deleted skill {skill_id}"

    def _tool_lore_skill_status(self, args: Dict) -> str:
        project_id = self._skill_project_id
        catalog_revision = self._skill_catalog_revision
        if not project_id and self._client:
            try:
                catalog = self._client.list_skills(include_disabled=True)
                if catalog.get("project_id"):
                    project_id = str(catalog["project_id"])
                    self._skill_project_id = project_id
                    catalog_revision = str(catalog.get("catalog_revision") or "")
                    self._skill_catalog_revision = catalog_revision
            except Exception:
                pass
        lore_home = skill_workcopy.resolve_lore_home()
        work_copies = (
            skill_workcopy.list_local_work_copy_statuses(lore_home, project_id)
            if project_id
            else skill_workcopy.list_all_local_work_copy_statuses(lore_home)
        )
        lines = []
        for m in work_copies:
            ver = f" v{m['version']}" if m.get("version") is not None else ""
            msg = f" — {m['message']}" if m.get("message") else ""
            project = m.get("project_id")
            project_label = f" [{project}]" if project else ""
            lines.append(f"- {m.get('name')}{project_label}: {m.get('state')}{ver}{msg}")
        header = f"project={project_id or '?'} catalog_revision={catalog_revision or '?'}"
        parts = [header] + (lines if lines else ["(no local work copies)"])
        if self._skill_last_error:
            parts.append(f"last_error: {self._skill_last_error}")
        return "\n".join(parts)


# ---------------------------------------------------------------------------
# Plugin registration entry point
# ---------------------------------------------------------------------------

def register(ctx) -> None:
    """Register Lore as a memory provider plugin."""
    ctx.register_memory_provider(LoreMemoryProvider())
