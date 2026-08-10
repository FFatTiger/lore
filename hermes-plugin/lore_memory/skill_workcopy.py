"""
Lore Skill writable work-copy core (Python).
Schema: lore.skill.workcopy.v1

Python-native equivalent of shared/skill-workcopy for Hermes (cannot import JS).
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
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence

LORE_SKILL_MARKER = ".lore-skill-marker.json"
LEGACY_LORE_SKILL_MARKER = ".lore-skill.json"
LORE_SKILL_SCHEMA = "lore.skill.workcopy.v1"
LEGACY_MIRROR_SCHEMA = "lore.skill.mirror.v1"
SKILL_MD = "SKILL.md"

WORK_FILE_MODE = 0o644
WORK_DIR_MODE = 0o755

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


def _copy_tree_no_follow(src: str, dest: str) -> None:
    st = os.lstat(src)
    if _is_symlink(st):
        raise SkillWorkCopyError(f"symbolic links are not allowed in skill work copies: {src}")
    if _is_dir(st):
        _ensure_dir(dest, WORK_DIR_MODE)
        for entry in os.listdir(src):
            from_path = os.path.join(src, entry)
            to_path = os.path.join(dest, entry)
            entry_st = os.lstat(from_path)
            if _is_symlink(entry_st):
                raise SkillWorkCopyError(
                    f"symbolic links are not allowed in skill work copies: {from_path}"
                )
            if _is_dir(entry_st):
                _copy_tree_no_follow(from_path, to_path)
            elif _is_file(entry_st):
                shutil.copyfile(from_path, to_path, follow_symlinks=False)
                try:
                    os.chmod(to_path, WORK_FILE_MODE)
                except OSError:
                    pass
            else:
                raise SkillWorkCopyError(
                    f"unsupported filesystem entry in skill work copy: {from_path}"
                )
    elif _is_file(st):
        _ensure_dir(os.path.dirname(dest), WORK_DIR_MODE)
        shutil.copyfile(src, dest, follow_symlinks=False)
        try:
            os.chmod(dest, WORK_FILE_MODE)
        except OSError:
            pass
    else:
        raise SkillWorkCopyError(f"unsupported filesystem entry in skill work copy: {src}")


def _chmod_tree_writable(root: str) -> None:
    def walk(current: str) -> None:
        st = os.lstat(current)
        if _is_symlink(st):
            return
        if _is_dir(st):
            os.chmod(current, WORK_DIR_MODE)
            for entry in os.listdir(current):
                walk(os.path.join(current, entry))
        elif _is_file(st):
            os.chmod(current, WORK_FILE_MODE)

    if _path_exists(root):
        walk(root)


def _prune_empty_parents(root: str, relative_file: str) -> None:
    segments = relative_file.split("/")
    for i in range(len(segments) - 1, 0, -1):
        dir_path = os.path.join(root, *segments[:i])
        try:
            if os.listdir(dir_path):
                return
            os.rmdir(dir_path)
        except OSError:
            return


def _list_directory_names(dir_path: str) -> List[str]:
    try:
        names = []
        for entry in os.scandir(dir_path):
            if entry.is_dir(follow_symlinks=False):
                names.append(entry.name)
        return sorted(names)
    except OSError:
        return []


def _collect_regular_relative_files(root: str, current: Optional[str] = None, out: Optional[List[str]] = None) -> List[str]:
    if current is None:
        current = root
    if out is None:
        out = []
    try:
        entries = list(os.scandir(current))
    except OSError as exc:
        raise SkillWorkCopyError(str(exc)) from exc
    for entry in entries:
        if entry.name == LORE_SKILL_MARKER and current == root:
            continue
        full = os.path.join(current, entry.name)
        if entry.is_symlink():
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            raise SkillWorkCopyError(f"symbolic links are not allowed in skill work copies: {rel}")
        if entry.is_dir(follow_symlinks=False):
            _collect_regular_relative_files(root, full, out)
        elif entry.is_file(follow_symlinks=False):
            out.append(os.path.relpath(full, root).replace(os.sep, "/"))
        else:
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            raise SkillWorkCopyError(f"unsupported filesystem entry in skill work copy: {rel}")
    return out


# ---- marker / local work copy inspection ----


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
        }
    except Exception:
        return None


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
            "message": "work copy not installed",
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
            "message": "install path exists and is not a managed work-copy directory",
        }

    marker = read_work_copy_marker(dir_path)
    if not marker:
        marker_path = os.path.join(dir_path, LORE_SKILL_MARKER)
        if _path_exists(marker_path):
            return {
                "name": skill_name,
                "state": "invalid",
                "path": dir_path,
                "message": "work-copy marker is missing, corrupt, or contains unsafe managed_files",
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
            "message": f"unsupported work-copy marker schema: {marker['schema']}",
        }
    if marker["project_id"] != project_id or marker["name"] != skill_name:
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "invalid",
            "path": dir_path,
            "version": marker["version"],
            "message": "work-copy marker identity does not match its managed path",
        }

    skill_md = os.path.join(dir_path, SKILL_MD)
    skill_md_stat = _lstat_or_none(skill_md)
    if not skill_md_stat or _is_symlink(skill_md_stat) or not _is_file(skill_md_stat):
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "invalid",
            "path": dir_path,
            "version": marker["version"],
            "message": "SKILL.md missing",
        }

    if expected.get("skill_id") and marker["skill_id"] != expected["skill_id"]:
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "invalid",
            "path": dir_path,
            "version": marker["version"],
            "message": f"skill_id mismatch: local {marker['skill_id']} vs expected {expected['skill_id']}",
        }

    if expected.get("version") is not None and str(marker["version"]) != str(expected["version"]):
        return {
            "name": skill_name,
            "skill_id": marker["skill_id"],
            "state": "outdated",
            "path": dir_path,
            "version": marker["version"],
            "message": f"version outdated: local {marker['version']} vs expected {expected['version']}",
        }

    return {
        "name": skill_name,
        "skill_id": marker["skill_id"],
        "state": "ready",
        "path": dir_path,
        "version": marker["version"],
    }


# ---- transport validation + materialize ----


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


def _previous_managed_files_for_install(
    install_path: str,
    marker: Dict[str, Any],
    next_managed_files: Optional[List[str]] = None,
) -> List[str]:
    if marker["schema"] == LORE_SKILL_SCHEMA:
        return validate_managed_file_list(marker.get("managed_files"), require_skill_md=True)
    if marker["schema"] == LEGACY_MIRROR_SCHEMA:
        incoming = set(next_managed_files or [])
        files = [
            rel for rel in _collect_regular_relative_files(install_path)
            if rel in incoming
        ]
        return validate_managed_file_list(files, require_skill_md=False)
    raise SkillWorkCopyError(f"unsupported marker schema for upgrade: {marker['schema']}")


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


def _remove_obsolete_managed_path(stage_path: str, old_path: str) -> None:
    full = os.path.join(stage_path, *old_path.split("/"))
    st = _lstat_or_none(full)
    if not st:
        return
    if _is_symlink(st):
        raise SkillWorkCopyError(f"refusing to delete symlink managed path: {old_path}")
    if _is_file(st):
        os.unlink(full)
        _prune_empty_parents(stage_path, old_path)
        return
    if _is_dir(st):
        entries = os.listdir(full)
        if not entries:
            os.rmdir(full)
            _prune_empty_parents(stage_path, old_path)
            return
        raise SkillWorkCopyError(
            f"cannot remove obsolete managed directory {old_path}: still contains local files"
        )
    raise SkillWorkCopyError(f"unsupported filesystem entry at obsolete managed path: {old_path}")


def _prepare_managed_file_destination(stage_path: str, rel_path: str) -> str:
    dest = os.path.join(stage_path, *rel_path.split("/"))
    st = _lstat_or_none(dest)
    if not st:
        _ensure_dir(os.path.dirname(dest), WORK_DIR_MODE)
        return dest
    if _is_symlink(st):
        raise SkillWorkCopyError(f"refusing to overwrite symlink managed path: {rel_path}")
    if _is_file(st):
        return dest
    if _is_dir(st):
        entries = os.listdir(dest)
        if not entries:
            os.rmdir(dest)
            _ensure_dir(os.path.dirname(dest), WORK_DIR_MODE)
            return dest
        raise SkillWorkCopyError(
            f"cannot replace managed directory {rel_path} with a file: still contains local files"
        )
    raise SkillWorkCopyError(f"refusing to overwrite non-file managed path: {rel_path}")


def materialize_skill_work_copy(
    *,
    lore_home: str,
    project_id: str,
    detail: Dict[str, Any],
) -> Dict[str, Any]:
    skill_name = sanitize_segment(str(detail.get("name") or ""))
    validated = validate_skill_payload(detail)
    files = validated["files"]
    managed_files = validate_managed_file_list([f["path"] for f in files], require_skill_md=True)
    server_version = skill_version_of(detail)
    if server_version is None:
        server_version = ""
    skill_id = skill_id_of(detail)

    install_path = skill_install_path(lore_home, project_id, skill_name)
    existing_marker = _assert_install_path_replaceable(install_path)

    previous_managed: List[str] = []
    if existing_marker:
        previous_managed = _previous_managed_files_for_install(
            install_path,
            existing_marker,
            managed_files,
        )

    staging_base = staging_root(lore_home, project_id)
    _ensure_dir(staging_base, WORK_DIR_MODE)
    stage_id = f"{skill_name}-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
    stage_path = os.path.join(staging_base, stage_id)
    final_stage = os.path.join(staging_base, f"{stage_id}.final")

    try:
        _ensure_dir(stage_path, WORK_DIR_MODE)

        if existing_marker and _path_exists(install_path):
            _copy_tree_no_follow(install_path, stage_path)

        next_managed = set(managed_files)

        for old_path in previous_managed:
            if old_path in next_managed:
                continue
            if old_path == LORE_SKILL_MARKER:
                continue
            safe = validate_safe_relative_path(old_path)
            _remove_obsolete_managed_path(stage_path, safe)

        for file in files:
            dest = _prepare_managed_file_destination(stage_path, file["path"])
            flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
            fd = os.open(dest, flags, WORK_FILE_MODE)
            try:
                os.write(fd, file["buffer"])
            finally:
                os.close(fd)
            try:
                os.chmod(dest, WORK_FILE_MODE)
            except OSError:
                pass

        from datetime import datetime, timezone

        marker = {
            "schema": LORE_SKILL_SCHEMA,
            "project_id": project_id,
            "skill_id": skill_id,
            "name": skill_name,
            "version": server_version,
            "managed_files": managed_files,
            "synced_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        marker_path = os.path.join(stage_path, LORE_SKILL_MARKER)
        with open(marker_path, "w", encoding="utf-8") as handle:
            json.dump(marker, handle, indent=2)
            handle.write("\n")
        try:
            os.chmod(marker_path, WORK_FILE_MODE)
        except OSError:
            pass

        _chmod_tree_writable(stage_path)

        if _path_exists(final_stage):
            _rmrf(final_stage)
        os.rename(stage_path, final_stage)

        installed_base = installed_root(lore_home, project_id)
        _ensure_dir(installed_base, WORK_DIR_MODE)
        backup_path = os.path.join(staging_base, f"{skill_name}.backup-{int(time.time() * 1000)}")
        if _path_exists(install_path):
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
        _chmod_tree_writable(install_path)
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
    lore_home = lore_home or resolve_lore_home()
    if not callable(load_skill):
        raise SkillWorkCopyError("ensure_skill_work_copy requires load_skill(skill_id)")
    detail = normalize_skill_detail(load_skill(skill_id))
    resolved_project_id = str(project_id or detail.get("project_id") or "").strip()
    if not resolved_project_id:
        if not callable(load_catalog):
            raise SkillWorkCopyError("unable to determine project_id for skill work copy")
        catalog = load_catalog() or {}
        resolved_project_id = str(catalog.get("project_id") or "").strip()
        if not resolved_project_id:
            raise SkillWorkCopyError("unable to determine project_id for skill work copy")
        return ensure_skill_work_copy(
            skill_id=skill_id,
            load_skill=load_skill,
            lore_home=lore_home,
            project_id=resolved_project_id,
            load_catalog=load_catalog,
        )

    skill_name = sanitize_segment(str(detail.get("name") or ""))
    server_version = skill_version_of(detail)
    resolved_skill_id = skill_id_of(detail) or skill_id
    install_path = skill_install_path(lore_home, resolved_project_id, skill_name)

    status = inspect_local_work_copy(
        lore_home,
        resolved_project_id,
        skill_name,
        {"skill_id": resolved_skill_id, "version": server_version},
    )

    if status["state"] == "unmanaged":
        raise SkillWorkCopyError(
            status.get("message") or f"unmanaged path blocks skill work copy: {install_path}",
            code="UNMANAGED_CONFLICT",
        )
    if status["state"] == "invalid":
        raise SkillWorkCopyError(
            status.get("message") or f"invalid local work copy: {install_path}",
            code="INVALID_WORK_COPY",
        )

    downloaded = False
    skill_dir = install_path
    active_marker: Optional[Dict[str, Any]] = None

    if status["state"] == "ready" and status.get("path"):
        marker = read_work_copy_marker(status["path"])
        if not marker:
            raise SkillWorkCopyError(
                f"invalid local work copy marker: {status['path']}",
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
                f"unsupported local work copy schema: {marker['schema']}",
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
        raise SkillWorkCopyError("failed to materialize skill work copy")

    if (
        active_marker["project_id"] != resolved_project_id
        or active_marker["skill_id"] != resolved_skill_id
        or active_marker["name"] != skill_name
    ):
        raise SkillWorkCopyError(
            "work copy identity mismatch after ensure: "
            f"project={active_marker['project_id']} skill={active_marker['skill_id']} name={active_marker['name']}"
        )

    skill_md_path = os.path.join(skill_dir, SKILL_MD)
    skill_md_stat = _lstat_or_none(skill_md_path)
    if not skill_md_stat or _is_symlink(skill_md_stat) or not _is_file(skill_md_stat):
        raise SkillWorkCopyError(f"SKILL.md missing or not a regular file in work copy: {skill_dir}")
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
    lines.append("Matched Lore skills. Call lore_skill_get with skill_id to materialize a local work copy.")
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
