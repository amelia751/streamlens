"""ClickHouse Cloud control plane — the ClickPipes feeding the warehouse.

The SQL interface cannot see pipes, so this reads them from the Cloud API.
The API key stays server-side; the browser only ever sees the digest below.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass

import httpx

from streamlens.config import clickhouse_cloud_settings

REQUEST_TIMEOUT = 20.0


@dataclass
class ClickPipe:
    name: str
    state: str
    source_kind: str
    vendor: str | None
    database: str
    table: str


def _source_kind(source: dict) -> str:
    """ClickPipes tags the source by which sub-object is populated."""
    for key, value in source.items():
        if isinstance(value, dict) and value:
            return key
    return "unknown"


def _object_vendor(source: dict) -> str | None:
    """Which cloud an objectStorage pipe reads, from its type or URL host.

    Credentials stay out of this — only the type tag and the host of the
    object URL are used.
    """
    obj = source.get("objectStorage")
    if not isinstance(obj, dict) or not obj:
        return None

    raw = str(obj.get("type") or "").lower()
    if raw in {"gcs", "google", "gcp"}:
        return "gcs"
    if raw in {"s3", "aws", "amazon"}:
        return "s3"
    if "azure" in raw:
        return "azure"

    url = str(obj.get("url") or "")
    if "storage.googleapis.com" in url or url.startswith("gs://"):
        return "gcs"
    if "amazonaws.com" in url or url.startswith("s3://"):
        return "s3"
    if "blob.core.windows.net" in url:
        return "azure"
    return None


def list_clickpipes() -> list[ClickPipe]:
    settings = clickhouse_cloud_settings()
    token = base64.b64encode(
        f"{settings.api_key}:{settings.api_secret}".encode()
    ).decode()

    response = httpx.get(
        settings.clickpipes_url,
        headers={"Authorization": f"Basic {token}"},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()

    pipes = []
    for entry in response.json().get("result", []):
        destination = entry.get("destination", {})
        source = entry.get("source", {})
        pipes.append(
            ClickPipe(
                name=entry.get("name", ""),
                state=entry.get("state", "Unknown"),
                source_kind=_source_kind(source),
                vendor=_object_vendor(source),
                database=destination.get("database", ""),
                table=destination.get("table", ""),
            )
        )
    return sorted(pipes, key=lambda p: p.name)
