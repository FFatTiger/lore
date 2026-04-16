"""
Lore API Client - HTTP client for Lore memory system
"""

import os
import json
import urllib.request
import urllib.error
import ssl
from typing import Any, Optional, Dict, List
from urllib.parse import urlencode, urlparse, parse_qsl, urlunparse


class LoreError(Exception):
    """Lore API error"""
    def __init__(self, message: str, status: Optional[int] = None, data: Any = None):
        super().__init__(message)
        self.status = status
        self.data = data


class LoreClient:
    """HTTP client for Lore memory system"""

    DEFAULT_BASE_URL = "http://127.0.0.1:18901"
    DEFAULT_TIMEOUT = 30
    DEFAULT_DOMAIN = "core"
    CLIENT_TYPE = "hermes"
    
    def __init__(
        self,
        base_url: Optional[str] = None,
        api_token: Optional[str] = None,
        timeout: Optional[int] = None,
        default_domain: Optional[str] = None
    ):
        self.base_url = (base_url or os.getenv("LORE_BASE_URL") or self.DEFAULT_BASE_URL).rstrip("/")
        self.api_token = api_token or os.getenv("LORE_API_TOKEN") or os.getenv("API_TOKEN") or ""
        self.timeout = timeout or int(os.getenv("LORE_TIMEOUT", self.DEFAULT_TIMEOUT))
        self.default_domain = default_domain or os.getenv("LORE_DEFAULT_DOMAIN") or self.DEFAULT_DOMAIN
    
    def _get_headers(self, include_json: bool = True) -> Dict[str, str]:
        """Build request headers"""
        headers = {}
        if include_json:
            headers["Content-Type"] = "application/json"
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        return headers
    
    def _build_url(self, path: str) -> str:
        """Build full API URL"""
        if not path.startswith("/"):
            path = f"/{path}"
        url = urlparse(f"{self.base_url}/api{path}")
        query = dict(parse_qsl(url.query, keep_blank_values=True))
        query["client_type"] = self.CLIENT_TYPE
        return urlunparse(url._replace(query=urlencode(query)))
    
    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict] = None,
        data: Optional[Dict] = None,
        timeout: Optional[int] = None
    ) -> Any:
        """Make HTTP request to Lore API"""
        url = self._build_url(path)
        if params:
            parsed = urlparse(url)
            query = dict(parse_qsl(parsed.query, keep_blank_values=True))
            query.update({key: value for key, value in params.items() if value is not None})
            url = urlunparse(parsed._replace(query=urlencode(query)))
        
        headers = self._get_headers(include_json=(data is not None))
        
        req = urllib.request.Request(url, method=method, headers=headers)
        
        if data:
            req.data = json.dumps(data).encode("utf-8")
        
        timeout_val = timeout or self.timeout
        
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
            with urllib.request.urlopen(req, timeout=timeout_val, context=ctx) as response:
                body = response.read().decode("utf-8")
                if body:
                    return json.loads(body)
                return None
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8") if hasattr(e, "read") else ""
            try:
                error_data = json.loads(body) if body else None
                detail = error_data.get("detail") or error_data.get("error") or body or str(e)
            except:
                detail = body or str(e)
            raise LoreError(str(detail), status=e.code, data=error_data)
        except Exception as e:
            raise LoreError(f"Request failed: {e}")
    
    # ---- Health & Boot ----
    
    def health(self) -> Dict:
        """Check Lore server health"""
        return self._request("GET", "/health") or {}
    
    def boot(self) -> Dict:
        """Load boot memory view"""
        return self._request("GET", "/browse/boot") or {}
    
    # ---- Memory Nodes ----
    
    def get_node(self, domain: str, path: str, nav_only: bool = False) -> Dict:
        """Get a memory node by domain and path"""
        params = {"domain": domain, "path": path, "nav_only": str(nav_only).lower()}
        return self._request("GET", "/browse/node", params=params) or {}
    
    def create_node(
        self,
        domain: str,
        parent_path: str,
        content: str,
        priority: int,
        title: Optional[str] = None,
        disclosure: Optional[str] = None,
        glossary: Optional[List[str]] = None
    ) -> Dict:
        """Create a new memory node"""
        data = {
            "domain": domain,
            "parent_path": parent_path,
            "content": content,
            "priority": priority
        }
        if title:
            data["title"] = title
        if disclosure:
            data["disclosure"] = disclosure
        result = self._request("POST", "/browse/node", data=data) or {}
        node_uuid = result.get("node", {}).get("node_uuid")
        if node_uuid and glossary:
            for keyword in glossary:
                try:
                    self.add_glossary(keyword, node_uuid)
                except Exception:
                    pass
        return result
    
    def update_node(
        self,
        domain: str,
        path: str,
        content: Optional[str] = None,
        priority: Optional[int] = None,
        disclosure: Optional[str] = None,
        session_id: Optional[str] = None,
        glossary_add: Optional[List[str]] = None,
        glossary_remove: Optional[List[str]] = None
    ) -> Dict:
        """Update an existing memory node"""
        data = {}
        if content is not None:
            data["content"] = content
        if priority is not None:
            data["priority"] = priority
        if disclosure is not None:
            data["disclosure"] = disclosure
        if session_id is not None:
            data["session_id"] = session_id
        
        params = {"domain": domain, "path": path}
        result = self._request("PUT", "/browse/node", params=params, data=data) or {}
        
        if (glossary_add or glossary_remove):
            node_data = self.get_node(domain, path)
            node_uuid = node_data.get("node", {}).get("node_uuid")
            if node_uuid:
                for keyword in glossary_add or []:
                    try:
                        self.add_glossary(keyword, node_uuid)
                    except Exception:
                        pass
                for keyword in glossary_remove or []:
                    try:
                        self.remove_glossary(keyword, node_uuid)
                    except Exception:
                        pass
        return result
    
    def delete_node(self, domain: str, path: str, session_id: Optional[str] = None) -> Dict:
        """Delete a memory node"""
        params = {"domain": domain, "path": path}
        if session_id is not None:
            params["session_id"] = session_id
        return self._request("DELETE", "/browse/node", params=params) or {}
    
    def move_node(self, old_uri: str, new_uri: str) -> Dict:
        """Move/rename a memory node"""
        data = {"old_uri": old_uri, "new_uri": new_uri}
        return self._request("POST", "/browse/move", data=data) or {}
    
    # ---- Search & Recall ----
    
    def search(
        self,
        query: str,
        domain: Optional[str] = None,
        limit: int = 10,
        content_limit: int = 5,
        hybrid: bool = True
    ) -> Dict:
        """Search memories by keyword"""
        safe_limit = max(1, min(100, int(limit)))
        safe_content_limit = max(0, min(20, int(content_limit)))
        data = {
            "query": query,
            "limit": safe_limit,
            "content_limit": safe_content_limit,
            "hybrid": hybrid,
        }
        if domain:
            data["domain"] = domain
        return self._request("POST", "/browse/search", data=data) or {}
    
    def recall(self, query: str, session_id: Optional[str] = None) -> Dict:
        """Recall relevant memories for a query"""
        data = {"query": query}
        if session_id:
            data["session_id"] = session_id
        return self._request("POST", "/browse/recall", data=data) or {}
    
    # ---- Domains ----
    
    def list_domains(self) -> List[Dict]:
        """List all memory domains"""
        return self._request("GET", "/browse/domains") or []
    
    # ---- Glossary ----
    
    def add_glossary(self, keyword: str, node_uuid: str) -> Dict:
        """Add a glossary keyword to a node"""
        data = {"keyword": keyword, "node_uuid": node_uuid}
        return self._request("POST", "/browse/glossary", data=data) or {}
    
    def remove_glossary(self, keyword: str, node_uuid: str) -> Dict:
        """Remove a glossary keyword from a node"""
        data = {"keyword": keyword, "node_uuid": node_uuid}
        return self._request("DELETE", "/browse/glossary", data=data) or {}
    
    # ---- Session Tracking ----
    
    def mark_session_read(
        self,
        session_id: str,
        uri: str,
        node_uuid: Optional[str] = None,
        session_key: Optional[str] = None,
        source: str = "tool"
    ) -> Dict:
        """Mark a node as read in a session"""
        data = {"session_id": session_id, "uri": uri, "source": source}
        if node_uuid:
            data["node_uuid"] = node_uuid
        if session_key:
            data["session_key"] = session_key
        return self._request("POST", "/browse/session/read", data=data) or {}
    
    def list_session_reads(self, session_id: str) -> List[Dict]:
        """List all read nodes in a session"""
        params = {"session_id": session_id}
        return self._request("GET", "/browse/session/read", params=params) or []
    
    def clear_session_reads(self, session_id: str) -> Dict:
        """Clear session read tracking"""
        params = {"session_id": session_id}
        return self._request("DELETE", "/browse/session/read", params=params) or {}
    
    def mark_recall_used(
        self,
        query_id: str,
        session_id: str,
        node_uris: List[str],
        source: str = "tool:lore_get_node",
        success: bool = True
    ) -> Dict:
        """Mark recalled nodes as used in answer"""
        data = {
            "query_id": query_id,
            "session_id": session_id,
            "node_uris": node_uris,
            "source": source,
            "success": success
        }
        return self._request("POST", "/browse/recall/usage", data=data) or {}
    
    # ---- URI Helpers ----
    
    @staticmethod
    def parse_uri(uri: str) -> tuple:
        """Parse a memory URI into (domain, path)"""
        if "://" in uri:
            domain, path = uri.split("://", 1)
            return domain.strip(), path.strip("/")
        return "core", uri.strip("/")
    
    @staticmethod
    def build_uri(domain: str, path: str) -> str:
        """Build a memory URI from domain and path"""
        return f"{domain}://{path}"
