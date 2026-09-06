"""
Snapshot TMDB/JustWatch watch-provider metadata and the US Netflix catalog.

Uses secrets/tmdb.env. Never prints the token.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent
ROOT = OUTPUT_DIR.parents[1]
ENV_PATH = ROOT / "secrets" / "tmdb.env"
TMDB = "https://api.themoviedb.org/3"
NETFLIX_PROVIDER_ID = 8
SLEEP_S = 0.28  # stay under ~40 req / 10s


def load_token() -> str:
    if not ENV_PATH.exists():
        raise SystemExit(f"missing {ENV_PATH}")
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("TMDB_READ_ACCESS_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("TMDB_READ_ACCESS_TOKEN not set")


def tmdb_get(token: str, path: str, params: dict | None = None) -> dict:
    qs = urllib.parse.urlencode(params or {})
    url = f"{TMDB}/{path}" + (f"?{qs}" if qs else "")
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "streamlens-data/0.1",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def write_json(name: str, payload) -> None:
    dest = OUTPUT_DIR / name
    dest.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"saved {name}", flush=True)


def discover_netflix(token: str, media: str, region: str = "US") -> list[dict]:
    rows: list[dict] = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        data = tmdb_get(
            token,
            f"discover/{media}",
            {
                "with_watch_providers": str(NETFLIX_PROVIDER_ID),
                "watch_region": region,
                "with_watch_monetization_types": "flatrate",
                "sort_by": "popularity.desc",
                "page": str(page),
            },
        )
        total_pages = min(int(data.get("total_pages") or 1), 500)
        for item in data.get("results") or []:
            rows.append(
                {
                    "tmdb_id": item.get("id"),
                    "media_type": media,
                    "title": item.get("title") or item.get("name"),
                    "original_title": item.get("original_title") or item.get("original_name"),
                    "original_language": item.get("original_language"),
                    "release_date": item.get("release_date") or item.get("first_air_date"),
                    "popularity": item.get("popularity"),
                    "vote_average": item.get("vote_average"),
                    "vote_count": item.get("vote_count"),
                    "genre_ids": item.get("genre_ids") or [],
                    "provider": "Netflix",
                    "country": region,
                    "monetization_type": "flatrate",
                }
            )
        if page == 1 or page % 25 == 0:
            print(f"  {media} {region} page {page}/{total_pages} ({len(rows)} rows)", flush=True)
        page += 1
        time.sleep(SLEEP_S)
    return rows


def main() -> None:
    token = load_token()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 60)
    print("TMDB / JustWatch snapshot")
    print("=" * 60)

    write_json("watch_regions.json", tmdb_get(token, "watch/providers/regions"))
    time.sleep(SLEEP_S)
    write_json("watch_providers_movie.json", tmdb_get(token, "watch/providers/movie"))
    time.sleep(SLEEP_S)
    write_json("watch_providers_tv.json", tmdb_get(token, "watch/providers/tv"))

    print("\nUS Netflix catalog (discover)")
    movies = discover_netflix(token, "movie")
    tv = discover_netflix(token, "tv")
    write_json("netflix_us_movies.json", movies)
    write_json("netflix_us_tv.json", tv)
    print(f"movies={len(movies)} tv={len(tv)}")
    print("\nDone.", OUTPUT_DIR)


if __name__ == "__main__":
    main()
