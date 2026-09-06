"""
Download the official Netflix Prize ratings dump from Kaggle.

Source: https://www.kaggle.com/datasets/netflix-inc/netflix-prize-data
Requires: kaggle CLI (~/.kaggle/kaggle.json)
"""
from __future__ import annotations

import subprocess
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent
DATASET = "netflix-inc/netflix-prize-data"


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 60)
    print(f"Downloading {DATASET}")
    print("=" * 60)
    subprocess.run(
        [
            "kaggle",
            "datasets",
            "download",
            "-d",
            DATASET,
            "-p",
            str(OUTPUT_DIR),
            "--unzip",
        ],
        check=True,
    )
    print("\nDone.", OUTPUT_DIR)


if __name__ == "__main__":
    main()
