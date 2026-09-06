"""
Download Netflix Tudum weekly Top 10 history (global, country, most-popular).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent
UA = "streamlens-data/0.1 (research; +local)"
BASE = "https://www.netflix.com/tudum/top10/data"

FILES = [
    "all-weeks-global.tsv",
    "all-weeks-countries.tsv",
    "most-popular.tsv",
]


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "curl", "-fL", "--retry", "5", "--retry-all-errors",
        "-A", UA, "-o", str(dest), url,
    ]
    subprocess.run(cmd, check=True)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 60)
    print("Downloading Netflix weekly Top 10 TSVs")
    print("=" * 60)

    for name in FILES:
        url = f"{BASE}/{name}"
        dest = OUTPUT_DIR / name
        print(f"\n{name}")
        print(f"  {url}")
        download(url, dest)
        print(f"  saved {dest.stat().st_size:,} bytes")

    print("\nDone.", OUTPUT_DIR)


if __name__ == "__main__":
    main()
