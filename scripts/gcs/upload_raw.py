"""
Plan (default) or upload local /data dumps into gs://streamlens-data/raw/.

Does not run GCS writes unless --apply. Never overwrites an existing object.
Skips YouTube. Skips our download.py / README.md.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
BUCKET = "streamlens-data"
PREFIX = "raw"

# (local relative glob or file, gcs prefix under raw/)
MAP = [
    ("netflix-top10/*.tsv", "netflix/top10"),
    ("netflix-what-we-watched/*.xlsx", "netflix/engagement"),
    ("netflix-prize/combined_data_*.txt", "netflix/prize"),
    ("netflix-prize/movie_titles.csv", "netflix/prize"),
    ("netflix-prize/probe.txt", "netflix/prize"),
    ("netflix-prize/qualifying.txt", "netflix/prize"),
    ("netflix-prize/README", "netflix/prize"),
    ("vod-clickstream/*.csv", "netflix/vod_clickstream"),
    ("tmdb-watch-providers/watch_regions.json", "tmdb/providers"),
    ("tmdb-watch-providers/watch_providers_*.json", "tmdb/providers"),
    ("tmdb-watch-providers/netflix_us_*.json", "tmdb/providers"),
    ("movielens-32m/ratings.csv", "movielens/ratings"),
    ("movielens-32m/movies.csv", "movielens/ratings"),
    ("movielens-32m/links.csv", "movielens/ratings"),
    ("movielens-32m/README.txt", "movielens/ratings"),
    ("movielens-32m/ml-32m.zip", "movielens/ratings"),
    ("movielens-32m/tags.csv", "movielens/tags"),
    ("movielens-tag-genome/genome-scores.csv", "movielens/genome"),
    ("movielens-tag-genome/genome-tags.csv", "movielens/genome"),
    ("movielens-tag-genome/links.csv", "movielens/genome"),
    ("movielens-tag-genome/README.txt", "movielens/genome"),
    ("movielens-tag-genome/ml-latest.zip", "movielens/genome"),
    ("imdb-datasets/*.tsv.gz", "imdb"),
]


def load_env() -> None:
    os.environ.setdefault("CLOUDSDK_CONFIG", str(ROOT / ".gcloud"))
    os.environ.setdefault(
        "GOOGLE_APPLICATION_CREDENTIALS", str(ROOT / "secrets" / "pctg-sa.json")
    )
    os.environ.setdefault("CLOUDSDK_CORE_PROJECT", "pctg-503822")
    os.environ.setdefault("CLOUDSDK_CORE_DISABLE_PROMPTS", "1")
    extra = ROOT / "secrets" / "gcs.env"
    if extra.exists():
        for line in extra.read_text().splitlines():
            if line.strip() and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def iter_pairs() -> list[tuple[Path, str]]:
    pairs: list[tuple[Path, str]] = []
    for pattern, dest in MAP:
        matches = sorted(DATA.glob(pattern))
        if not matches:
            print(f"MISSING  data/{pattern}", file=sys.stderr)
            continue
        for src in matches:
            if src.name in {"download.py", "README.md"}:
                continue
            uri = f"gs://{BUCKET}/{PREFIX}/{dest}/{src.name}"
            pairs.append((src, uri))
    return pairs


def gsutil(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["gsutil", *args], check=False)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually upload. Default is dry-run.",
    )
    args = parser.parse_args()
    load_env()

    pairs = iter_pairs()
    print(f"bucket  gs://{BUCKET}/{PREFIX}/")
    print(f"objects {len(pairs)}")
    total = 0
    for src, uri in pairs:
        total += src.stat().st_size
        print(f"  {src.relative_to(ROOT)}  →  {uri}  ({src.stat().st_size:,} B)")
    print(f"bytes   {total:,}")

    if not args.apply:
        print("\ndry-run. Pass --apply after the GCS key is in secrets/. Raw is never overwritten.")
        return

    creds = Path(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
    if not creds.exists():
        raise SystemExit(f"missing {creds}")

    for src, uri in pairs:
        probe = gsutil("-q", "stat", uri)
        if probe.returncode == 0:
            print(f"skip existing {uri}")
            continue
        print(f"cp {src.name}")
        r = gsutil("-h", "Cache-Control:no-transform", "cp", "-n", str(src), uri)
        if r.returncode != 0:
            raise SystemExit(f"gsutil cp failed for {uri}")

    print("done")


if __name__ == "__main__":
    main()
