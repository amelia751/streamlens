# Netflix — What We Watched (engagement reports)

## Attribution

| Field | Value |
|-------|-------|
| **Source** | [About Netflix — What We Watched](https://about.netflix.com/news/what-we-watched-the-first-half-of-2026) |
| **Publisher** | Netflix |
| **License** | Public report published by Netflix. Reconstructs observed viewing, not an internal catalog dump. |
| **Downloaded** | 2026-09-06 |

## What It Contains

One Excel workbook per half-year (becoming annual in 2027). Netflix describes these reports as covering the large majority of viewing hours on the service for that period (hours viewed, later runtime and calculated views).

| File | Period | Description |
|------|--------|-------------|
| `what-we-watched-2023-h1.xlsx` | 2023 Jan–Jun | First engagement report |
| `what-we-watched-2023-h2.xlsx` | 2023 Jul–Dec | |
| `what-we-watched-2024-h1.xlsx` | 2024 Jan–Jun | |
| `what-we-watched-2024-h2.xlsx` | 2024 Jul–Dec | |
| `what-we-watched-2025-h1.xlsx` | 2025 Jan–Jun | |
| `what-we-watched-2025-h2.xlsx` | 2025 Jul–Dec | |
| `what-we-watched-2026-h1.xlsx` | 2026 Jan–Jun | Latest biannual dump (~97B hours) |

Sheet columns vary by report vintage. Typical fields:

| Column | Description |
|--------|-------------|
| Title / season | Netflix display title, often season-level for series |
| Hours viewed | Hours watched in the report window |
| Runtime | Available in later reports |
| Views | Hours / runtime (later reports) |
| Premiere / availability notes | When present |

## How to Reproduce

```bash
cd data/netflix-what-we-watched
python3 download.py
```

**Script:** `download.py`

1. Opens each official About Netflix article
2. Extracts the Contentful `.xlsx` URL (hashes change; articles do not)
3. Saves `what-we-watched-<period>.xlsx` next to the script

No API key.

## Purpose

Fact table `netflix_engagement` — **what people actually watched**, attached to a `release` (movie or season), not a boolean `is_netflix`.

A title in H1 2026 means viewing was observed then. It does **not** mean the title is still on Netflix today.

## Compliance Notes

- Public Netflix publication. Label as **publicly reported viewing**, not authoritative internal telemetry.
- Do not claim Netflix's private catalog or first-party event stream.
