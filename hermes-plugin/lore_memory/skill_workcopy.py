"""
Lore Skill work-copy core (Python).
Schema: lore.skill.workcopy.v1

Python-native equivalent of shared/skill-workcopy for Hermes (cannot import JS).

Contract:
- The Core/server skill package is the source of truth.
- getSkill ensures a local work copy: it downloads the complete server package
  when missing, updates the server-managed package files when the server version
  differs, and reuses the local copy when the version matches and the managed
  files are intact.
- Server-managed package files (those listed in marker.managed_files) are
  read-only (0444 on POSIX). The installed skill directory itself stays writable
  (0755) so agents can create local outputs, artifacts, and cache files directly
  inside the same copy. Those extra local files are valid, local-only, never
  uploaded, and survive getSkill calls and version upgrades.
- Integrity/tamper checks cover ONLY the server-managed paths from the marker;
  extra local files never make a copy tampered.
- On upgrade, only obsolete server-managed paths are removed and incoming
  server-managed files are written; extra local files are preserved. If an
  obsolete managed path or a new managed path conflicts with a local artifact
  (file/dir shape or same path), the upgrade fails safely with no damage.
- No separate artifact directory and no artifact-create tool.
- No session-start bulk reconcile/download; all download/update is on-demand
  via getSkill. Recall is identity-only and never injects local paths.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import stat
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Set

LORE_SKILL_MARKER = ".lore-skill-marker.json"
LEGACY_LORE_SKILL_MARKER = ".lore-skill.json"
LORE_SKILL_SCHEMA = "lore.skill.workcopy.v1"
LEGACY_MIRROR_SCHEMA = "lore.skill.mirror.v1"
SKILL_MD = "SKILL.md"

WORK_FILE_MODE = 0o644  # staging / backup trees (writable)
WORK_DIR_MODE = 0o755  # installed directories (writable for local outputs)
READONLY_FILE_MODE = 0o444  # installed server-managed files + marker

_SEGMENT_RE = re.compile(r"^[A-Za-z0-9._-]+$")


class SkillWorkCopyError(Exception):
    """Work-copy error with optional machine-readable code."""

    def __init__(self, message: str, code: Optional[str] = None):
        super().__init__(message)
        self.code = code


# ---- path / home helpers ----


def resolve_lore_home(env: Optional[Dict[str, str]] = None) -> str:
    source = env if env is not None else os.environ
    from_env = str(source.get("LORE_HOME") or "").strip()
    if from_env:
        return str(Path(from_env).resolve())
    return str(Path.home() / ".lore")


def sanitize_segment(value: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise SkillWorkCopyError("path segment is required")
    if cleaned in (".", ".."):
        raise SkillWorkCopyError(f"invalid path segment: {cleaned}")
    if not _SEGMENT_RE.match(cleaned) or "\0" in cleaned:
        raise SkillWorkCopyError(f"invalid path segment: {cleaned}")
    return cleaned


def work_copies_root(lore_home: str) -> str:
    return str(Path(lore_home) / "skill-artifacts")


def project_work_copy_root(lore_home: str, project_id: str) -> str:
    return str(Path(work_copies_root(lore_home)) / sanitize_segment(project_id))


def skills_root(lore_home: str, project_id: str) -> str:
    """Deprecated alias for project_work_copy_root."""
    return project_work_copy_root(lore_home, project_id)


def installed_root(lore_home: str, project_id: str) -> str:
    """Deprecated alias for project_work_copy_root."""
    return project_work_copy_root(lore_home, project_id)


def staging_root(lore_home: str, project_id: str) -> str:
    return str(Path(work_copies_root(lore_home)) / ".staging" / sanitize_segment(project_id))


def skill_install_path(lore_home: str, project_id: str, skill_name: str) -> str:
    return str(Path(project_work_copy_root(lore_home, project_id)) / sanitize_segment(skill_name))


def validate_safe_relative_path(raw_path: str) -> str:
    raw = str(raw_path or "").strip()
    if "\\" in raw:
        raise SkillWorkCopyError(f"backslashes are not allowed in file paths: {raw_path}")
    if not raw:
        raise SkillWorkCopyError("file path is required")
    if raw.startswith("/") or re.match(r"^[A-Za-z]:/", raw):
        raise SkillWorkCopyError(f"absolute paths are not allowed: {raw_path}")
    if "\0" in raw:
        raise SkillWorkCopyError("null bytes are not allowed in file paths")
    # Treat Windows drive-style absolute paths without converting via Path
    if Path(raw).is_absolute():
        raise SkillWorkCopyError(f"absolute paths are not allowed: {raw_path}")
    segments = raw.split("/")
    if not segments or any(segment == "" for segment in segments):
        raise SkillWorkCopyError(f"empty path segments are not allowed: {raw_path}")
    for segment in segments:
        if segment in (".", ".."):
            raise SkillWorkCopyError(f"path traversal is not allowed: {raw_path}")
        if "\0" in segment:
            raise SkillWorkCopyError("null bytes are not allowed in file paths")
    return "/".join(segments)


def skill_id_of(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return str(value.get("skill_id") or value.get("id") or "").strip()


def skill_version_of(value: Any) -> Any:
    if not isinstance(value, dict):
        return None
    version = value.get("version")
    if version is not None and version != "":
        return version
    return value.get("expected_version")


def skill_revision_of(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    canonical = str(value.get("revision_hash") or "").strip()
    if canonical:
        return canonical
    return str(value.get("expected_revision_hash") or "").strip()


def validate_managed_file_list(
    raw_paths: Any,
    *,
    require_skill_md: bool = True,
) -> List[str]:
    if not isinstance(raw_paths, list):
        raise SkillWorkCopyError("managed_files must be an array")
    seen = set()
    out: List[str] = []
    has_skill_md = False
    for item in raw_paths:
        if not isinstance(item, str):
            raise SkillWorkCopyError("managed_files entries must be strings")
        rel = validate_safe_relative_path(item)
        if rel in (LORE_SKILL_MARKER, LEGACY_LORE_SKILL_MARKER):
            raise SkillWorkCopyError(f"{rel} may not appear in managed_files")
        if rel in seen:
            raise SkillWorkCopyError(f"duplicate managed file path: {rel}")
        seen.add(rel)
        if rel == SKILL_MD:
            has_skill_md = True
        out.append(rel)
    for rel in seen:
        segments = rel.split("/")
        for i in range(1, len(segments)):
            parent = "/".join(segments[:i])
            if parent in seen:
                raise SkillWorkCopyError(f"managed file path {rel} conflicts with parent path {parent}")
    if require_skill_md and not has_skill_md:
        raise SkillWorkCopyError("managed_files must include SKILL.md")
    return sorted(out)


def normalize_skill_file(file: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(file)
    size_bytes = file.get("size_bytes")
    if isinstance(size_bytes, (int, float)) and not isinstance(size_bytes, bool):
        out["size"] = int(size_bytes)
    sha = str(file.get("content_sha256") or file.get("sha256") or "").strip()
    if sha:
        out["sha256"] = sha
    return out


def normalize_skill_summary(value: Any) -> Dict[str, Any]:
    value = value if isinstance(value, dict) else {}
    out = dict(value)
    out["id"] = skill_id_of(value)
    out["version"] = skill_version_of(value)
    revision = skill_revision_of(value)
    if revision:
        out["revision_hash"] = revision
    if isinstance(value.get("manifest_hash"), str):
        out["manifest_hash"] = value["manifest_hash"]
    return out


def normalize_skill_detail(value: Any) -> Dict[str, Any]:
    value = value if isinstance(value, dict) else {}
    out = normalize_skill_summary(value)
    files = value.get("files")
    out["files"] = [normalize_skill_file(f) for f in files] if isinstance(files, list) else []
    return out


def normalize_skill_candidate(value: Any) -> Dict[str, Any]:
    return normalize_skill_summary(value)


def sha256_bytes(buf: bytes) -> str:
    return hashlib.sha256(buf).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))


def decode_skill_file_content(file: Dict[str, Any]) -> bytes:
    if isinstance(file.get("content_base64"), str):
        return base64.b64decode(file["content_base64"])
    if isinstance(file.get("content"), str):
        return file["content"].encode("utf-8")
    raise SkillWorkCopyError(f"skill file missing content: {file.get('path') or '(unknown)'}")


def compute_manifest_hash(files: Sequence[Dict[str, Any]]) -> str:
    normalized = []
    for f in files:
        normalized.append({
            "path": validate_safe_relative_path(str(f.get("path") or "")),
            "sha256": str(f.get("sha256") or "").lower(),
            "size": int(f["size"]) if isinstance(f.get("size"), (int, float)) and not isinstance(f.get("size"), bool) else 0,
        })
    normalized.sort(key=lambda item: item["path"])
    payload = "".join(f"{f['path']}\n{f['sha256']}\n{f['size']}\n" for f in normalized)
    return sha256_text(payload)


# ---- fs helpers ----


def _path_exists(target: str) -> bool:
    try:
        os.lstat(target)
        return True
    except OSError:
        return False


def _lstat_or_none(target: str):
    try:
        return os.lstat(target)
    except OSError:
        return None


def _is_symlink(st) -> bool:
    return stat.S_ISLNK(st.st_mode)


def _is_dir(st) -> bool:
    return stat.S_ISDIR(st.st_mode)


def _is_file(st) -> bool:
    return stat.S_ISREG(st.st_mode)


def _ensure_dir(dir_path: str, mode: int = WORK_DIR_MODE) -> None:
    os.makedirs(dir_path, mode=mode, exist_ok=True)
    try:
        os.chmod(dir_path, mode)
    except OSError:
        pass


def _make_tree_writable(root: str) -> None:
    if not _path_exists(root):
        return

    def walk(current: str) -> None:
        try:
            st = os.lstat(current)
            if _is_symlink(st):
                return
            if _is_dir(st):
                try:
                    os.chmod(current, WORK_DIR_MODE)
                except OSError:
                    pass
                for entry in os.listdir(current):
                    walk(os.path.join(current, entry))
            elif _is_file(st):
                try:
                    os.chmod(current, WORK_FILE_MODE)
                except OSError:
                    pass
        except OSError:
            pass

    walk(root)


def _rmrf(target: str) -> None:
    _make_tree_writable(target)
    shutil.rmtree(target, ignore_errors=True)
    if _path_exists(target) and not _is_dir(os.lstat(target)):
        try:
            os.unlink(target)
        except OSError:
            pass


def _list_directory_names(dir_path: str) -> List[str]:
    try:
        names = []
        for entry in os.scandir(dir_path):
            if entry.is_dir(follow_symlinks=False):
                names.append(entry.name)
        return sorted(names)
    except OSError:
        return []


def _copy_tree(src: str, dest: str) -> None:
    """Copy a directory tree (seed a fresh stage from an existing valid work copy)."""
    shutil.copytree(src, dest, symlinks=True, dirs_exist_ok=True)


def _chmod_single_writable(target: str) -> None:
    try:
        os.chmod(target, WORK_FILE_MODE)
    except OSError:
        pass


def _apply_installed_modes(dir_path: str, managed_files: Sequence[str]) -> None:
    """Installed dirs stay writable (0755); server-managed files + marker are 0444 (POSIX)."""
    try:
        os.chmod(dir_path, WORK_DIR_MODE)
    except OSError:
        pass
    marker_path = os.path.join(dir_path, LORE_SKILL_MARKER)
    try:
        os.chmod(marker_path, READONLY_FILE_MODE)
    except OSError:
        pass
    ancestor_dirs: Set[str] = set()
    for rel in managed_files:
        full = os.path.join(dir_path, *rel.split("/"))
        try:
            os.chmod(full, READONLY_FILE_MODE)
        except OSError:
            pass
        segments = rel.split("/")
        for i in range(1, len(segments)):
            ancestor_dirs.add("/".join(segments[:i]))
    for rel in ancestor_dirs:
        try:
            os.chmod(os.path.join(dir_path, *rel.split("/")), WORK_DIR_MODE)
        except OSError:
            pass


def _managed_dir_prefixes(managed_set: Set[str]) -> Set[str]:
    prefixes: Set[str] = set()
    for rel in managed_set:
        segments = rel.split("/")
        for i in range(1, len(segments)):
            prefixes.add("/".join(segments[:i]))
    return prefixes


def _conflict_error(message: str) -> SkillWorkCopyError:
    return SkillWorkCopyError(message, code="LOCAL_ARTIFACT_CONFLICT")


def _assert_managed_path_ancestors_safe(root: str, managed_files: Sequence[str]) -> None:
    """Refuse intermediate symlinks/non-directories before copy/chmod/delete operations."""
    for rel in managed_files:
        segments = rel.split("/")
        for i in range(1, len(segments)):
            ancestor = "/".join(segments[:i])
            st = _lstat_or_none(os.path.join(root, *segments[:i]))
            if st is None:
                continue
            if _is_symlink(st):
                raise _conflict_error(
                    f"managed path {rel} has symlink ancestor {ancestor}; refusing out-of-copy access"
                )
            if not _is_dir(st):
                raise _conflict_error(
                    f"managed path {rel} has non-directory ancestor {ancestor}"
                )


def _remove_obsolete_managed(
    stage_root: str,
    old_managed: Sequence[str],
    new_managed_set: Set[str],
) -> None:
    obsolete = [rel for rel in old_managed if rel not in new_managed_set]
    if not obsolete:
        return
    # Remove deepest first so nested obsolete files disappear before their parents.
    for rel in sorted(obsolete, key=lambda item: item.count("/"), reverse=True):
        full = os.path.join(stage_root, *rel.split("/"))
        st = _lstat_or_none(full)
        if st is None:
            continue
        if _is_dir(st):
            if os.listdir(full):
                raise _conflict_error(
                    f"obsolete managed path {rel} is now a non-empty local directory (local artifact)"
                )
            os.rmdir(full)
            continue
        # The old marker owns this exact path. A symlink here is tamper, not an extra.
        os.remove(full)

    # Prune empty directories that were managed ancestors (never extras).
    prefixes = _managed_dir_prefixes(set(old_managed))
    for rel in sorted(prefixes, key=lambda item: item.count("/"), reverse=True):
        full = os.path.join(stage_root, *rel.split("/"))
        st = _lstat_or_none(full)
        if st is None or not _is_dir(st):
            continue
        try:
            if not os.listdir(full):
                os.rmdir(full)
        except OSError:
            pass


def _assert_no_managed_extra_conflicts(
    stage_root: str,
    new_managed_files: Sequence[str],
    old_managed_set: Set[str],
) -> None:
    for rel in new_managed_files:
        full = os.path.join(stage_root, *rel.split("/"))
        st = _lstat_or_none(full)
        if st is not None:
            if rel in old_managed_set:
                if _is_symlink(st):
                    os.unlink(full)
                elif _is_dir(st):
                    if os.listdir(full):
                        raise _conflict_error(
                            f"managed path {rel} is now a non-empty local directory (local artifact)"
                        )
                    os.rmdir(full)
                elif not _is_file(st):
                    raise _conflict_error(
                        f"managed path {rel} is an unsupported local filesystem entry"
                    )
                # A regular file at an old managed path is overwritten below.
            elif _is_dir(st):
                raise _conflict_error(
                    f"new managed path {rel} conflicts with an existing local directory (local artifact)"
                )
            else:
                raise _conflict_error(
                    f"new managed path {rel} conflicts with an existing local file (local artifact)"
                )
        segments = rel.split("/")
        for i in range(1, len(segments)):
            ancestor = "/".join(segments[:i])
            anc_st = _lstat_or_none(os.path.join(stage_root, *ancestor.split("/")))
            if anc_st is not None and not _is_dir(anc_st):
                raise _conflict_error(
                    f"new managed path {rel} must live under {ancestor}, which is a local file (local artifact)"
                )


# ---- marker / local work-copy inspection ----


def read_work_copy_marker(dir_path: str) -> Optional[Dict[str, Any]]:
    marker_path = os.path.join(dir_path, LORE_SKILL_MARKER)
    try:
        marker_stat = os.lstat(marker_path)
        if _is_symlink(marker_stat) or not _is_file(marker_stat):
            return None
        with open(marker_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return None
        if not isinstance(data.get("schema"), str):
            return None
        if not isinstance(data.get("project_id"), str) or not data["project_id"].strip():
            return None
        if not isinstance(data.get("skill_id"), str) or not data["skill_id"].strip():
            return None
        if not isinstance(data.get("name"), str) or not data["name"].strip():
            return None
        if data.get("version") is None or data.get("version") == "":
            return None

        is_legacy = data["schema"] == LEGACY_MIRROR_SCHEMA
        is_workcopy = data["schema"] == LORE_SKILL_SCHEMA
        if not is_legacy and not is_workcopy:
            return None

        managed_files: List[str] = []
        if is_workcopy:
            try:
                managed_files = validate_managed_file_list(data.get("managed_files"), require_skill_md=True)
            except Exception:
                return None
        else:
            if data.get("managed_files") is not None:
                try:
                    managed_files = validate_managed_file_list(data.get("managed_files"), require_skill_md=False)
                except Exception:
                    return None

        return {
            "schema": data["schema"],
            "project_id": data["project_id"],
            "skill_id": data["skill_id"],
            "name": data["name"],
            "version": data["version"],
            "managed_files": managed_files,
            "synced_at": data["synced_at"] if isinstance(data.get("synced_at"), str) else "",
            "revision_hash": data["revision_hash"] if isinstance(data.get("revision_hash"), str) else None,
            "manifest_hash": data["manifest_hash"] if isinstance(data.get("manifest_hash"), str) else None,
            "readonly": data.get("readonly") is True,
        }
    except Exception:
        return None


def hash_local_skill_files(dir_path: str) -> Dict[str, Any]:
    """Hash ONLY the server-managed files listed in the marker (extras are ignored)."""
    marker = read_work_copy_marker(dir_path)
    if not marker:
        raise SkillWorkCopyError(f"missing or invalid work-copy marker: {dir_path}")
    files = []
    for rel in marker["managed_files"]:
        full = os.path.join(dir_path, *rel.split("/"))
        st = _lstat_or_none(full)
        if st is None:
            raise SkillWorkCopyError(f"missing managed file: {rel}")
        if _is_symlink(st) or not _is_file(st):
            raise SkillWorkCopyError(f"managed path is not a regular file: {rel}")
        with open(full, "rb") as handle:
            buf = handle.read()
        files.append({"path": rel, "sha256": sha256_bytes(buf), "size": len(buf)})
    return {"files": files, "manifest_hash": compute_manifest_hash(files)}


def inspect_local_work_copy(
    lore_home: str,
    project_id: str,
    skill_name: str,
    expected: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    expected = expected or {}
    dir_path = skill_install_path(lore_home, project_id, skill_name)
    root_stat = _lstat_or_none(dir_path)
    if not root_stat:
        return {
            "name": skill_name,
            "skill_id": expected.get("skill_id"),
            "state": "missing",
            "message": "mirror not installed",
        }
    if _is_symlink(root_stat):
        return {
            "name": skill_name,
            "skill_id": expected.get("skill_id"),
            "state": "unmanaged",
            "path": dir_path,
            "message": "install path is a symlink; left untouched",
        }
    if not _is_dir(root_stat):
        return {
            "name": skill_name,
            "skill_id": expected.get("skill_id"),
            "state": "unmanaged",
            "path": dir_path,
            "message": "install path exists and is not a managed mirror directory",
        }

    marker = read_work_copy_marker(dir_path)
    if not marker:
        marker_path = os.path.join(dir_path, LORE_SKILL_MARKER)
        if _path_exists(marker_path):
            return {
                "name": skill_name,
                "state": "invalid",
                "path": dir_path,
                "message": "mirror marker is missing, corrupt, or contains unsafe managed_files",
            }
        return {
            "name": skill_name,
            "state": "unmanaged",
            "path": dir_path,
            "message": f"directory exists without {LORE_SKILL_MARKER}; left untouched",
        }

    if marker["schema"] not in (LORE_SKILL_SCHEMA, LEGACY_MIRROR_SCHEMA):
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "invalid",
            "path": dir_path,
            "version": marker["version"],
            "message": f"unsupported mirror marker schema: {marker['schema']}",
        }
    if marker["project_id"] != project_id or marker["name"] != skill_name:
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "invalid",
            "path": dir_path,
            "version": marker["version"],
            "message": "mirror marker identity does not match its managed path",
        }

    skill_md = os.path.join(dir_path, SKILL_MD)
    skill_md_stat = _lstat_or_none(skill_md)
    if not skill_md_stat or _is_symlink(skill_md_stat) or not _is_file(skill_md_stat):
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "tampered",
            "path": dir_path,
            "version": marker["version"],
            "revision_hash": marker.get("revision_hash"),
            "message": "SKILL.md missing",
        }

    # Integrity: hash ONLY the managed files from the marker (extras are ignored).
    if marker.get("manifest_hash"):
        try:
            local_hash = hash_local_skill_files(dir_path)["manifest_hash"]
        except Exception as exc:
            return {
                "name": skill_name,
                "skill_id": marker["skill_id"],
                "state": "tampered",
                "path": dir_path,
                "version": marker["version"],
                "revision_hash": marker.get("revision_hash"),
                "message": str(exc) or "failed to verify managed files",
            }
        if local_hash != marker["manifest_hash"]:
            return {
                "name": skill_name,
                "skill_id": marker["skill_id"],
                "state": "tampered",
                "path": dir_path,
                "version": marker["version"],
                "revision_hash": marker.get("revision_hash"),
                "message": "managed file hashes do not match marker manifest_hash",
            }
    else:
        # Pre-manifest workcopy markers cannot be integrity-checked; rematerialize once.
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "tampered",
            "path": dir_path,
            "version": marker["version"],
            "message": "mirror marker missing manifest_hash; rematerialize required",
        }

    if expected.get("skill_id") and marker["skill_id"] != expected["skill_id"]:
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "invalid",
            "path": dir_path,
            "version": marker["version"],
            "revision_hash": marker.get("revision_hash"),
            "message": f"skill_id mismatch: local {marker['skill_id']} vs expected {expected['skill_id']}",
        }

    if expected.get("revision_hash") and marker.get("revision_hash") != expected["revision_hash"]:
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "outdated",
            "path": dir_path,
            "version": marker["version"],
            "revision_hash": marker.get("revision_hash"),
            "message": f"revision outdated: local {marker.get('revision_hash')} vs expected {expected['revision_hash']}",
        }

    if expected.get("version") is not None and str(marker["version"]) != str(expected["version"]):
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "outdated",
            "path": dir_path,
            "version": marker["version"],
            "revision_hash": marker.get("revision_hash"),
            "message": f"version outdated: local {marker['version']} vs expected {expected['version']}",
        }

    if expected.get("manifest_hash") and marker.get("manifest_hash") != expected["manifest_hash"]:
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "outdated",
            "path": dir_path,
            "version": marker["version"],
            "revision_hash": marker.get("revision_hash"),
            "message": "manifest_hash outdated",
        }

    return {
        "name": skill_name,
        "skill_id": marker["skill_id"],
        "state": "ready",
        "path": dir_path,
        "version": marker["version"],
        "revision_hash": marker.get("revision_hash"),
    }


# ---- transport validation ----


def validate_skill_payload(detail: Dict[str, Any]) -> Dict[str, Any]:
    name = str(detail.get("name") or "").strip()
    if not name:
        raise SkillWorkCopyError("skill detail missing name")
    skill_id = skill_id_of(detail)
    if not skill_id:
        raise SkillWorkCopyError("skill detail missing skill_id")

    raw_files = detail.get("files") if isinstance(detail.get("files"), list) else []
    if not raw_files:
        raise SkillWorkCopyError("skill detail has no files")

    files = []
    seen_paths = set()
    has_skill_md = False
    for file in raw_files:
        if not isinstance(file, dict):
            raise SkillWorkCopyError("skill files must be objects")
        rel = validate_safe_relative_path(str(file.get("path") or ""))
        if rel in seen_paths:
            raise SkillWorkCopyError(f"duplicate skill file path: {rel}")
        seen_paths.add(rel)
        if rel == SKILL_MD:
            has_skill_md = True
        if rel in (LORE_SKILL_MARKER, LEGACY_LORE_SKILL_MARKER):
            raise SkillWorkCopyError(f"{rel} may not be supplied as a skill file")
        buffer = decode_skill_file_content(file)
        sha = sha256_bytes(buffer)
        if file.get("sha256"):
            expected = str(file["sha256"]).lower()
            if expected != sha:
                raise SkillWorkCopyError(f"sha256 mismatch for {rel}: expected {expected}, got {sha}")
        size = file.get("size")
        if isinstance(size, (int, float)) and not isinstance(size, bool) and int(size) != len(buffer):
            raise SkillWorkCopyError(f"size mismatch for {rel}: expected {size}, got {len(buffer)}")
        files.append({
            "path": rel,
            "buffer": buffer,
            "sha256": sha,
            "media_type": file.get("media_type"),
        })
    if not has_skill_md:
        raise SkillWorkCopyError("skill must include SKILL.md")
    for rel in seen_paths:
        segments = rel.split("/")
        for i in range(1, len(segments)):
            parent = "/".join(segments[:i])
            if parent in seen_paths:
                raise SkillWorkCopyError(f"skill file path {rel} conflicts with parent file {parent}")

    server_manifest = str(detail.get("manifest_hash") or "").lower() if isinstance(detail.get("manifest_hash"), str) else ""
    manifest_hash = compute_manifest_hash([
        {"path": f["path"], "sha256": f["sha256"], "size": len(f["buffer"])}
        for f in files
    ])
    if server_manifest and server_manifest != manifest_hash:
        raise SkillWorkCopyError(f"manifest_hash mismatch: expected {server_manifest}, got {manifest_hash}")
    return {"files": files, "manifest_hash": manifest_hash}


def _assert_install_path_replaceable(install_path: str) -> Optional[Dict[str, Any]]:
    st = _lstat_or_none(install_path)
    if not st:
        return None
    if _is_symlink(st):
        raise SkillWorkCopyError(
            f"unmanaged local symlink blocks install: {install_path}",
            code="UNMANAGED_CONFLICT",
        )
    if not _is_dir(st):
        raise SkillWorkCopyError(
            f"unmanaged local file blocks install: {install_path}",
            code="UNMANAGED_CONFLICT",
        )
    marker = read_work_copy_marker(install_path)
    if not marker:
        marker_path = os.path.join(install_path, LORE_SKILL_MARKER)
        if _path_exists(marker_path):
            raise SkillWorkCopyError(
                f"invalid work-copy marker blocks install: {install_path}",
                code="INVALID_MARKER",
            )
        raise SkillWorkCopyError(
            f"unmanaged local directory blocks install: {install_path}",
            code="UNMANAGED_CONFLICT",
        )
    return marker


def materialize_skill_work_copy(
    *,
    lore_home: str,
    project_id: str,
    detail: Dict[str, Any],
) -> Dict[str, Any]:
    """Materialize (or upgrade/migrate) a local work copy from server detail.

    - Missing install: full stage + atomic move.
    - Existing managed work copy (marker with managed_files): the stage is seeded from
      the existing copy so extra local files are preserved. Obsolete managed files are
      removed, incoming managed files are written, and the marker is refreshed.
    - Legacy markers (no managed_files boundary) have no preserved extras: they are
      rematerialized fresh from server state.
    - A new managed path that conflicts with a preserved local artifact (file/dir shape
      or same path) fails safely with no damage to the installed copy.
    - Unmanaged file/symlink/directory or invalid marker: refused.
    - Installed directories are writable (0755, POSIX); server-managed files and the
      marker are 0444. Stage and backup stay writable internally.
    """
    skill_name = sanitize_segment(str(detail.get("name") or ""))
    validated = validate_skill_payload(detail)
    files = validated["files"]
    manifest_hash = validated["manifest_hash"]
    managed_files = validate_managed_file_list([f["path"] for f in files], require_skill_md=True)
    server_version = skill_version_of(detail)
    if server_version is None:
        server_version = ""
    server_revision = skill_revision_of(detail) or None
    skill_id = skill_id_of(detail)

    install_path = skill_install_path(lore_home, project_id, skill_name)
    existing_marker = _assert_install_path_replaceable(install_path)
    existing_managed = (
        existing_marker["managed_files"]
        if existing_marker and existing_marker["schema"] == LORE_SKILL_SCHEMA
        else []
    )

    # Validate before copy/chmod/delete so intermediate symlinks cannot redirect
    # marker-owned operations outside the installed work copy.
    if existing_managed:
        _assert_managed_path_ancestors_safe(install_path, existing_managed)

    staging_base = staging_root(lore_home, project_id)
    _ensure_dir(staging_base, WORK_DIR_MODE)
    stage_id = f"{skill_name}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
    stage_path = os.path.join(staging_base, stage_id)
    final_stage = os.path.join(staging_base, f"{stage_id}.final")

    try:
        _ensure_dir(stage_path, WORK_DIR_MODE)

        # Seed the stage from the existing valid managed copy (preserves local extras).
        # Legacy markers have no managed_files boundary, so build fresh instead.
        if existing_marker and existing_marker["schema"] == LORE_SKILL_SCHEMA and _path_exists(install_path):
            _copy_tree(install_path, stage_path)
            # Seeded server-managed files + marker are 0444; make them writable in the
            # stage so they can be replaced/removed. Extras keep their original modes.
            for rel in list(existing_managed) + [LORE_SKILL_MARKER]:
                seeded = os.path.join(stage_path, *rel.split("/"))
                seeded_stat = _lstat_or_none(seeded)
                if seeded_stat is not None and _is_file(seeded_stat):
                    _chmod_single_writable(seeded)

        new_managed_set = set(managed_files)
        _remove_obsolete_managed(stage_path, existing_managed, new_managed_set)
        _assert_no_managed_extra_conflicts(stage_path, managed_files, set(existing_managed))

        # Write incoming managed files.
        for file in files:
            dest = os.path.join(stage_path, *file["path"].split("/"))
            _ensure_dir(os.path.dirname(dest), WORK_DIR_MODE)
            flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
            fd = os.open(dest, flags, WORK_FILE_MODE)
            try:
                os.write(fd, file["buffer"])
            finally:
                os.close(fd)

        marker = {
            "schema": LORE_SKILL_SCHEMA,
            "project_id": project_id,
            "skill_id": skill_id,
            "name": skill_name,
            "version": server_version,
            "managed_files": managed_files,
            "revision_hash": server_revision,
            "manifest_hash": manifest_hash,
            "readonly": True,
            "synced_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        marker_path = os.path.join(stage_path, LORE_SKILL_MARKER)
        with open(marker_path, "w", encoding="utf-8") as handle:
            json.dump(marker, handle, indent=2)
            handle.write("\n")

        if _path_exists(final_stage):
            _rmrf(final_stage)
        os.rename(stage_path, final_stage)

        installed_base = installed_root(lore_home, project_id)
        _ensure_dir(installed_base, WORK_DIR_MODE)
        backup_path = os.path.join(staging_base, f"{skill_name}.backup-{int(time.time() * 1000)}")
        if _path_exists(install_path):
            # Make it writable first so legacy 0555 read-only installs can be renamed.
            _make_tree_writable(install_path)
            os.rename(install_path, backup_path)
        try:
            os.rename(final_stage, install_path)
        except Exception:
            if _path_exists(backup_path) and not _path_exists(install_path):
                try:
                    os.rename(backup_path, install_path)
                except OSError:
                    pass
            raise
        if _path_exists(backup_path):
            _rmrf(backup_path)
        _apply_installed_modes(install_path, managed_files)
        return {"installPath": install_path, "marker": marker, "install_path": install_path}
    finally:
        if _path_exists(stage_path):
            _rmrf(stage_path)
        if _path_exists(final_stage):
            _rmrf(final_stage)


def ensure_skill_work_copy(
    *,
    skill_id: str,
    load_skill: Callable[[str], Dict[str, Any]],
    lore_home: Optional[str] = None,
    project_id: Optional[str] = None,
    load_catalog: Optional[Callable[[], Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Ensure a local work copy. Rematerializes from server when missing, outdated,
    tampered, or legacy (preserving extra local files). Same version with intact
    managed files reuses the local copy. Unmanaged / invalid roots error."""
    lore_home = lore_home or resolve_lore_home()
    if not callable(load_skill):
        raise SkillWorkCopyError("ensure_skill_work_copy requires load_skill(skill_id)")
    detail = normalize_skill_detail(load_skill(skill_id))
    resolved_project_id = str(project_id or detail.get("project_id") or "").strip()
    if not resolved_project_id:
        if not callable(load_catalog):
            raise SkillWorkCopyError("unable to determine project_id for skill mirror")
        catalog = load_catalog() or {}
        resolved_project_id = str(catalog.get("project_id") or "").strip()
        if not resolved_project_id:
            raise SkillWorkCopyError("unable to determine project_id for skill mirror")
        return ensure_skill_work_copy(
            skill_id=skill_id,
            load_skill=load_skill,
            lore_home=lore_home,
            project_id=resolved_project_id,
            load_catalog=load_catalog,
        )

    skill_name = sanitize_segment(str(detail.get("name") or ""))
    server_version = skill_version_of(detail)
    server_revision = skill_revision_of(detail) or None
    server_manifest = detail.get("manifest_hash") if isinstance(detail.get("manifest_hash"), str) else None
    resolved_skill_id = skill_id_of(detail) or skill_id
    install_path = skill_install_path(lore_home, resolved_project_id, skill_name)

    status = inspect_local_work_copy(
        lore_home,
        resolved_project_id,
        skill_name,
        {
            "skill_id": resolved_skill_id,
            "version": server_version,
            "revision_hash": server_revision,
            "manifest_hash": server_manifest,
        },
    )

    if status["state"] == "unmanaged":
        raise SkillWorkCopyError(
            status.get("message") or f"unmanaged path blocks skill mirror: {install_path}",
            code="UNMANAGED_CONFLICT",
        )
    if status["state"] == "invalid":
        raise SkillWorkCopyError(
            status.get("message") or f"invalid local mirror: {install_path}",
            code="INVALID_WORK_COPY",
        )

    downloaded = False
    skill_dir = install_path
    active_marker: Optional[Dict[str, Any]] = None

    if status["state"] == "ready" and status.get("path"):
        marker = read_work_copy_marker(status["path"])
        if not marker:
            raise SkillWorkCopyError(
                f"invalid local mirror marker: {status['path']}",
                code="INVALID_WORK_COPY",
            )
        if marker["schema"] == LEGACY_MIRROR_SCHEMA:
            result = materialize_skill_work_copy(
                lore_home=lore_home,
                project_id=resolved_project_id,
                detail=detail,
            )
            skill_dir = result["install_path"]
            active_marker = result["marker"]
            downloaded = True
        elif marker["schema"] == LORE_SKILL_SCHEMA:
            skill_dir = status["path"]
            active_marker = marker
            downloaded = False
        else:
            raise SkillWorkCopyError(
                f"unsupported local mirror schema: {marker['schema']}",
                code="INVALID_WORK_COPY",
            )
    else:
        result = materialize_skill_work_copy(
            lore_home=lore_home,
            project_id=resolved_project_id,
            detail=detail,
        )
        skill_dir = result["install_path"]
        active_marker = result["marker"]
        downloaded = True

    if not active_marker:
        raise SkillWorkCopyError("failed to materialize skill mirror")

    if (
        active_marker["project_id"] != resolved_project_id
        or active_marker["skill_id"] != resolved_skill_id
        or active_marker["name"] != skill_name
    ):
        raise SkillWorkCopyError(
            "mirror identity mismatch after ensure: "
            f"project={active_marker['project_id']} skill={active_marker['skill_id']} name={active_marker['name']}"
        )

    skill_md_path = os.path.join(skill_dir, SKILL_MD)
    skill_md_stat = _lstat_or_none(skill_md_path)
    if not skill_md_stat or _is_symlink(skill_md_stat) or not _is_file(skill_md_stat):
        raise SkillWorkCopyError(f"SKILL.md missing or not a regular file in mirror: {skill_dir}")
    with open(skill_md_path, "r", encoding="utf-8") as handle:
        skill_md = handle.read()
    return {
        "skill_dir": str(Path(skill_dir).resolve()),
        "skill_md": skill_md,
        "skill_md_path": str(Path(skill_md_path).resolve()),
        "marker": active_marker,
        "project_id": resolved_project_id,
        "skill": detail,
        "server_version": server_version,
        "local_version": active_marker["version"],
        "downloaded": downloaded,
    }


def list_local_work_copy_statuses(lore_home: str, project_id: str) -> List[Dict[str, Any]]:
    if not project_id:
        return []
    return [
        inspect_local_work_copy(lore_home, project_id, name)
        for name in _list_directory_names(installed_root(lore_home, project_id))
    ]


def list_all_local_work_copy_statuses(lore_home: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    root = work_copies_root(lore_home)
    for project_id in _list_directory_names(root):
        if project_id == ".staging":
            continue
        for status in list_local_work_copy_statuses(lore_home, project_id):
            out.append({"project_id": project_id, **status})
    return out


# ---- discovery helpers (no download / no local path) ----


def discovery_candidate_entries(candidates: Sequence[Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for candidate in candidates or []:
        if not isinstance(candidate, dict):
            continue
        name = str(candidate.get("name") or "").strip()
        skill_id = skill_id_of(candidate)
        if not name or not skill_id:
            continue
        entry: Dict[str, Any] = {
            "skill_id": skill_id,
            "name": name,
            "version": skill_version_of(candidate),
        }
        if isinstance(candidate.get("description"), str):
            entry["description"] = candidate["description"]
        out.append(entry)
    return out


def format_skill_candidate_block(candidates: Sequence[Dict[str, Any]]) -> str:
    if not candidates:
        return ""
    lines = ["<lore-skills>"]
    lines.append(
        "Matched Lore skills. Call lore_skill_get with skill_id to fetch a local copy; "
        "managed package files are read-only, and the skill directory stays writable for local outputs."
    )
    for c in candidates:
        skill_id = str(c.get("skill_id") or skill_id_of(c) or "").strip()
        name = str(c.get("name") or "").strip()
        if not skill_id or not name:
            continue
        version_raw = skill_version_of(c)
        version = "" if version_raw is None or version_raw == "" else f" v{version_raw}"
        desc = ""
        if isinstance(c.get("description"), str) and c["description"].strip():
            desc = " — " + " ".join(c["description"].split())
        lines.append(f"- {name}{version}{desc}")
        lines.append(f"  skill_id: {skill_id}")
        if version_raw is not None and version_raw != "":
            lines.append(f"  version: {version_raw}")
    lines.append("</lore-skills>")
    # Need header + instruction + at least one candidate pair + closer
    if len(lines) <= 3:
        return ""
    return "\n".join(lines)


def read_skill_catalog(lifecycle_response: Any) -> Optional[Dict[str, str]]:
    if not isinstance(lifecycle_response, dict):
        return None
    catalog = lifecycle_response.get("skill_catalog")
    if not isinstance(catalog, dict):
        return None
    project_id = str(catalog.get("project_id") or "").strip()
    if not project_id:
        return None
    return {
        "project_id": project_id,
        "catalog_revision": str(catalog.get("catalog_revision") or ""),
    }


def read_skill_candidates(lifecycle_response: Any) -> List[Dict[str, Any]]:
    if not isinstance(lifecycle_response, dict):
        return []
    raw = lifecycle_response.get("skill_candidates")
    if not isinstance(raw, list):
        return []
    return [
        normalize_skill_candidate(item)
        for item in raw
        if isinstance(item, dict)
    ]
