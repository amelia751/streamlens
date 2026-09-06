"""
Poll the Netflix-operated YouTube channels and write straight to ClickHouse.

Unlike every other source in /data, YouTube does not land in
gs://streamlens-data/raw/. The raw zone is immutable; the YouTube API Developer
Policies require public API data to be deleted or refreshed within 30 days.
Nothing is written to disk here.

    python3 scripts/youtube/sync.py --plan          # quota estimate, no calls
    python3 scripts/youtube/sync.py --backfill      # first run: crawl uploads
    python3 scripts/youtube/sync.py                 # incremental cycle

Needs secrets/youtube.env and secrets/clickhouse.env.
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = Path(__file__).resolve().parent / "channels.json"
API = "https://www.googleapis.com/youtube/v3/"
RSS = "https://www.youtube.com/feeds/videos.xml?channel_id="
UA = "streamlens-data/0.1 (research; +local)"
DB = "youtube"

# Refresh cadence by age. Cold is 21 days rather than 30 so a row is always
# renewed before its TTL fires -- that is what keeps the catalogue alive and
# compliant at the same time.
HOT_DAYS, WARM_DAYS = 7, 90
WARM_EVERY_H, COLD_EVERY_H = 24, 21 * 24

NETFLIX_TITLE = re.compile(r"netflix\.com/(?:[a-z\-]+/)?title/(\d+)", re.I)
ISO_DUR = re.compile(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")

# stats_flags bits
F_VIEWS_HIDDEN, F_LIKES_HIDDEN, F_COMMENTS_OFF = 1, 2, 4
F_MADE_FOR_KIDS, F_NOT_EMBEDDABLE = 8, 16

quota_used = 0


# --------------------------------------------------------------------------
# env + transport
# --------------------------------------------------------------------------

def load_env() -> None:
    for name in ("youtube.env", "clickhouse.env"):
        path = ROOT / "secrets" / name
        if not path.exists():
            raise SystemExit(f"missing {path}")
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def yt(endpoint: str, **params) -> dict:
    """One YouTube Data API call. Every call costs 1 unit, including failures."""
    global quota_used
    params["key"] = os.environ["YOUTUBE_API_KEY"]
    url = f"{API}{endpoint}?{urllib.parse.urlencode(params)}"
    for attempt in range(5):
        quota_used += 1
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:300]
            if e.code == 403 and "quotaExceeded" in body:
                raise SystemExit(f"quota exhausted after {quota_used} units")
            if e.code in (429, 500, 503) and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            raise SystemExit(f"{endpoint} HTTP {e.code}: {body}")
    raise SystemExit(f"{endpoint} failed")


def ch(sql: str, body: bytes | None = None, token: str | None = None) -> str:
    """Query or insert over the ClickHouse HTTPS interface."""
    params = {"query": sql, "database": DB}
    if token:
        # Retries of the same logical batch collapse to one write. Takes
        # priority over the data hash, and is tracked per partition.
        params["insert_deduplication_token"] = token
    url = f"https://{os.environ['CLICKHOUSE_HOST']}:8443/?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "X-ClickHouse-User": os.environ["CLICKHOUSE_USER"],
            "X-ClickHouse-Key": os.environ["CLICKHOUSE_PASSWORD"],
            **({"Content-Encoding": "gzip"} if body else {}),
        },
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read().decode()
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:400]
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(2 ** attempt)
                continue
            raise SystemExit(f"clickhouse HTTP {e.code}: {detail}")
    raise SystemExit("clickhouse failed")


def insert(table: str, rows: list[dict], token: str) -> None:
    if not rows:
        return
    payload = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows).encode()
    ch(f"INSERT INTO {DB}.{table} FORMAT JSONEachRow", gzip.compress(payload), token)
    print(f"  -> {len(rows):,} rows into {table}")


# --------------------------------------------------------------------------
# parsing
# --------------------------------------------------------------------------

def ts(iso: str | None) -> str:
    if not iso:
        return "1970-01-01 00:00:00"
    return (
        datetime.fromisoformat(iso.replace("Z", "+00:00"))
        .astimezone(timezone.utc)
        .strftime("%Y-%m-%d %H:%M:%S")
    )


def duration_s(iso: str | None) -> int:
    if not iso:
        return 0
    m = ISO_DUR.fullmatch(iso)
    if not m:
        return 0
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


def count_or_none(stats: dict, key: str) -> int | None:
    """The API omits the field entirely when a creator hides the metric.

    Absent is not zero. Collapsing the two manufactures a huge negative delta
    the moment someone hides likes, so this stays None and the caller records
    the reason in stats_flags.
    """
    v = stats.get(key)
    return int(v) if v is not None else None


def netflix_title_id(description: str) -> int:
    m = NETFLIX_TITLE.search(description or "")
    return int(m.group(1)) if m else 0


# --------------------------------------------------------------------------
# discovery -- RSS costs zero quota
# --------------------------------------------------------------------------

def rss_video_ids(channel_id: str) -> list[str]:
    """Newest ~15 uploads for a channel. Free; no API units consumed."""
    ns = {"a": "http://www.w3.org/2005/Atom",
          "yt": "http://www.youtube.com/xml/schemas/2015"}
    try:
        req = urllib.request.Request(RSS + channel_id, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            tree = ET.fromstring(r.read())
    except Exception:
        return []          # caller falls back to playlistItems
    return [e.findtext("yt:videoId", namespaces=ns) for e in tree.findall("a:entry", ns)]


def uploads_crawl(playlist_id: str, limit: int | None = None) -> list[str]:
    """Full upload history. 1 unit per 50 videos."""
    ids, token = [], None
    while True:
        params = {"part": "contentDetails", "playlistId": playlist_id, "maxResults": 50}
        if token:
            params["pageToken"] = token
        page = yt("playlistItems", **params)
        ids += [i["contentDetails"]["videoId"] for i in page.get("items", [])]
        token = page.get("nextPageToken")
        if not token or (limit and len(ids) >= limit):
            return ids[:limit] if limit else ids


# --------------------------------------------------------------------------
# hydrate + write
# --------------------------------------------------------------------------

def hydrate(video_ids: list[str], run_id: str) -> tuple[list[dict], list[dict]]:
    """videos.list batched 50 IDs to a call. Returns (dimension, snapshot) rows."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    dims: list[dict] = []
    stats: list[dict] = []
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i + 50]
        page = yt("videos", part="snippet,contentDetails,statistics,status",
                  id=",".join(batch), maxResults=50)
        for v in page.get("items", []):
            sn = v.get("snippet", {})
            cd = v.get("contentDetails", {})
            st = v.get("statistics", {})
            stat = v.get("status", {})
            desc = sn.get("description") or ""

            flags = 0
            if "viewCount" not in st:
                flags |= F_VIEWS_HIDDEN
            if "likeCount" not in st:
                flags |= F_LIKES_HIDDEN
            if "commentCount" not in st:
                flags |= F_COMMENTS_OFF
            if stat.get("madeForKids"):
                flags |= F_MADE_FOR_KIDS
            if stat.get("embeddable") is False:
                flags |= F_NOT_EMBEDDABLE

            dims.append({
                "video_id": v["id"],
                "fetched_at": now,
                "channel_id": sn.get("channelId", ""),
                "title": sn.get("title") or "",
                "description": desc,
                "tags": sn.get("tags") or [],
                "published_at": ts(sn.get("publishedAt")),
                "category_id": sn.get("categoryId") or "",
                "default_language": sn.get("defaultLanguage") or "",
                "default_audio_language": sn.get("defaultAudioLanguage") or "",
                "duration_s": duration_s(cd.get("duration")),
                "definition": cd.get("definition") or "",
                "has_caption": 1 if cd.get("caption") == "true" else 0,
                "live_content": sn.get("liveBroadcastContent") or "none",
                "made_for_kids": 1 if stat.get("madeForKids") else 0,
                "privacy_status": stat.get("privacyStatus") or "",
                "netflix_title_id": netflix_title_id(desc),
                "is_deleted": 0,
            })
            stats.append({
                "video_id": v["id"],
                "snapshot_ts": now,
                "channel_id": sn.get("channelId", ""),
                "view_count": count_or_none(st, "viewCount"),
                "like_count": count_or_none(st, "likeCount"),
                "comment_count": count_or_none(st, "commentCount"),
                "stats_flags": flags,
                "fetch_run_id": run_id,
            })
    return dims, stats


def sync_channels(registry: dict, run_id: str) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    by_id = {c["channel_id"]: c for c in registry["channels"]}
    ids = list(by_id)
    dims, stats = [], []
    for i in range(0, len(ids), 50):
        page = yt("channels", part="snippet,statistics,contentDetails",
                  id=",".join(ids[i:i + 50]), maxResults=50)
        for c in page.get("items", []):
            reg = by_id[c["id"]]
            sn, st = c.get("snippet", {}), c.get("statistics", {})
            dims.append({
                "channel_id": c["id"], "fetched_at": now,
                "handle": reg["handle"], "kind": reg["kind"],
                "market": reg["market"], "primary_language": reg["primary_language"],
                "title": sn.get("title") or "",
                "description": sn.get("description") or "",
                "reported_country": sn.get("country") or "",
                "published_at": ts(sn.get("publishedAt")),
                "uploads_playlist_id": reg["uploads_playlist_id"],
                "is_deleted": 0,
            })
            stats.append({
                "channel_id": c["id"], "snapshot_ts": now,
                "subscriber_count": count_or_none(st, "subscriberCount"),
                "view_count": count_or_none(st, "viewCount"),
                "video_count": count_or_none(st, "videoCount"),
                "stats_flags": F_VIEWS_HIDDEN if st.get("hiddenSubscriberCount") else 0,
                "fetch_run_id": run_id,
            })
    insert("channel", dims, f"{run_id}-channel")
    insert("channel_stats", stats, f"{run_id}-channel-stats")


# --------------------------------------------------------------------------
# tier selection -- ClickHouse itself is the state store, no external cursor
# --------------------------------------------------------------------------

def due_video_ids() -> list[str]:
    sql = f"""
    SELECT video_id FROM (
        SELECT
            v.video_id AS video_id,
            dateDiff('day', v.published_at, now()) AS age_d,
            dateDiff('hour', max(s.snapshot_ts), now()) AS since_h
        FROM {DB}.video AS v FINAL
        LEFT JOIN {DB}.video_stats AS s USING (video_id)
        GROUP BY v.video_id, v.published_at
    )
    WHERE age_d <= {HOT_DAYS}
       OR (age_d <= {WARM_DAYS} AND since_h >= {WARM_EVERY_H})
       OR (age_d >  {WARM_DAYS} AND since_h >= {COLD_EVERY_H})
    FORMAT TSVRaw
    """
    return [x for x in ch(sql).split("\n") if x.strip()]


def plan(registry: dict) -> None:
    videos = sum(c["videos_at_pin"] for c in registry["channels"])
    calls = -(-videos // 50)
    print(f"channels        {len(registry['channels'])}")
    print(f"videos at pin   {videos:,}")
    print()
    print("one-time backfill")
    print(f"  playlistItems {calls:,} units")
    print(f"  videos.list   {calls:,} units")
    print(f"  total         {2 * calls:,} units  ({2 * calls / 10000:.2f} days of quota)")
    print()
    cold_daily = -(-(videos // 21) // 50)
    print("steady state per day (4 cycles)")
    print(f"  discovery     0 units (RSS)")
    print(f"  channels      4 units")
    print(f"  hot+warm      ~{4 * 6 + 60} units")
    print(f"  cold renewal  ~{cold_daily} units")
    print(f"  total         ~{4 + 4 * 6 + 60 + cold_daily} units of 10,000")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true", help="quota estimate, no API calls")
    ap.add_argument("--backfill", action="store_true", help="crawl full upload history")
    ap.add_argument("--limit-per-channel", type=int, default=None)
    args = ap.parse_args()

    registry = json.loads(REGISTRY.read_text())
    if args.plan:
        plan(registry)
        return

    load_env()
    run_id = str(uuid.uuid4())
    started = time.time()
    print(f"run {run_id}")

    sync_channels(registry, run_id)

    if args.backfill:
        targets: list[str] = []
        for c in registry["channels"]:
            ids = uploads_crawl(c["uploads_playlist_id"], args.limit_per_channel)
            print(f"  {c['handle']:28s} {len(ids):>6,} videos")
            targets += ids
    else:
        seen: list[str] = []
        for c in registry["channels"]:
            ids = rss_video_ids(c["channel_id"])
            if not ids:
                ids = uploads_crawl(c["uploads_playlist_id"], 50)
            seen += ids
        due = due_video_ids()
        targets = list(dict.fromkeys(seen + due))
        print(f"  discovery {len(seen)} via RSS (0 units), {len(due)} due for refresh")

    print(f"hydrating {len(targets):,} videos")
    dims, stats = hydrate(targets, run_id)
    insert("video", dims, f"{run_id}-video")
    insert("video_stats", stats, f"{run_id}-video-stats")

    linked = sum(1 for d in dims if d["netflix_title_id"])
    print(f"\nquota {quota_used} units | {time.time() - started:.0f}s")
    print(f"netflix_title_id on {linked:,}/{len(dims):,} videos")


if __name__ == "__main__":
    main()
