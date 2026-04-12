#!/usr/bin/env python3
"""
Example usage of Lore Hermes Plugin
"""

from lore_hermes import LoreClient, RecallInjector


def main():
    # Initialize client
    client = LoreClient()
    
    # Check health
    print("=== Checking Lore Health ===")
    try:
        health = client.health()
        print(f"Lore is online: {health}")
    except Exception as e:
        print(f"Lore is offline: {e}")
        return
    
    # Boot memories
    print("\n=== Booting Memories ===")
    boot_data = client.boot()
    print(f"Loaded {boot_data.get('loaded', 0)}/{boot_data.get('total', 0)} core memories")
    
    # List domains
    print("\n=== Memory Domains ===")
    domains = client.list_domains()
    for domain in domains:
        print(f"- {domain.get('domain')}: {domain.get('root_count')} nodes")
    
    # Search example
    print("\n=== Search Example ===")
    results = client.search("test", limit=5)
    print(f"Found {len(results.get('results', []))} results")
    
    # Recall example
    print("\n=== Recall Example ===")
    injector = RecallInjector(client)
    recall_block = injector.inject_recall("How does the authentication work?", session_id="demo-session")
    if recall_block:
        print("Recalled memories:")
        print(recall_block)
    else:
        print("No relevant memories found")
    
    # Create memory example (commented out to avoid creating test data)
    """
    print("\n=== Creating Memory ===")
    result = client.create_node(
        domain="demo",
        parent_path="examples",
        content="This is a demo memory created by the Hermes plugin",
        priority=2,
        title="hermes_plugin_demo"
    )
    print(f"Created: {result.get('uri')}")
    """
    
    print("\n=== Done ===")


if __name__ == "__main__":
    main()
