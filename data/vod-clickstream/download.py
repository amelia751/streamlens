"""
Download the public UK Netflix VOD Clickstream (movies, desktop/laptop).

Source: https://www.kaggle.com/datasets/vodclickstream/netflix-audience-behaviour-uk-movies
Requires: kaggle CLI (~/.kaggle/kaggle.json)
"""
from __future__ import annotations

import subprocess
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent
DATASET = "vodclickstream/netflix-audience-behaviour-uk-movies"


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
