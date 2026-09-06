"""
Download Netflix What We Watched engagement workbooks.

Each About Netflix article page embeds a Contentful .xlsx link. We scrape
those pages and save the workbooks next to this script.
"""
from __future__ import annotations

import re
import urllib.request
from pathlib import Path

OUTPUT_DIR = Path(__file__).resolve().parent
UA = "streamlens-data/0.1 (research; +local)"
XLSX_RE = re.compile(r"https://assets\.ctfassets\.net/[^\"']+\.xlsx")

# Period → official announcement page. CDN hashes change; the article is stable.
ARTICLES = [
    ("2023-h1", "https://about.netflix.com/en/news/what-we-watched-a-netflix-engagement-report"),
    ("2023-h2", "https://about.netflix.com/en/news/what-we-watched-the-second-half-of-2023"),
    ("2024-h1", "https://about.netflix.com/en/news/what-we-watched-the-first-half-of-2024"),
    ("2024-h2", "https://about.netflix.com/en/news/what-we-watched-the-second-half-of-2024"),
    ("2025-h1", "https://about.netflix.com/en/news/what-we-watched-the-first-half-of-2025"),
    ("2025-h2", "https://about.netflix.com/en/news/what-we-watched-the-second-half-of-2025"),
    ("2026-h1", "https://about.netflix.com/news/what-we-watched-the-first-half-of-2026"),
]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def xlsx_url_for(article_url: str) -> str:
    html = fetch(article_url).decode("utf-8", "replace")
    matches = XLSX_RE.findall(html)
    if not matches:
        raise RuntimeError(f"no xlsx link on {article_url}")
    return matches[0]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 60)
    print("Downloading Netflix What We Watched workbooks")
    print("=" * 60)

    for period, article in ARTICLES:
        dest = OUTPUT_DIR / f"what-we-watched-{period}.xlsx"
        print(f"\n{period}")
        print(f"  article: {article}")
        file_url = xlsx_url_for(article)
        print(f"  file:    {file_url}")
        dest.write_bytes(fetch(file_url))
        print(f"  saved:   {dest.name} ({dest.stat().st_size:,} bytes)")

    print("\nDone.", OUTPUT_DIR)


if __name__ == "__main__":
    main()
