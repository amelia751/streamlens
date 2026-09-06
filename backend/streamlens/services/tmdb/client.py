"""Resolve a Netflix Top 10 title to TMDB poster and backdrop URLs.

The browser never sees the token. Image URLs are the public TMDB CDN and
do not carry credentials.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

TMDB = "https://api.themoviedb.org/3"
IMG = "https://image.tmdb.org/t/p"
_CACHE_TTL = 6 * 60 * 60
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _auth_headers() -> dict[str, str]:
    token = (os.environ.get("TMDB_READ_ACCESS_TOKEN") or "").strip()
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _get(path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
    query = dict(params or {})
    token = (os.environ.get("TMDB_READ_ACCESS_TOKEN") or "").strip()
    key = (os.environ.get("TMDB_API_KEY") or "").strip()
    if not token:
        if not key:
            raise RuntimeError("TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY is not set")
        query["api_key"] = key
    url = f"{TMDB}{path}"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    req = urllib.request.Request(url, headers=_auth_headers())
    with urllib.request.urlopen(req, timeout=8) as res:
        return json.loads(res.read().decode())


def _name(row: dict[str, Any]) -> str:
    return str(row.get("title") or row.get("name") or "")


def _year(row: dict[str, Any]) -> str:
    raw = str(row.get("release_date") or row.get("first_air_date") or "")
    return raw[:4]


def _pick(results: list[dict[str, Any]], title: str) -> dict[str, Any] | None:
    want = title.strip().lower()
    media = [r for r in results if r.get("media_type") in {"movie", "tv"}]
    if not media:
        media = [
            r for r in results
            if r.get("title") or r.get("name")
        ]
    exact = [r for r in media if _name(r).lower() == want]
    pool = exact or media
    pool.sort(key=lambda r: float(r.get("popularity") or 0), reverse=True)
    return pool[0] if pool else None


def _image(path: object, size: str) -> str | None:
    if not path or not isinstance(path, str) or not path.startswith("/"):
        return None
    return f"{IMG}/{size}{path}"


def title_artwork(title: str) -> dict[str, Any]:
    key = title.strip().lower()
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < _CACHE_TTL:
        return hit[1]

    empty = {
        "title": title,
        "tmdb_id": None,
        "media_type": None,
        "year": None,
        "overview": None,
        "poster_url": None,
        "backdrop_url": None,
        "vote_average": None,
    }
    if not key:
        return empty

    try:
        data = _get("/search/multi", {"query": title.strip(), "include_adult": "false"})
    except (urllib.error.URLError, TimeoutError, RuntimeError):
        return empty

    row = _pick(list(data.get("results") or []), title)
    if not row:
        _cache[key] = (now, empty)
        return empty

    art = {
        "title": _name(row) or title,
        "tmdb_id": row.get("id"),
        "media_type": row.get("media_type"),
        "year": _year(row) or None,
        "overview": row.get("overview") or None,
        "poster_url": _image(row.get("poster_path"), "w500"),
        "backdrop_url": _image(row.get("backdrop_path"), "w1280"),
        "vote_average": row.get("vote_average"),
    }
    _cache[key] = (now, art)
    return art
