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
from lore_memory.client import LoreClient


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

    def test_bridge_methods_call_bridge_routes(self):
        client = LoreClient(base_url="http://example.com")
        requests = []
        client._request = lambda *args, **kwargs: {"ok": True} if not requests.append((args, kwargs)) else {}

        client.bridge_startup(
            session_id="sess-1",
            channel="hermes",
            project={"dir_name": "lore", "repo_name": "lore"},
            include_guidance=True,
        )
        client.bridge_recall(session_id="sess-1", prompt="hello")

        self.assertEqual(requests[0][0], ("POST", "/bridge/startup"))
        self.assertEqual(requests[0][1]["data"]["session_id"], "sess-1")
        self.assertEqual(requests[0][1]["data"]["channel"], "hermes")
        self.assertEqual(requests[1][0], ("POST", "/bridge/recall"))
        self.assertEqual(requests[1][1]["data"], {"session_id": "sess-1", "prompt": "hello"})
        self.assertEqual(len(requests), 2)


class FakeClient:
    def __init__(self):
        self.last_update_kwargs = None
        self.ended_session_id = None

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

    def bridge_startup(self, **kwargs):
        return {"system_context": "BRIDGE SYSTEM"}

    def bridge_recall(self, **kwargs):
        return {"context": "<recall session_id=\"sess-1\" query_id=\"q1\">\n0.70 | core://project\n</recall>"}


class LoreProviderThinAdapterTests(unittest.TestCase):
    def setUp(self):
        self.provider = LoreMemoryProvider()
        self.provider._client = FakeClient()
        self.provider._session_id = "sess-1"

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

    def test_update_tool_does_not_expose_glossary_replacement(self):
        schemas = {tool["name"]: tool for tool in self.provider.get_tool_schemas()}
        props = schemas["lore_update_node"]["parameters"]["properties"]

        self.assertNotIn("glossary", props)
        self.assertIn("glossary_add", props)
        self.assertIn("glossary_remove", props)
        self.assertNotIn("glossary fields", schemas["lore_update_node"]["description"])

    def test_initialize_uses_bridge_startup_context(self):
        import lore_memory as provider_module
        original_client = provider_module.LoreClient
        fake = FakeClient()
        provider_module.LoreClient = lambda *args, **kwargs: fake
        try:
            provider = LoreMemoryProvider()
            provider.initialize("sess-1")
        finally:
            provider_module.LoreClient = original_client

        self.assertEqual(provider.system_prompt_block(), "BRIDGE SYSTEM")

    def test_prefetch_uses_bridge_recall_context(self):
        result = self.provider.prefetch("hello", session_id="sess-1")
        self.assertIn("core://project", result)

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


if __name__ == "__main__":
    unittest.main()
