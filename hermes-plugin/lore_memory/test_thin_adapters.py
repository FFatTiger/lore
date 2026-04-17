import sys
import types
import unittest
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


class LoreClientThinAdapterTests(unittest.TestCase):
    def test_create_node_uses_top_level_node_uuid_for_glossary(self):
        client = LoreClient(base_url="http://example.com")
        glossary_calls = []
        client._request = lambda *args, **kwargs: {
            "success": True,
            "operation": "create",
            "uri": "core://agent/profile",
            "path": "agent/profile",
            "node_uuid": "uuid-create",
        }
        client.add_glossary = lambda keyword, node_uuid: glossary_calls.append((keyword, node_uuid))

        result = client.create_node(
            domain="core",
            parent_path="agent",
            title="profile",
            content="hello",
            priority=2,
            glossary=["memory"],
        )

        self.assertEqual(result["node_uuid"], "uuid-create")
        self.assertEqual(glossary_calls, [("memory", "uuid-create")])

    def test_update_node_uses_receipt_node_uuid_without_refetch(self):
        client = LoreClient(base_url="http://example.com")
        glossary_add_calls = []
        glossary_remove_calls = []
        client._request = lambda *args, **kwargs: {
            "success": True,
            "operation": "update",
            "uri": "core://agent/profile-renamed",
            "path": "agent/profile-renamed",
            "node_uuid": "uuid-update",
        }
        client.get_node = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("get_node should not be called"))
        client.add_glossary = lambda keyword, node_uuid: glossary_add_calls.append((keyword, node_uuid))
        client.remove_glossary = lambda keyword, node_uuid: glossary_remove_calls.append((keyword, node_uuid))

        result = client.update_node(
            domain="core",
            path="agent/profile",
            content="updated",
            glossary_add=["memory"],
            glossary_remove=["archive"],
        )

        self.assertEqual(result["uri"], "core://agent/profile-renamed")
        self.assertEqual(glossary_add_calls, [("memory", "uuid-update")])
        self.assertEqual(glossary_remove_calls, [("archive", "uuid-update")])


class FakeClient:
    def parse_uri(self, uri):
        return uri.split("://", 1)[0], uri.split("://", 1)[1]

    def build_uri(self, domain, path):
        return f"{domain}://{path}"

    def create_node(self, **kwargs):
        return {"uri": "core://agent/profile", "node_uuid": "uuid-create"}

    def update_node(self, **kwargs):
        return {"uri": "core://agent/profile-renamed", "node_uuid": "uuid-update"}

    def delete_node(self, *args, **kwargs):
        return {"deleted_uri": "core://legacy/profile", "uri": "core://canonical/profile"}

    def move_node(self, *args, **kwargs):
        return {"old_uri": "core://old/path", "new_uri": "core://new/path", "uri": "core://new/path"}


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
