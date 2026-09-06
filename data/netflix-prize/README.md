# Netflix Prize

## Attribution

| Field | Value |
|-------|-------|
| **Source** | [Kaggle — Netflix Prize data](https://www.kaggle.com/datasets/netflix-inc/netflix-prize-data) |
| **Publisher** | Netflix, Inc. (`netflix-inc/netflix-prize-data`) |
| **Period** | 1998–2005 |
| **Scale** | 100,480,507 ratings · 480,189 customers · 17,770 titles |
| **Downloaded** | 2026-09-06 |

## What It Contains

Genuine Netflix user-level preference histories. **Not 2026 viewing behavior.**

| File | Description |
|------|-------------|
| `combined_data_1.txt` … `_4.txt` | Ratings in Netflix Prize block format |
| `movie_titles.csv` | `netflix_movie_id,year,title` (latin-1) |
| `probe.txt` / `qualifying.txt` | Original contest holdouts |
| `README` | Upstream contest documentation |

### Ratings format (`combined_data_*.txt`)

```
<netflix_movie_id>:
<customer_id>,<rating>,<YYYY-MM-DD>
```

| Field | Description |
|-------|-------------|
| `netflix_movie_id` | 1–17770 in this dump — **not** TMDB / IMDb |
| `customer_id` | Anonymized; gaps; not a live Netflix account id |
| `rating` | Integer 1–5 |
| `date` | Day the rating was given |

Join titles later via title+year → TMDB, then `catalog_availability` where `provider_name = 'Netflix'`. Do not treat Prize IDs as warehouse `title_id`.

## How to Reproduce

```bash
# Requires: kaggle CLI + ~/.kaggle/kaggle.json
cd data/netflix-prize
python3 download.py
```

**Script:** `download.py`

## Purpose

Calibration + a large Netflix-derived fact table:

- titles per user
- taste concentration
- rating distributions
- activity skew
- repeat-interaction timing
- title popularity skew
- preference correlations

Do **not** present this as current Netflix telemetry. Prefer it over synthetic Tencent-scale event imports for the “real Netflix-derived rows” story.

## Compliance Notes

- Historical contest dump (through 2005)
- Anonymized customers only
- Title IDs are Prize-local until identity-mapped
