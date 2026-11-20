import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def storage_root() -> Path:
    """Same STORAGE_DIR the API uses; relative paths are from the repo root."""
    configured = Path(os.environ.get("STORAGE_DIR", "storage"))
    root = configured if configured.is_absolute() else REPO_ROOT / configured
    return root.resolve()


class UnsafePathError(ValueError):
    pass


def resolve_inside(root: Path, relative: str) -> Path:
    """Resolve a client-supplied relative path, refusing anything outside root."""
    candidate = Path(relative)
    if candidate.is_absolute() or not relative.strip():
        raise UnsafePathError(f"Path must be relative to the storage directory: {relative!r}")
    resolved = (root / candidate).resolve()
    if not resolved.is_relative_to(root):
        raise UnsafePathError(f"Path escapes the storage directory: {relative!r}")
    return resolved
