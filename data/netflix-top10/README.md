# Netflix — Weekly Top 10

## Attribution

| Field | Value |
|-------|-------|
| **Source** | [Netflix Tudum Top 10](https://www.netflix.com/tudum/top10) |
| **Files** | `https://www.netflix.com/tudum/top10/data/*.tsv` |
| **Publisher** | Netflix |
| **Coverage** | Weekly lists from 2021-06-28 onward; ~90+ countries |
| **Downloaded** | 2026-09-06 |

## What It Contains

| File | Description |
|------|-------------|
| `all-weeks-global.tsv` | Global weekly rank + hours viewed + views + runtime |
| `all-weeks-countries.tsv` | Per-country weekly rank (no hours on this file) |
| `most-popular.tsv` | First-91-day most popular titles by category |

### Schema: `all-weeks-global.tsv`

| Column | Description |
|--------|-------------|
| `week` | Week ending (Sunday) |
| `category` | Films/TV × English/Non-English |
| `weekly_rank` | 1–10 |
| `show_title` | Netflix display title |
| `season_title` | Season when Netflix splits series |
| `weekly_hours_viewed` | Hours that week |
| `runtime` | Hours |
| `weekly_views` | Hours / runtime (from 2023-06-20) |
| `cumulative_weeks_in_top_10` | Longevity |

### Schema: `all-weeks-countries.tsv`

| Column | Description |
|--------|-------------|
| `country_name` / `country_iso2` | Market |
| `week` / `category` / `weekly_rank` | Same as global |
| `show_title` / `season_title` | Netflix display title |
| `cumulative_weeks_in_top_10` | Longevity in that country list |

## How to Reproduce

```bash
cd data/netflix-top10
python3 download.py
```

**Script:** `download.py`

Plain HTTP GET. No key. Re-run weekly to refresh history.

## Purpose

Fact table `netflix_top10_weekly` — velocity, acceleration, market diffusion, longevity. Attach to `release_id` after identity resolution.

## Compliance Notes

- Official public lists. Not a complete catalog.
- Pre-2023-06-20 global lists are ranked by hours viewed, not views.
