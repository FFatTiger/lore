import sys
import types
import unittest
import json
import os
import tempfile
from pathlib import Path


agent_module = types.ModuleType("agent")
memory_provider_module = types.ModuleType("agent.memory_provider")


class MemoryProvider:
    pass


memory_provider_module.MemoryProvider = MemoryProvider
agent_module.memory_provider = memory_provider_module
sys.modules.setdefault("agent", agent_module)
sys.modules.setdefault("agent.memory_provider", memory_provider_module)

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lore_memory import LoreMemoryProvider
from lore_memory.client import LoreClient, LoreError
from lore_memory.formatters import format_boot_view


RECALL_GET_NODE_DESCRIPTION = "Open a memory node. REQUIRED when opening a URI from a <recall>: copy the exact session_id and query_id from that <recall> tag."
RECALL_SESSION_ID_DESCRIPTION = "REQUIRED when the URI came from <recall>: copy the exact session_id from that <recall> tag."
RECALL_QUERY_ID_DESCRIPTION = "REQUIRED when the URI came from <recall>: copy the exact query_id from that <recall> tag."


class LoreClientThinAdapterTests(unittest.TestCase):
    def test_reads_shared_lore_config_when_constructor_and_env_omit_values(self):
        old_home = os.environ.get("HOME")
        old_base_url = os.environ.get("LORE_BASE_URL")
        old_lore_token = os.environ.get("LORE_API_TOKEN")
        old_api_token = os.environ.get("API_TOKEN")
        with tempfile.TemporaryDirectory() as home:
            os.environ["HOME"] = home
            os.environ.pop("LORE_BASE_URL", None)
            os.environ.pop("LORE_API_TOKEN", None)
            os.environ.pop("API_TOKEN", None)
            config_dir = Path(home) / ".lore"
            config_dir.mkdir()
            (config_dir / "config.json").write_text(json.dumps({
                "base_url": "http://shared-lore:18901/",
                "api_token": "shared-token",
            }), encoding="utf-8")

            client = LoreClient()

            self.assertEqual(client.base_url, "http://shared-lore:18901")
            self.assertEqual(client.api_token, "shared-token")

        if old_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = old_home
        if old_base_url is None:
            os.environ.pop("LORE_BASE_URL", None)
        else:
            os.environ["LORE_BASE_URL"] = old_base_url
        if old_lore_token is None:
            os.environ.pop("LORE_API_TOKEN", None)
        else:
            os.environ["LORE_API_TOKEN"] = old_lore_token
        if old_api_token is None:
            os.environ.pop("API_TOKEN", None)
        else:
            os.environ["API_TOKEN"] = old_api_token

    def test_constructor_values_override_shared_lore_config(self):
        old_home = os.environ.get("HOME")
        with tempfile.TemporaryDirectory() as home:
            os.environ["HOME"] = home
            config_dir = Path(home) / ".lore"
            config_dir.mkdir()
            (config_dir / "config.json").write_text(json.dumps({
                "base_url": "http://shared-lore:18901",
                "api_token": "shared-token",
            }), encoding="utf-8")

            client = LoreClient(base_url="http://constructor-lore:18901", api_token="constructor-token")

            self.assertEqual(client.base_url, "http://constructor-lore:18901")
            self.assertEqual(client.api_token, "constructor-token")

        if old_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = old_home

    def test_shared_lore_config_overrides_legacy_environment(self):
        old_home = os.environ.get("HOME")
        old_base_url = os.environ.get("LORE_BASE_URL")
        old_lore_token = os.environ.get("LORE_API_TOKEN")
        with tempfile.TemporaryDirectory() as home:
            os.environ["HOME"] = home
            os.environ["LORE_BASE_URL"] = "http://env-lore:18901"
            os.environ["LORE_API_TOKEN"] = "env-token"
            config_dir = Path(home) / ".lore"
            config_dir.mkdir()
            (config_dir / "config.json").write_text(json.dumps({
                "base_url": "http://shared-lore:18901",
                "api_token": "shared-token",
            }), encoding="utf-8")

            client = LoreClient()

            self.assertEqual(client.base_url, "http://shared-lore:18901")
            self.assertEqual(client.api_token, "shared-token")

        if old_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = old_home
        if old_base_url is None:
            os.environ.pop("LORE_BASE_URL", None)
        else:
            os.environ["LORE_BASE_URL"] = old_base_url
        if old_lore_token is None:
            os.environ.pop("LORE_API_TOKEN", None)
        else:
            os.environ["LORE_API_TOKEN"] = old_lore_token

    def test_create_node_sends_glossary_in_node_request(self):
        client = LoreClient(base_url="http://example.com")
        requests = []
        client._request = lambda *args, **kwargs: {
            "success": True,
            "operation": "create",
            "uri": "core://agent/profile",
            "path": "agent/profile",
            "node_uuid": "uuid-create",
        } if not requests.append((args, kwargs)) else {}

        result = client.create_node(
            domain="core",
            parent_path="agent",
            title="profile",
            content="hello",
            priority=2,
            glossary=["memory"],
        )

        self.assertEqual(result["node_uuid"], "uuid-create")
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0][1]["data"]["glossary"], ["memory"])

    def test_update_node_sends_glossary_mutations_in_node_request(self):
        client = LoreClient(base_url="http://example.com")
        requests = []
        client._request = lambda *args, **kwargs: {
            "success": True,
            "operation": "update",
            "uri": "core://agent/profile-renamed",
            "path": "agent/profile-renamed",
            "node_uuid": "uuid-update",
        } if not requests.append((args, kwargs)) else {}
        client.get_node = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("get_node should not be called"))

        result = client.update_node(
            domain="core",
            path="agent/profile",
            content="updated",
            glossary=["fresh"],
            glossary_add=["memory"],
            glossary_remove=["archive"],
        )

        self.assertEqual(result["uri"], "core://agent/profile-renamed")
        self.assertEqual(len(requests), 1)
        self.assertNotIn("glossary", requests[0][1]["data"])
        self.assertEqual(requests[0][1]["data"]["glossary_add"], ["memory"])
        self.assertEqual(requests[0][1]["data"]["glossary_remove"], ["archive"])

    def test_lifecycle_event_calls_lifecycle_route(self):
        client = LoreClient(base_url="http://example.com")
        requests = []
        client._request = lambda *args, **kwargs: {"ok": True} if not requests.append((args, kwargs)) else {}

        client.lifecycle_event(
            "session.start",
            session_id="sess-1",
            project={"dir_name": "lore", "repo_name": "lore"},
        )
        client.lifecycle_event("prompt.submit", session_id="sess-1", prompt="hello")

        self.assertEqual(requests[0][0], ("POST", "/lifecycle/event"))
        self.assertEqual(requests[0][1]["data"]["protocol_version"], "lore.lifecycle.v1")
        self.assertEqual(requests[0][1]["data"]["runtime"], {"runtime_id": "hermes", "runtime_family": "hermes"})
        self.assertEqual(requests[0][1]["data"]["event"]["name"], "session.start")
        self.assertEqual(requests[0][1]["data"]["normalized"]["session_id"], "sess-1")
        self.assertEqual(requests[0][1]["data"]["project"], {"dir_name": "lore", "repo_name": "lore"})
        self.assertEqual(requests[1][0], ("POST", "/lifecycle/event"))
        self.assertEqual(requests[1][1]["data"]["event"]["name"], "prompt.submit")
        self.assertEqual(requests[1][1]["data"]["normalized"], {"session_id": "sess-1", "prompt": "hello"})
        self.assertEqual(len(requests), 2)


class FakeClient:
    def __init__(self):
        self.last_update_kwargs = None
        self.ended_session_id = None
        self.lifecycle_calls = []
        self.prompt_submit_gate = None
        self.prompt_submit_delay = 0.0
        self.prompt_submit_entered = None
        self._prompt_submit_enter_count = 0

    def parse_uri(self, uri):
        return uri.split("://", 1)[0], uri.split("://", 1)[1]

    def build_uri(self, domain, path):
        return f"{domain}://{path}"

    def create_node(self, **kwargs):
        return {"uri": "core://agent/profile", "node_uuid": "uuid-create"}

    def update_node(self, **kwargs):
        self.last_update_kwargs = kwargs
        return {"uri": "core://agent/profile-renamed", "node_uuid": "uuid-update"}

    def delete_node(self, *args, **kwargs):
        return {"deleted_uri": "core://legacy/profile", "uri": "core://canonical/profile"}

    def move_node(self, *args, **kwargs):
        return {"old_uri": "core://old/path", "new_uri": "core://new/path", "uri": "core://new/path"}

    def lifecycle_event(self, event_name, **kwargs):
        self.lifecycle_calls.append((event_name, dict(kwargs)))
        if event_name == "session.start":
            return {
                "host_output": {
                    "mode": "return_value",
                    "value": {"system_context": "LIFECYCLE SYSTEM"},
                },
            }
        if event_name == "prompt.submit":
            self._prompt_submit_enter_count += 1
            if self.prompt_submit_entered is not None:
                self.prompt_submit_entered.set()
            if self.prompt_submit_gate is not None:
                self.prompt_submit_gate.wait()
            if self.prompt_submit_delay:
                import time
                time.sleep(self.prompt_submit_delay)
            session_id = kwargs.get("session_id") or "sess-1"
            return {
                "host_output": {
                    "mode": "return_value",
                    "value": {
                        "context": (
                            f"<recall session_id=\"{session_id}\" query_id=\"q1\">\n"
                            "0.70 | core://project\n"
                            "</recall>"
                        )
                    },
                },
            }
        return {"host_output": {"mode": "none", "value": None}}


class LoreProviderThinAdapterTests(unittest.TestCase):
    def setUp(self):
        self.provider = LoreMemoryProvider()
        self.provider._client = FakeClient()
        self.provider._session_id = "sess-1"

    def test_format_boot_view_warns_recent_memories_not_uri_examples(self):
        text = format_boot_view({"recent_memories": [{"uri": "core://foo_2026_06_24", "priority": 2}]})
        self.assertIn("context hints", text)
        self.assertIn("event time", text)

    def test_create_tool_formats_top_level_uri(self):
        result = self.provider._tool_lore_create_node({
            "domain": "core",
            "parent_path": "agent",
            "title": "profile",
            "content": "hello",
            "priority": 2,
            "glossary": [],
        })

        self.assertEqual(result, "Created: core://agent/profile\n\nhello")

    def test_update_tool_formats_top_level_uri(self):
        result = self.provider._tool_lore_update_node({
            "uri": "core://agent/profile",
            "content": "updated",
        })

        self.assertEqual(result, "Updated: core://agent/profile-renamed")

    def test_create_schema_explains_semantic_tree_identity_and_date_meaning(self):
        schemas = {tool["name"]: tool for tool in self.provider.get_tool_schemas()}
        create = schemas["lore_create_node"]
        self.assertIn("living semantic tree", create["description"])
        self.assertIn("concept identity", create["description"])
        self.assertIn("event time", create["description"])
        self.assertIn("parent abstraction", create["description"])
        self.assertIn("concept identity", create["parameters"]["properties"]["uri"]["description"])
        self.assertIn("event time", create["parameters"]["properties"]["uri"]["description"])
        self.assertNotIn("Do not append dates", create["description"])

    def test_move_schema_requires_real_parent_nodes(self):
        schemas = {tool["name"]: tool for tool in self.provider.get_tool_schemas()}
        move = schemas["lore_move_node"]
        self.assertIn("semantic memory tree", move["description"])
        self.assertIn("parent abstraction", move["description"])
        self.assertIn("conceptual home", move["description"])
        self.assertIn("parent abstraction", move["parameters"]["properties"]["new_uri"]["description"])

    def test_update_tool_does_not_expose_glossary_replacement(self):
        schemas = {tool["name"]: tool for tool in self.provider.get_tool_schemas()}
        props = schemas["lore_update_node"]["parameters"]["properties"]

        self.assertNotIn("glossary", props)
        self.assertIn("glossary_add", props)
        self.assertIn("glossary_remove", props)
        self.assertNotIn("glossary fields", schemas["lore_update_node"]["description"])

    def test_initialize_uses_lifecycle_startup_context(self):
        import lore_memory as provider_module
        original_client = provider_module.LoreClient
        fake = FakeClient()
        provider_module.LoreClient = lambda *args, **kwargs: fake
        try:
            provider = LoreMemoryProvider()
            provider.initialize("sess-1")
        finally:
            provider_module.LoreClient = original_client

        self.assertEqual(provider.system_prompt_block(), "LIFECYCLE SYSTEM")

    def test_prefetch_uses_lifecycle_recall_context(self):
        result = self.provider.prefetch("hello", session_id="sess-1")
        self.assertIn("core://project", result)

    def test_slow_queued_prefetch_and_foreground_timeout_share_one_lifecycle_call(self):
        import threading
        import time

        gate = threading.Event()
        entered = threading.Event()
        self.provider._client.prompt_submit_gate = gate
        self.provider._client.prompt_submit_entered = entered
        original_timeout = getattr(self.provider, "_PREFETCH_WAIT_SECONDS", 5.0)
        self.provider._PREFETCH_WAIT_SECONDS = 0.05
        try:
            self.provider.queue_prefetch("slow query", session_id="sess-1")
            self.assertTrue(entered.wait(timeout=1.0))
            result = self.provider.prefetch("slow query", session_id="sess-1")
            self.assertEqual(result, "")
            prompt_calls = [
                call for call in self.provider._client.lifecycle_calls
                if call[0] == "prompt.submit"
            ]
            self.assertEqual(len(prompt_calls), 1)
            gate.set()
            deadline = time.time() + 1.0
            while time.time() < deadline and self.provider._prefetch_thread and self.provider._prefetch_thread.is_alive():
                time.sleep(0.01)
            self.assertFalse(
                self.provider._prefetch_thread and self.provider._prefetch_thread.is_alive(),
                "queued flight did not finish after gate release",
            )
            self.assertEqual(
                len([call for call in self.provider._client.lifecycle_calls if call[0] == "prompt.submit"]),
                1,
            )
        finally:
            gate.set()
            self.provider._PREFETCH_WAIT_SECONDS = original_timeout

    def test_on_session_switch_uses_new_session_and_discards_old_cache(self):
        import threading
        import time

        gate = threading.Event()
        entered = threading.Event()
        self.provider._client.prompt_submit_gate = gate
        self.provider._client.prompt_submit_entered = entered
        self.provider.queue_prefetch("hello", session_id="sess-1")
        self.assertTrue(entered.wait(timeout=1.0))
        self.provider.on_session_switch("sess-2", parent_session_id="sess-1", reset=True)
        gate.set()
        deadline = time.time() + 1.0
        while time.time() < deadline and self.provider._prefetch_thread and self.provider._prefetch_thread.is_alive():
            time.sleep(0.01)
        self.assertFalse(
            self.provider._prefetch_thread and self.provider._prefetch_thread.is_alive(),
            "stale flight did not finish after gate release",
        )

        self.provider._client.lifecycle_calls.clear()
        self.provider._client.prompt_submit_gate = None
        self.provider._client.prompt_submit_entered = None
        result = self.provider.prefetch("hello", session_id="sess-2")
        self.assertIn('session_id="sess-2"', result)
        prompt_calls = [
            call for call in self.provider._client.lifecycle_calls
            if call[0] == "prompt.submit"
        ]
        self.assertEqual(len(prompt_calls), 1)
        self.assertEqual(prompt_calls[0][1]["session_id"], "sess-2")

    def test_same_session_rewind_detaches_stale_flight_and_starts_current_generation(self):
        import threading
        import time

        gate = threading.Event()
        entered = threading.Event()
        self.provider._client.prompt_submit_gate = gate
        self.provider._client.prompt_submit_entered = entered
        self.provider.queue_prefetch("same query", session_id="sess-1")
        self.assertTrue(entered.wait(timeout=1.0))
        first_calls = [
            call for call in self.provider._client.lifecycle_calls
            if call[0] == "prompt.submit"
        ]
        self.assertEqual(len(first_calls), 1)

        # Same session identity with rewound=True must invalidate the joinable map.
        self.provider.on_session_switch("sess-1", rewound=True)

        # Current-generation request must not join the gated pre-switch flight.
        second_entered = threading.Event()
        self.provider._client.prompt_submit_entered = second_entered
        result_holder = {}

        def run_prefetch():
            result_holder["result"] = self.provider.prefetch("same query", session_id="sess-1")

        worker = threading.Thread(target=run_prefetch, daemon=True)
        worker.start()
        self.assertTrue(second_entered.wait(timeout=1.0))
        second_calls = [
            call for call in self.provider._client.lifecycle_calls
            if call[0] == "prompt.submit"
        ]
        self.assertEqual(len(second_calls), 2)

        gate.set()
        worker.join(timeout=1.0)
        self.assertFalse(worker.is_alive())
        self.assertIn('session_id="sess-1"', result_holder.get("result", ""))
        self.assertIn("core://project", result_holder.get("result", ""))

    def test_shutdown_waits_for_all_active_flights_not_only_latest_thread(self):
        import threading
        import time

        gate = threading.Event()
        entered_alpha = threading.Event()
        self.provider._client.prompt_submit_gate = gate
        self.provider._client.prompt_submit_entered = entered_alpha
        original_shutdown = getattr(self.provider, "_SHUTDOWN_WAIT_SECONDS", 5.0)
        self.provider._SHUTDOWN_WAIT_SECONDS = 1.0
        try:
            self.provider.queue_prefetch("query-alpha", session_id="sess-1")
            self.assertTrue(entered_alpha.wait(timeout=1.0))

            entered_beta = threading.Event()
            self.provider._client.prompt_submit_entered = entered_beta
            self.provider.queue_prefetch("query-beta", session_id="sess-1")
            self.assertTrue(entered_beta.wait(timeout=1.0))

            prompt_calls = [
                call for call in self.provider._client.lifecycle_calls
                if call[0] == "prompt.submit"
            ]
            self.assertEqual(len(prompt_calls), 2)

            with self.provider._prefetch_lock:
                active_before = {
                    thread for thread in self.provider._prefetch_threads if thread.is_alive()
                }
            self.assertGreaterEqual(len(active_before), 2)

            # Release both flights after shutdown has begun observing them.
            def release_soon():
                time.sleep(0.05)
                gate.set()

            releaser = threading.Thread(target=release_soon, daemon=True)
            releaser.start()
            started = time.time()
            self.provider.shutdown()
            elapsed = time.time() - started

            with self.provider._prefetch_lock:
                still_alive = {
                    thread for thread in self.provider._prefetch_threads if thread.is_alive()
                }
            self.assertEqual(still_alive, set())
            self.assertLess(elapsed, 0.9)
            self.assertEqual(
                len([call for call in self.provider._client.lifecycle_calls if call[0] == "prompt.submit"]),
                2,
            )
        finally:
            gate.set()
            self.provider._SHUTDOWN_WAIT_SECONDS = original_shutdown

    def test_ready_cache_consume_and_flight_create_are_atomic_under_contention(self):
        """Ready consume-once and same-key join/create are decided under one lock.

        Part A: concurrent prefetch against a planted ready entry consumes it once.
        Part B: gated queue+foreground waiters share exactly one prompt.submit so
        completion cannot open a second flight for the same key while waiters claim.
        The network gate is released only after every participant has claimed/joined.
        Coordination is implemented with a test-only wrapper around `_claim_or_join`;
        no production claim counters or events are used.
        """
        import threading

        # Part A — ready consume-once under concurrent claim.
        key = self.provider._identity_key("sess-1", "cached-query")
        with self.provider._prefetch_lock:
            self.provider._ready_key = key
            self.provider._ready_result = "READY-BLOCK"

        ready_results = []
        errors = []

        def claim_cached():
            try:
                ready_results.append(
                    self.provider.prefetch("cached-query", session_id="sess-1")
                )
            except Exception as exc:  # pragma: no cover
                errors.append(exc)

        claimers = [threading.Thread(target=claim_cached, daemon=True) for _ in range(8)]
        for worker in claimers:
            worker.start()
        for worker in claimers:
            worker.join(timeout=2.0)
            self.assertFalse(worker.is_alive())

        self.assertEqual(errors, [])
        self.assertEqual(ready_results.count("READY-BLOCK"), 1)
        with self.provider._prefetch_lock:
            self.assertNotEqual(self.provider._ready_key, key)
        for item in ready_results:
            self.assertTrue(item == "READY-BLOCK" or "core://project" in item)

        # Part B — stress gated same-key queue+foreground single-flight.
        for i in range(40):
            provider = LoreMemoryProvider()
            client = FakeClient()
            provider._client = client
            provider._session_id = "sess-1"
            query = f"atomic-boundary-{i}"

            gate = threading.Event()
            entered = threading.Event()
            claims_ready = threading.Event()
            claim_lock = threading.Lock()
            claim_count = {"n": 0}
            client.prompt_submit_gate = gate
            client.prompt_submit_entered = entered

            original_claim = provider._claim_or_join

            # Count non-None claim outcomes only (start/join/ready).
            # Queue + 3 foreground claims = 4 outcomes before gate release.
            def wrapped_claim(session_id, query, *, for_queue=False):
                outcome = original_claim(session_id, query, for_queue=for_queue)
                if outcome is not None:
                    with claim_lock:
                        claim_count["n"] += 1
                        if claim_count["n"] >= 4:
                            claims_ready.set()
                return outcome

            provider._claim_or_join = wrapped_claim  # type: ignore[method-assign]

            results = []
            loop_errors = []

            def queue_then_prefetch():
                try:
                    provider.queue_prefetch(query, session_id="sess-1")
                    results.append(provider.prefetch(query, session_id="sess-1"))
                except Exception as exc:  # pragma: no cover
                    loop_errors.append(exc)

            def prefetch_only():
                try:
                    results.append(provider.prefetch(query, session_id="sess-1"))
                except Exception as exc:  # pragma: no cover
                    loop_errors.append(exc)

            workers = [
                threading.Thread(target=queue_then_prefetch, daemon=True),
                threading.Thread(target=prefetch_only, daemon=True),
                threading.Thread(target=prefetch_only, daemon=True),
            ]
            for worker in workers:
                worker.start()

            self.assertTrue(
                claims_ready.wait(timeout=1.0),
                f"participants never all claimed on iteration {i}",
            )
            self.assertTrue(
                entered.wait(timeout=1.0),
                f"prompt.submit never entered on iteration {i}",
            )
            gated_calls = [
                call for call in client.lifecycle_calls if call[0] == "prompt.submit"
            ]
            self.assertEqual(
                len(gated_calls),
                1,
                f"expected single-flight while gated on iteration {i}, got {len(gated_calls)}",
            )

            gate.set()
            for worker in workers:
                worker.join(timeout=2.0)
                self.assertFalse(worker.is_alive(), f"worker hung on iteration {i}")

            self.assertEqual(loop_errors, [])
            final_calls = [
                call for call in client.lifecycle_calls if call[0] == "prompt.submit"
            ]
            self.assertEqual(
                len(final_calls),
                1,
                f"expected single-flight after release on iteration {i}, got {len(final_calls)}",
            )
            self.assertEqual(len(results), 3)
            for item in results:
                self.assertIn("core://project", item)

    def test_queue_completion_ready_consume_then_fresh_second_foreground(self):
        """Completed queue_prefetch is consumed once; next identical foreground is fresh."""
        import threading
        import time

        entered = threading.Event()
        self.provider._client.prompt_submit_entered = entered
        self.provider.queue_prefetch("queued-then-repeat", session_id="sess-1")
        self.assertTrue(entered.wait(timeout=1.0))

        deadline = time.time() + 1.0
        while time.time() < deadline and self.provider._prefetch_thread and self.provider._prefetch_thread.is_alive():
            time.sleep(0.01)
        self.assertFalse(
            self.provider._prefetch_thread and self.provider._prefetch_thread.is_alive(),
            "queued flight did not finish",
        )

        first = self.provider.prefetch("queued-then-repeat", session_id="sess-1")
        second = self.provider.prefetch("queued-then-repeat", session_id="sess-1")
        self.assertIn("core://project", first)
        self.assertIn("core://project", second)
        prompt_calls = [
            call for call in self.provider._client.lifecycle_calls
            if call[0] == "prompt.submit"
        ]
        # First lifecycle from queue_prefetch; second only after ready was consumed.
        self.assertEqual(len(prompt_calls), 2)

    def test_sequential_identical_prefetch_issues_fresh_lifecycle_call(self):
        first = self.provider.prefetch("repeat", session_id="sess-1")
        second = self.provider.prefetch("repeat", session_id="sess-1")
        self.assertIn("core://project", first)
        self.assertIn("core://project", second)
        prompt_calls = [
            call for call in self.provider._client.lifecycle_calls
            if call[0] == "prompt.submit"
        ]
        self.assertEqual(len(prompt_calls), 2)
        self.assertEqual(prompt_calls[0][1]["prompt"], "repeat")
        self.assertEqual(prompt_calls[1][1]["prompt"], "repeat")

    def test_prefetch_all_honors_explicit_session_id(self):
        self.provider._session_id = "sess-default"
        result = self.provider.prefetch_all("hello", session_id="sess-explicit")
        self.assertIn('session_id="sess-explicit"', result)
        prompt_calls = [
            call for call in self.provider._client.lifecycle_calls
            if call[0] == "prompt.submit"
        ]
        self.assertEqual(prompt_calls[0][1]["session_id"], "sess-explicit")

    def test_queue_prefetch_all_honors_explicit_session_id(self):
        import threading

        entered = threading.Event()
        self.provider._session_id = "sess-default"
        self.provider._client.prompt_submit_entered = entered
        self.provider.queue_prefetch_all("hello", session_id="sess-explicit")
        self.assertTrue(entered.wait(timeout=1.0))
        if self.provider._prefetch_thread is not None:
            self.provider._prefetch_thread.join(timeout=1.0)
            self.assertFalse(self.provider._prefetch_thread.is_alive())
        prompt_calls = [
            call for call in self.provider._client.lifecycle_calls
            if call[0] == "prompt.submit"
        ]
        self.assertEqual(len(prompt_calls), 1)
        self.assertEqual(prompt_calls[0][1]["session_id"], "sess-explicit")

    def test_prompts_sharing_500_char_prefix_do_not_collide(self):
        prefix = "x" * 500
        first = self.provider.prefetch(prefix + "-one", session_id="sess-1")
        second = self.provider.prefetch(prefix + "-two", session_id="sess-1")
        self.assertIn("core://project", first)
        self.assertIn("core://project", second)
        prompt_calls = [
            call for call in self.provider._client.lifecycle_calls
            if call[0] == "prompt.submit"
        ]
        self.assertEqual(len(prompt_calls), 2)

    def test_session_end_is_noop(self):
        self.provider.on_session_end([])
        self.assertIsNone(self.provider._client.ended_session_id)


    def test_session_read_tools_are_not_exposed(self):
        schemas = {tool["name"]: tool for tool in self.provider.get_tool_schemas()}
        self.assertNotIn("lore_list_session_reads", schemas)
        self.assertNotIn("lore_clear_session_reads", schemas)

    def test_get_node_tool_uses_unified_recall_identifier_descriptions(self):
        schemas = {tool["name"]: tool for tool in self.provider.get_tool_schemas()}
        tool = schemas["lore_get_node"]
        props = tool["parameters"]["properties"]

        self.assertEqual(tool["description"], RECALL_GET_NODE_DESCRIPTION)
        self.assertEqual(props["session_id"]["description"], RECALL_SESSION_ID_DESCRIPTION)
        self.assertEqual(props["query_id"]["description"], RECALL_QUERY_ID_DESCRIPTION)

    def test_update_tool_ignores_glossary_replacement_argument(self):
        result = self.provider._tool_lore_update_node({
            "uri": "core://agent/profile",
            "glossary": ["fresh"],
            "glossary_add": ["memory"],
        })

        self.assertEqual(result, "Updated: core://agent/profile-renamed")
        self.assertNotIn("glossary", self.provider._client.last_update_kwargs)
        self.assertEqual(self.provider._client.last_update_kwargs["glossary_add"], ["memory"])

    def test_delete_tool_formats_canonical_delete_receipt(self):
        result = self.provider._tool_lore_delete_node({"uri": "core://legacy/profile"})
        self.assertEqual(result, "Deleted: core://legacy/profile (canonical: core://canonical/profile)")

    def test_move_tool_formats_canonical_move_receipt(self):
        result = self.provider._tool_lore_move_node({
            "old_uri": "core://old/path",
            "new_uri": "core://requested/path",
        })
        self.assertEqual(result, "Moved: core://old/path → core://new/path")

    def test_skill_tool_schemas_registered_without_artifact_or_guidance(self):
        schemas = {tool["name"]: tool for tool in self.provider.get_tool_schemas()}
        for name in (
            "lore_skill_list",
            "lore_skill_search",
            "lore_skill_get",
            "lore_skill_create",
            "lore_skill_update",
            "lore_skill_delete",
            "lore_skill_status",
        ):
            self.assertIn(name, schemas)
        self.assertNotIn("lore_skill_artifact", schemas)
        update = schemas["lore_skill_update"]
        self.assertEqual(schemas["lore_skill_get"]["parameters"]["required"], ["skill_id"])
        self.assertEqual(update["parameters"]["required"], ["skill_id", "expected_version"])
        self.assertEqual(schemas["lore_skill_delete"]["parameters"]["required"], ["skill_id"])
        self.assertIn("skill_id", schemas["lore_skill_get"]["parameters"]["properties"])
        self.assertNotIn("id", schemas["lore_skill_get"]["parameters"]["properties"])
        self.assertNotIn("id", update["parameters"]["properties"])
        # No behavioral prompt guidance about when the agent should use skills.
        for name, tool in schemas.items():
            if name.startswith("lore_skill_"):
                desc = tool.get("description") or ""
                self.assertNotIn("you should", desc.lower())
                self.assertNotIn("always use", desc.lower())

    def test_skill_candidate_discovery_appended_even_when_memory_context_empty(self):
        class SkillAwareClient(FakeClient):
            def lifecycle_event(self, event_name, **kwargs):
                self.lifecycle_calls.append((event_name, dict(kwargs)))
                if event_name == "prompt.submit":
                    return {
                        "host_output": {
                            "mode": "return_value",
                            "value": {"context": ""},
                        },
                        "skill_catalog": {"project_id": "proj-1", "catalog_revision": "cat-9"},
                        "skill_candidates": [
                            {
                                "skill_id": "skill-1",
                                "name": "demo-skill",
                                "description": "A demo skill",
                                "version": 2,
                            }
                        ],
                    }
                return super().lifecycle_event(event_name, **kwargs)

        self.provider._client = SkillAwareClient()
        result = self.provider.prefetch("need skills", session_id="sess-1")
        self.assertIn("<lore-skills>", result)
        self.assertIn("skill_id: skill-1", result)
        self.assertIn("demo-skill", result)
        self.assertIn("lore_skill_get", result)
        self.assertEqual(self.provider._skill_project_id, "proj-1")
        self.assertEqual(self.provider._skill_catalog_revision, "cat-9")

    def test_skill_candidate_discovery_appended_to_memory_context(self):
        class SkillAwareClient(FakeClient):
            def lifecycle_event(self, event_name, **kwargs):
                self.lifecycle_calls.append((event_name, dict(kwargs)))
                if event_name == "prompt.submit":
                    return {
                        "host_output": {
                            "mode": "return_value",
                            "value": {
                                "context": (
                                    "<recall session_id=\"sess-1\" query_id=\"q1\">\n"
                                    "0.70 | core://project\n"
                                    "</recall>"
                                )
                            },
                        },
                        "skill_candidates": [
                            {"id": "skill-9", "name": "other", "expected_version": 1}
                        ],
                    }
                return super().lifecycle_event(event_name, **kwargs)

        self.provider._client = SkillAwareClient()
        result = self.provider.prefetch("hello", session_id="sess-1")
        self.assertIn("core://project", result)
        self.assertIn("<lore-skills>", result)
        self.assertIn("skill_id: skill-9", result)
        self.assertIn("version: 1", result)


class SkillClientApiTests(unittest.TestCase):
    def test_skill_client_methods_hit_skills_endpoints(self):
        client = LoreClient(base_url="http://example.com")
        requests = []

        def capture(method, path, params=None, data=None, timeout=None):
            requests.append({"method": method, "path": path, "params": params, "data": data})
            if path == "/skills" and method == "GET":
                return {"project_id": "proj-1", "catalog_revision": "r1", "skills": []}
            if path == "/skills/recall":
                return {"candidates": []}
            if path.startswith("/skills/") and method == "GET":
                return {"id": "skill-1", "name": "demo", "version": 1, "files": []}
            if path == "/skills" and method == "POST":
                return {"id": "skill-1", "name": data.get("name"), "version": 1}
            if path.startswith("/skills/") and method == "PATCH":
                return {"id": "skill-1", "name": "demo", "version": 2}
            if path.startswith("/skills/") and method == "DELETE":
                return {"project_id": "proj-1", "catalog_revision": "r2"}
            return {}

        client._request = capture

        client.list_skills(include_disabled=False)
        client.search_skills("auth", limit=5)
        client.get_skill("skill-1")
        client.create_skill({"name": "demo", "files": []})
        client.update_skill("skill-1", {"expected_version": 1, "enabled": True})
        client.delete_skill("skill-1")

        self.assertEqual(requests[0]["method"], "GET")
        self.assertEqual(requests[0]["path"], "/skills")
        self.assertEqual(requests[0]["params"]["include_disabled"], "false")
        self.assertEqual(requests[1]["path"], "/skills/recall")
        self.assertEqual(requests[1]["params"]["query"], "auth")
        self.assertEqual(requests[2]["path"], "/skills/skill-1")
        self.assertEqual(requests[3]["method"], "POST")
        self.assertEqual(requests[4]["method"], "PATCH")
        self.assertEqual(requests[4]["data"]["expected_version"], 1)
        self.assertEqual(requests[5]["method"], "DELETE")

    def test_update_skill_requires_positive_integer_expected_version(self):
        client = LoreClient(base_url="http://example.com")
        client._request = lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not call"))
        with self.assertRaises(Exception) as ctx:
            client.update_skill("skill-1", {"expected_version": 0})
        self.assertIn("expected_version", str(ctx.exception))
        with self.assertRaises(Exception):
            client.update_skill("skill-1", {"expected_version": 1.5})
        with self.assertRaises(Exception):
            client.update_skill("skill-1", {})


class SkillWorkCopyTests(unittest.TestCase):
    def setUp(self):
        from lore_memory import skill_workcopy as sw

        self.sw = sw
        self.lore_home = tempfile.mkdtemp(prefix="lore-skills-")
        self.project_id = "proj-1"

    def tearDown(self):
        # Make writable then remove (mirrors JS rmTempHome).
        import shutil
        import stat as stat_mod

        def walk(current):
            try:
                st = os.lstat(current)
                if stat_mod.S_ISDIR(st.st_mode) and not stat_mod.S_ISLNK(st.st_mode):
                    try:
                        os.chmod(current, 0o755)
                    except OSError:
                        pass
                    for entry in os.listdir(current):
                        walk(os.path.join(current, entry))
                elif stat_mod.S_ISREG(st.st_mode):
                    try:
                        os.chmod(current, 0o644)
                    except OSError:
                        pass
            except OSError:
                pass

        walk(self.lore_home)
        shutil.rmtree(self.lore_home, ignore_errors=True)

    def _skill_detail(self, **overrides):
        content = overrides.pop("content", "# Demo Skill\n\nDo the thing.\n")
        files = overrides.pop("files", None)
        if files is None:
            sha = self.sw.sha256_text(content)
            files = [{
                "path": "SKILL.md",
                "content": content,
                "sha256": sha,
                "size": len(content.encode("utf-8")),
                "media_type": "text/markdown",
            }]
        manifest_hash = overrides.pop("manifest_hash", None)
        if manifest_hash is None:
            hashed = []
            for f in files:
                if f.get("content_base64"):
                    import base64
                    buf = base64.b64decode(f["content_base64"])
                else:
                    buf = str(f.get("content") or "").encode("utf-8")
                hashed.append({
                    "path": f["path"],
                    "sha256": f.get("sha256") or self.sw.sha256_bytes(buf),
                    "size": len(buf),
                })
            manifest_hash = self.sw.compute_manifest_hash(hashed)
        detail = {
            "id": "skill-1",
            "project_id": self.project_id,
            "name": "demo-skill",
            "description": "A demo skill",
            "enabled": True,
            "version": 1,
            **overrides,
            "manifest_hash": manifest_hash,
            "files": files,
        }
        return detail

    def test_validate_safe_paths_and_managed_files(self):
        self.assertEqual(self.sw.validate_safe_relative_path("SKILL.md"), "SKILL.md")
        self.assertEqual(self.sw.validate_safe_relative_path("refs/notes.md"), "refs/notes.md")
        with self.assertRaises(Exception):
            self.sw.validate_safe_relative_path("refs/../SKILL.md")
        with self.assertRaises(Exception):
            self.sw.validate_safe_relative_path("/abs/SKILL.md")
        with self.assertRaises(Exception):
            self.sw.validate_safe_relative_path("refs\\notes.md")
        with self.assertRaises(Exception):
            self.sw.validate_managed_file_list(["SKILL.md", "SKILL.md"])
        with self.assertRaises(Exception):
            self.sw.validate_managed_file_list(["SKILL.md", self.sw.LORE_SKILL_MARKER])
        with self.assertRaises(Exception):
            self.sw.validate_managed_file_list(["a.md", "a.md/b.md"])
        with self.assertRaises(Exception):
            self.sw.validate_managed_file_list(["refs/notes.md"])
        self.assertEqual(
            self.sw.validate_managed_file_list(["refs/a.md", "SKILL.md"]),
            ["SKILL.md", "refs/a.md"],
        )

    def test_first_get_materializes_writable_work_copy(self):
        helper = "# helper\n"
        detail = self._skill_detail(files=[
            {
                "path": "SKILL.md",
                "content": "# Demo Skill\n",
                "sha256": self.sw.sha256_text("# Demo Skill\n"),
                "size": len(b"# Demo Skill\n"),
            },
            {
                "path": "refs/helper.md",
                "content": helper,
                "sha256": self.sw.sha256_text(helper),
                "size": len(helper.encode("utf-8")),
            },
        ])
        result = self.sw.materialize_skill_work_copy(
            lore_home=self.lore_home,
            project_id=self.project_id,
            detail=detail,
        )
        install_path = result["install_path"]
        self.assertTrue(os.path.isfile(os.path.join(install_path, "SKILL.md")))
        self.assertTrue(os.path.isfile(os.path.join(install_path, "refs", "helper.md")))
        self.assertTrue(os.path.isfile(os.path.join(install_path, self.sw.LORE_SKILL_MARKER)))
        marker = result["marker"]
        self.assertEqual(marker["schema"], self.sw.LORE_SKILL_SCHEMA)
        self.assertEqual(marker["project_id"], self.project_id)
        self.assertEqual(marker["skill_id"], "skill-1")
        self.assertEqual(marker["version"], 1)
        self.assertEqual(marker["managed_files"], ["SKILL.md", "refs/helper.md"])

        status = self.sw.inspect_local_work_copy(
            self.lore_home, self.project_id, "demo-skill",
            {"skill_id": "skill-1", "version": 1},
        )
        self.assertEqual(status["state"], "ready")

        # Writable: local edits must succeed without chmod.
        with open(os.path.join(install_path, "SKILL.md"), "w", encoding="utf-8") as handle:
            handle.write("# edited\n")
        with open(os.path.join(install_path, "SKILL.md"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "# edited\n")

        # ensure same version preserves edits
        ensured = self.sw.ensure_skill_work_copy(
            skill_id="skill-1",
            lore_home=self.lore_home,
            project_id=self.project_id,
            load_skill=lambda _sid: detail,
        )
        self.assertFalse(ensured["downloaded"])
        self.assertEqual(ensured["skill_md"], "# edited\n")
        self.assertEqual(ensured["skill_dir"], str(Path(install_path).resolve()))

    def test_same_version_preserves_local_edits_and_extras(self):
        detail = self._skill_detail(version=1)
        result = self.sw.materialize_skill_work_copy(
            lore_home=self.lore_home, project_id=self.project_id, detail=detail,
        )
        install_path = result["install_path"]
        with open(os.path.join(install_path, "SKILL.md"), "w", encoding="utf-8") as handle:
            handle.write("# local edit\n")
        os.makedirs(os.path.join(install_path, "outputs"), exist_ok=True)
        with open(os.path.join(install_path, "outputs", "result.json"), "w", encoding="utf-8") as handle:
            handle.write('{"ok":true}\n')

        ensured = self.sw.ensure_skill_work_copy(
            skill_id="skill-1",
            lore_home=self.lore_home,
            project_id=self.project_id,
            load_skill=lambda _sid: detail,
        )
        self.assertFalse(ensured["downloaded"])
        self.assertEqual(ensured["skill_md"], "# local edit\n")
        with open(os.path.join(install_path, "outputs", "result.json"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), '{"ok":true}\n')
        status = self.sw.inspect_local_work_copy(
            self.lore_home, self.project_id, "demo-skill", {"version": 1},
        )
        self.assertEqual(status["state"], "ready")

    def test_upgrade_replaces_managed_and_preserves_extras(self):
        v1_files = [
            {
                "path": "SKILL.md",
                "content": "# v1\n",
                "sha256": self.sw.sha256_text("# v1\n"),
                "size": len(b"# v1\n"),
            },
            {
                "path": "old.md",
                "content": "old\n",
                "sha256": self.sw.sha256_text("old\n"),
                "size": len(b"old\n"),
            },
            {
                "path": "keep-managed.md",
                "content": "keep-v1\n",
                "sha256": self.sw.sha256_text("keep-v1\n"),
                "size": len(b"keep-v1\n"),
            },
        ]
        v1 = self._skill_detail(version=1, files=v1_files)
        result = self.sw.materialize_skill_work_copy(
            lore_home=self.lore_home, project_id=self.project_id, detail=v1,
        )
        install_path = result["install_path"]
        os.makedirs(os.path.join(install_path, "agent-out"), exist_ok=True)
        with open(os.path.join(install_path, "agent-out", "notes.txt"), "w", encoding="utf-8") as handle:
            handle.write("local output\n")
        with open(os.path.join(install_path, "extra-root.md"), "w", encoding="utf-8") as handle:
            handle.write("extra\n")

        v2_files = [
            {
                "path": "SKILL.md",
                "content": "# v2\n",
                "sha256": self.sw.sha256_text("# v2\n"),
                "size": len(b"# v2\n"),
            },
            {
                "path": "keep-managed.md",
                "content": "keep-v2\n",
                "sha256": self.sw.sha256_text("keep-v2\n"),
                "size": len(b"keep-v2\n"),
            },
            {
                "path": "new.md",
                "content": "new\n",
                "sha256": self.sw.sha256_text("new\n"),
                "size": len(b"new\n"),
            },
        ]
        v2 = self._skill_detail(version=2, files=v2_files)
        upgraded = self.sw.materialize_skill_work_copy(
            lore_home=self.lore_home, project_id=self.project_id, detail=v2,
        )
        self.assertEqual(upgraded["marker"]["version"], 2)
        self.assertEqual(upgraded["marker"]["managed_files"], ["SKILL.md", "keep-managed.md", "new.md"])
        with open(os.path.join(install_path, "SKILL.md"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "# v2\n")
        with open(os.path.join(install_path, "keep-managed.md"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "keep-v2\n")
        with open(os.path.join(install_path, "new.md"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "new\n")
        self.assertFalse(os.path.exists(os.path.join(install_path, "old.md")))
        with open(os.path.join(install_path, "agent-out", "notes.txt"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "local output\n")
        with open(os.path.join(install_path, "extra-root.md"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "extra\n")

    def test_legacy_migration_preserves_unknown_local_outputs(self):
        install_path = os.path.join(self.lore_home, "skill-artifacts", self.project_id, "demo-skill")
        os.makedirs(os.path.join(install_path, "outputs"), exist_ok=True)
        with open(os.path.join(install_path, "SKILL.md"), "w", encoding="utf-8") as handle:
            handle.write("# legacy\n")
        with open(os.path.join(install_path, "unknown.txt"), "w", encoding="utf-8") as handle:
            handle.write("local\n")
        with open(os.path.join(install_path, "outputs", "report.md"), "w", encoding="utf-8") as handle:
            handle.write("report\n")
        with open(os.path.join(install_path, self.sw.LORE_SKILL_MARKER), "w", encoding="utf-8") as handle:
            json.dump({
                "schema": self.sw.LEGACY_MIRROR_SCHEMA,
                "project_id": self.project_id,
                "skill_id": "skill-1",
                "name": "demo-skill",
                "version": 1,
                "revision_hash": "legacy",
                "manifest_hash": "legacy",
                "synced_at": "",
            }, handle)

        detail = self._skill_detail(version=1, content="# legacy\n")
        result = self.sw.ensure_skill_work_copy(
            skill_id="skill-1",
            lore_home=self.lore_home,
            project_id=self.project_id,
            load_skill=lambda _sid: detail,
        )
        self.assertTrue(result["downloaded"])
        with open(os.path.join(install_path, "unknown.txt"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "local\n")
        with open(os.path.join(install_path, "outputs", "report.md"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "report\n")

    def test_failed_upgrade_rolls_back(self):
        detail = self._skill_detail(version=1, content="# original\n")
        result = self.sw.materialize_skill_work_copy(
            lore_home=self.lore_home, project_id=self.project_id, detail=detail,
        )
        install_path = result["install_path"]
        with open(os.path.join(install_path, "local-note.txt"), "w", encoding="utf-8") as handle:
            handle.write("keep me\n")
        os.makedirs(os.path.join(install_path, "conflict-path"), exist_ok=True)
        with open(os.path.join(install_path, "conflict-path", "nested.txt"), "w", encoding="utf-8") as handle:
            handle.write("nested\n")

        conflicting = self._skill_detail(
            version=2,
            files=[
                {
                    "path": "SKILL.md",
                    "content": "# v2\n",
                    "sha256": self.sw.sha256_text("# v2\n"),
                    "size": len(b"# v2\n"),
                },
                {
                    "path": "conflict-path",
                    "content": "file body\n",
                    "sha256": self.sw.sha256_text("file body\n"),
                    "size": len(b"file body\n"),
                },
            ],
        )
        with self.assertRaises(Exception):
            self.sw.materialize_skill_work_copy(
                lore_home=self.lore_home, project_id=self.project_id, detail=conflicting,
            )
        with open(os.path.join(install_path, "SKILL.md"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "# original\n")
        with open(os.path.join(install_path, "local-note.txt"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "keep me\n")
        with open(os.path.join(install_path, "conflict-path", "nested.txt"), "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "nested\n")
        marker = self.sw.read_work_copy_marker(install_path)
        self.assertEqual(marker["version"], 1)

    def test_unmanaged_and_traversal_refused(self):
        install_dir = os.path.join(self.lore_home, "skill-artifacts", self.project_id, "demo-skill")
        os.makedirs(install_dir, exist_ok=True)
        with open(os.path.join(install_dir, "SKILL.md"), "w", encoding="utf-8") as handle:
            handle.write("# local unmanaged\n")

        status = self.sw.inspect_local_work_copy(self.lore_home, self.project_id, "demo-skill")
        self.assertEqual(status["state"], "unmanaged")
        with self.assertRaises(Exception) as ctx:
            self.sw.materialize_skill_work_copy(
                lore_home=self.lore_home, project_id=self.project_id, detail=self._skill_detail(),
            )
        self.assertIn("unmanaged", str(ctx.exception).lower())

        # Replace with managed copy then poison marker with traversal.
        import shutil
        shutil.rmtree(install_dir)
        result = self.sw.materialize_skill_work_copy(
            lore_home=self.lore_home, project_id=self.project_id, detail=self._skill_detail(),
        )
        install_path = result["install_path"]
        marker_path = os.path.join(install_path, self.sw.LORE_SKILL_MARKER)
        with open(marker_path, "r", encoding="utf-8") as handle:
            marker = json.load(handle)
        marker["managed_files"] = ["SKILL.md", "../../etc/passwd"]
        with open(marker_path, "w", encoding="utf-8") as handle:
            json.dump(marker, handle)
        self.assertIsNone(self.sw.read_work_copy_marker(install_path))
        self.assertEqual(
            self.sw.inspect_local_work_copy(self.lore_home, self.project_id, "demo-skill")["state"],
            "invalid",
        )
        outside = os.path.join(self.lore_home, "skill-artifacts", "should-not-delete.txt")
        with open(outside, "w", encoding="utf-8") as handle:
            handle.write("safe\n")
        with self.assertRaises(Exception):
            self.sw.materialize_skill_work_copy(
                lore_home=self.lore_home,
                project_id=self.project_id,
                detail=self._skill_detail(version=2, content="# v2\n"),
            )
        with open(outside, "r", encoding="utf-8") as handle:
            self.assertEqual(handle.read(), "safe\n")

    def test_provider_skill_get_and_update_expected_version(self):
        provider = LoreMemoryProvider()
        detail = self._skill_detail(version=1)

        class SkillClient(FakeClient):
            def __init__(self, home, project_id, detail_payload):
                super().__init__()
                self.home = home
                self.project_id = project_id
                self.detail_payload = detail_payload
                self.update_bodies = []

            def list_skills(self, include_disabled=True):
                return {
                    "project_id": self.project_id,
                    "catalog_revision": "rev-1",
                    "skills": [{"id": "skill-1", "name": "demo-skill", "version": 1, "enabled": True}],
                }

            def get_skill(self, skill_id):
                return dict(self.detail_payload)

            def update_skill(self, skill_id, body):
                self.update_bodies.append(body)
                if not isinstance(body.get("expected_version"), int) or body["expected_version"] < 1:
                    raise LoreError("expected_version is required and must be a positive integer")
                return {"id": skill_id, "name": "demo-skill", "version": body["expected_version"] + 1}

            def create_skill(self, body):
                return {"id": "skill-1", "name": body.get("name"), "version": 1, "project_id": self.project_id}

            def delete_skill(self, skill_id):
                return {"project_id": self.project_id, "catalog_revision": "rev-2"}

            def search_skills(self, query, limit=None):
                return {"candidates": [{"skill_id": "skill-1", "name": "demo-skill", "version": 1}]}

        old_home = os.environ.get("LORE_HOME")
        os.environ["LORE_HOME"] = self.lore_home
        try:
            client = SkillClient(self.lore_home, self.project_id, detail)
            provider._client = client
            provider._session_id = "sess-1"

            listed = provider._tool_lore_skill_list({})
            self.assertIn("demo-skill", listed)
            self.assertEqual(provider._skill_project_id, self.project_id)

            got = provider._tool_lore_skill_get({"skill_id": "skill-1"})
            self.assertIn("skill_dir:", got)
            self.assertIn("# Demo Skill", got)
            self.assertIn("downloaded: True", got)

            # same version preserves
            install_path = os.path.join(
                self.lore_home, "skill-artifacts", self.project_id, "demo-skill"
            )
            with open(os.path.join(install_path, "SKILL.md"), "w", encoding="utf-8") as handle:
                handle.write("# local\n")
            got2 = provider._tool_lore_skill_get({"skill_id": "skill-1"})
            self.assertIn("downloaded: False", got2)
            self.assertIn("# local", got2)

            # expected_version validation at tool layer
            bad = provider.handle_tool_call("lore_skill_update", {"skill_id": "skill-1", "expected_version": 0})
            self.assertIn("expected_version", bad)

            ok = provider._tool_lore_skill_update({"skill_id": "skill-1", "expected_version": 1, "enabled": True})
            self.assertIn("Updated skill", ok)
            self.assertIn("skill_id: skill-1", ok)
            self.assertIn("version: 2", ok)
            self.assertEqual(client.update_bodies[-1]["expected_version"], 1)

            status = provider._tool_lore_skill_status({})
            self.assertIn("demo-skill", status)
            self.assertIn("ready", status)
        finally:
            if old_home is None:
                os.environ.pop("LORE_HOME", None)
            else:
                os.environ["LORE_HOME"] = old_home

    def test_discovery_helpers(self):
        block = self.sw.format_skill_candidate_block([
            {"skill_id": "s1", "name": "alpha", "version": 3, "description": "does  things"},
        ])
        self.assertIn("<lore-skills>", block)
        self.assertIn("skill_id: s1", block)
        self.assertIn("version: 3", block)
        self.assertIn("lore_skill_get", block)
        entries = self.sw.discovery_candidate_entries([
            {"id": "x", "name": "X", "expected_version": 1},
            {"name": "missing-id"},
        ])
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["skill_id"], "x")
        self.assertEqual(entries[0]["version"], 1)


if __name__ == "__main__":
    unittest.main()
