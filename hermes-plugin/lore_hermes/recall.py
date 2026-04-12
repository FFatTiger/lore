"""
Recall Injector - Automatic memory recall for Hermes

This module provides automatic recall injection before each user prompt,
similar to the Claude Code and OpenClaw plugins.
"""

import os
import re
from typing import Optional, List, Dict, Any
from .client import LoreClient
from .formatters import format_recall_block


class RecallInjector:
    """Automatic recall injection handler"""
    
    def __init__(self, client: Optional[LoreClient] = None):
        self.client = client or LoreClient()
        self._session_reads: Dict[str, Dict[str, Any]] = {}
        self._pending_recalls: Dict[str, Dict] = {}
    
    def extract_keywords(self, text: str, max_keywords: int = 5) -> List[str]:
        """Extract keywords from text for recall query"""
        # Remove code blocks
        text = re.sub(r'```[\s\S]*?```', '', text)
        text = re.sub(r'`[^`]+`', '', text)
        
        # Extract words (alphanumeric, Chinese, underscores)
        words = re.findall(r'[\w\u4e00-\u9fff]+', text)
        
        # Filter out common stop words
        stop_words = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
                      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
                      'would', 'could', 'should', 'may', 'might', 'must', 'shall',
                      'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in',
                      'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
                      'through', 'during', 'before', 'after', 'above', 'below',
                      'between', 'under', 'and', 'but', 'or', 'yet', 'so', 'if',
                      'because', 'although', 'though', 'while', 'where', 'when',
                      'that', 'which', 'who', 'whom', 'whose', 'what', 'this',
                      'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
                      'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its',
                      'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs'}
        
        # Count word frequency
        word_counts = {}
        for word in words:
            word_lower = word.lower()
            if len(word) > 2 and word_lower not in stop_words:
                word_counts[word_lower] = word_counts.get(word_lower, 0) + 1
        
        # Sort by frequency and return top keywords
        sorted_words = sorted(word_counts.items(), key=lambda x: x[1], reverse=True)
        return [word for word, count in sorted_words[:max_keywords]]
    
    def should_recall(self, text: str, min_length: int = 10) -> bool:
        """Check if recall should be triggered for this text"""
        # Skip very short messages
        if len(text.strip()) < min_length:
            return False
        
        # Skip system messages
        if text.strip().startswith(('/', '!', '@')):
            return False
        
        return True
    
    def inject_recall(self, user_message: str, session_id: Optional[str] = None) -> Optional[str]:
        """
        Inject recall block before processing user message
        
        Returns:
            Recall block text or None if no relevant memories
        """
        if not self.should_recall(user_message):
            return None
        
        # Use message as query (or extract keywords for longer messages)
        query = user_message.strip()
        if len(query) > 200:
            keywords = self.extract_keywords(query)
            query = ' '.join(keywords) if keywords else query[:200]
        
        try:
            data = self.client.recall(query, session_id=session_id)
            items = data.get('items', [])
            
            if not items:
                return None
            
            query_id = data.get('event_log', {}).get('query_id', '')
            
            # Store pending recall for session tracking
            if session_id:
                self._pending_recalls[session_id] = {
                    'query_id': query_id,
                    'node_uris': [item.get('uri') for item in items if item.get('uri')],
                    'created_at': __import__('time').time()
                }
            
            return format_recall_block(items, session_id, query_id)
        
        except Exception:
            return None
    
    def mark_read(self, session_id: str, uri: str, node_uuid: Optional[str] = None):
        """Mark a node as read in the session"""
        if not session_id:
            return
        
        if session_id not in self._session_reads:
            self._session_reads[session_id] = {}
        
        self._session_reads[session_id][uri] = {
            'node_uuid': node_uuid,
            'read_at': __import__('time').time()
        }
        
        # Also notify Lore server
        try:
            self.client.mark_session_read(session_id, uri, node_uuid=node_uuid)
        except:
            pass  # Best effort
    
    def get_session_reads(self, session_id: str) -> List[str]:
        """Get list of URIs read in this session"""
        return list(self._session_reads.get(session_id, {}).keys())
    
    def clear_session(self, session_id: str):
        """Clear session tracking"""
        self._session_reads.pop(session_id, None)
        self._pending_recalls.pop(session_id, None)
        
        try:
            self.client.clear_session_reads(session_id)
        except:
            pass
    
    def get_prompt_guidance(self) -> str:
        """Get prompt guidance for Lore integration"""
        return """
# Lore Memory System

You have access to a long-term memory system (Lore) that persists across sessions.

## Available Tools

- `lore_status` - Check if Lore is online
- `lore_boot` - Load core memories at session start
- `lore_get_node(uri)` - Read a specific memory
- `lore_search(query)` - Search memories by keyword
- `lore_recall(query)` - Find relevant memories for current context
- `lore_create_node(content, priority, glossary)` - Save new knowledge
- `lore_update_node(uri, content)` - Update existing memory
- `lore_delete_node(uri)` - Remove obsolete memory
- `lore_move_node(old_uri, new_uri)` - Rename/move memory
- `lore_list_domains()` - Browse memory domains

## Memory Domains

- `core://` - Identity, personality, core rules
- `preferences://` - User preferences and settings
- `project://` - Project-specific knowledge
- `workflow://` - Process and workflow documentation
- `learning://` - Accumulated learnings and insights

## Best Practices

1. **Boot at startup** - Call `lore_boot()` when session starts
2. **Recall before reply** - Use `lore_recall()` to fetch relevant context
3. **Write important facts** - Save key conclusions with `lore_create_node()`
4. **Update outdated info** - Revise memories when knowledge changes
5. **Use descriptive URIs** - e.g., `project://myapp/architecture/auth`
6. **Add glossary keywords** - Include searchable terms for better recall
7. **Set appropriate priority** - 0=core identity, 1=key facts, 2+=general

## Recall Format

Recalled memories appear as:
```
<recall session_id="..." query_id="...">
0.85 | core://soul | identity · purpose
0.72 | project://myapp/api | endpoints · auth
</recall>
```

Use these to inform your responses without explicitly mentioning them.
""".strip()
