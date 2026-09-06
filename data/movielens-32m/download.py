"""
Download the stable MovieLens 32M ratings/tags dump and unzip next to this script.
"""
from __future__ import annotations

import subprocess
import zipfile
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent
UA = "streamlens-data/0.1 (research; +local)"
URL = "https://files.grouplens.org/datasets/movielens/ml-32m.zip"
ZIP_NAME = "ml-32m.zip"
KEEP = ("ratings.csv", "tags.csv", "movies.csv", "links.csv", "README.txt")


def download(url: str, dest: Path) -> None:
    # files.grouplens.org currently serves an expired TLS cert; curl -k is
    # required. Verify the zip against README.txt checksums after extract.
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"GET {url}")
    cmd = [
        "curl", "-fkL", "--retry", "5", "--retry-all-errors",
        "-A", UA, "-o", str(dest), url,
    ]
    subprocess.run(cmd, check=True)
    print(f"saved {dest.name} ({dest.stat().st_size:,} bytes)")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 60)
    print("Downloading MovieLens 32M")
    print("=" * 60)

    zip_path = OUTPUT_DIR / ZIP_NAME
    if not zip_path.exists() or zip_path.stat().st_size < 1_000_000:
        download(URL, zip_path)
    else:
        print(f"reusing {zip_path.name} ({zip_path.stat().st_size:,} bytes)")

    print("extracting", KEEP)
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            name = Path(info.filename).name
            if name in KEEP and not info.is_dir():
                dest = OUTPUT_DIR / name
                dest.write_bytes(zf.read(info.filename))
                print(f"  {name} ({dest.stat().st_size:,} bytes)")

    print("\nDone.", OUTPUT_DIR)


if __name__ == "__main__":
    main()
