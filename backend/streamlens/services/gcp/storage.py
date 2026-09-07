"""Object storage for the things a proposal cannot keep in a column.

Only generated stills live here, and only in the proposal bucket — never
`gs://streamlens-data`, whose `raw/` prefix is the immutable lake ClickPipes
reads from. A model-driven write path must not share an IAM boundary with
it, so the bucket is separate, uniform-access, and public-access-prevented.

This module owns key derivation, which is the reason it exists as a module
at all: the model supplies a prompt and nothing else. It never supplies,
sees, or influences a bucket, a key, a path, a URL or a content type.
"""

from __future__ import annotations

import re
import threading
import uuid

from google.cloud import storage

from streamlens.config import google_cloud_settings, proposal_settings

# Same shape the store enforces on a proposal id. Checked again here because
# this is the last point before an id becomes part of an object name, and a
# key is not the place to discover that an id had a slash in it.
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

_local = threading.local()


class StorageError(RuntimeError):
    """Raised with a message written to be read by the model."""


def _bucket() -> storage.Bucket:
    """A bucket handle bound to the calling thread.

    A `storage.Client` holds an HTTP session, and FastAPI runs sync
    endpoints on a bounded threadpool, so one per thread settles into a
    small reused pool — the same reasoning as `clickhouse.client`.
    """
    bucket = getattr(_local, "bucket", None)
    if bucket is None:
        settings = google_cloud_settings()
        settings.apply_defaults()
        client = storage.Client(project=settings.project)
        bucket = client.bucket(proposal_settings().bucket)
        _local.bucket = bucket
    return bucket


def still_key(proposal_id: str) -> tuple[str, str]:
    """A fresh (still_id, object name) for one proposal's next image.

    Derived server-side from a validated id and a random uuid, so two
    proposals cannot collide and nothing outside this process can guess or
    choose where bytes land.
    """
    if not _ID.match(proposal_id or ""):
        raise StorageError(f"{proposal_id!r} is not a proposal id")
    still_id = uuid.uuid4().hex
    return still_id, f"proposals/{proposal_id}/stills/{still_id}.png"


def put_object(key: str, data: bytes, content_type: str) -> None:
    try:
        _bucket().blob(key).upload_from_string(data, content_type=content_type)
    except Exception as exc:
        raise StorageError(f"could not write {key}: {exc}") from exc


def read_object(key: str) -> bytes:
    """The bytes at `key`, or a refusal.

    A missing object is an ordinary outcome — a row can outlive what it
    describes — so callers turn this into a 404 rather than a 500.
    """
    blob = _bucket().blob(key)
    try:
        return blob.download_as_bytes()
    except Exception as exc:
        raise StorageError(f"could not read {key}: {exc}") from exc


def exists(key: str) -> bool:
    try:
        return _bucket().blob(key).exists()
    except Exception:
        return False


def list_keys(prefix: str) -> list[str]:
    """Every object under `prefix`. Used by the garbage collector."""
    try:
        return [b.name for b in _bucket().list_blobs(prefix=prefix)]
    except Exception as exc:
        raise StorageError(f"could not list {prefix}: {exc}") from exc


def delete_object(key: str) -> None:
    try:
        _bucket().blob(key).delete()
    except Exception as exc:
        raise StorageError(f"could not delete {key}: {exc}") from exc


def delete_prefix(prefix: str) -> int:
    """Delete everything under a prefix. Returns how many objects went."""
    keys = list_keys(prefix)
    for key in keys:
        delete_object(key)
    return len(keys)
