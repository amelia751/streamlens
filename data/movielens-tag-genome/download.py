"""
Download MovieLens Tag Genome scores.

MovieLens Latest ships genome-scores.csv + genome-tags.csv (and links.csv).
The 2021 research dump (genome_2021.zip, 1.8 GB) is the paper-era matrix plus
regeneration inputs — optional via --research-2021.
"""
from __future__ import annotations

import argparse
import subprocess
import zipfile
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent
UA = "streamlens-data/0.1 (research; +local)"
LATEST_URL = "https://files.grouplens.org/datasets/movielens/ml-latest.zip"
RESEARCH_URL = "https://files.grouplens.org/datasets/movielens/genome_2021.zip"
KEEP = ("genome-scores.csv", "genome-tags.csv", "links.csv", "README.txt")


def download(url: str, dest: Path) -> None:
    # files.grouplens.org currently serves an expired TLS cert; curl -k is required.
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"GET {url}")
    cmd = [
        "curl", "-fkL", "--retry", "5", "--retry-all-errors",
        "-A", UA, "-o", str(dest), url,
    ]
    subprocess.run(cmd, check=True)
    print(f"saved {dest.name} ({dest.stat().st_size:,} bytes)")


def extract_keep(zip_path: Path) -> None:
    print("extracting", KEEP, "from", zip_path.name)
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            name = Path(info.filename).name
            if name in KEEP and not info.is_dir():
                dest = OUTPUT_DIR / name
                dest.write_bytes(zf.read(info.filename))
                print(f"  {name} ({dest.stat().st_size:,} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--research-2021",
        action="store_true",
        help="Also download genome_2021.zip (1.8 GB research dump)",
    )
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 60)
    print("Downloading MovieLens Tag Genome (from ml-latest)")
    print("=" * 60)

    latest = OUTPUT_DIR / "ml-latest.zip"
    if not latest.exists() or latest.stat().st_size < 1_000_000:
        download(LATEST_URL, latest)
    else:
        print(f"reusing {latest.name} ({latest.stat().st_size:,} bytes)")
    extract_keep(latest)

    if args.research_2021:
        research = OUTPUT_DIR / "genome_2021.zip"
        if not research.exists() or research.stat().st_size < 1_000_000:
            download(RESEARCH_URL, research)
        print(f"research dump at {research} — extract only if you need the 2021 paper inputs")

    print("\nDone.", OUTPUT_DIR)


if __name__ == "__main__":
    main()
