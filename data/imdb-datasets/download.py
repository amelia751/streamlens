"""
Download IMDb non-commercial TSV dumps (daily refresh, no key).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent
UA = "streamlens-data/0.1 (research; +local)"
BASE = "https://datasets.imdbws.com"

FILES = [
    "title.basics.tsv.gz",
    "title.episode.tsv.gz",
    "title.ratings.tsv.gz",
    "title.akas.tsv.gz",
    "title.crew.tsv.gz",
    "title.principals.tsv.gz",
    "name.basics.tsv.gz",
]


def download(url: str, dest: Path) -> None:
    print(f"GET {url}")
    cmd = [
        "curl", "-fL", "--retry", "5", "--retry-all-errors",
        "-A", UA, "-o", str(dest), url,
    ]
    subprocess.run(cmd, check=True)
    print(f"  saved {dest.name} ({dest.stat().st_size:,} bytes)")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 60)
    print("Downloading IMDb non-commercial datasets")
    print("=" * 60)

    for name in FILES:
        dest = OUTPUT_DIR / name
        download(f"{BASE}/{name}", dest)

    print("\nDone.", OUTPUT_DIR)


if __name__ == "__main__":
    main()
