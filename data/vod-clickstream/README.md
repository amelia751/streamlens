# VOD Clickstream — UK Netflix movies

## Attribution

| Field | Value |
|-------|-------|
| **Source** | [Kaggle — Netflix audience behaviour - UK movies](https://www.kaggle.com/datasets/vodclickstream/netflix-audience-behaviour-uk-movies) |
| **Publisher** | [VOD Clickstream](https://vodclickstream.com/) (independent; not affiliated with Netflix) |
| **License** | CC BY-NC-SA 3.0 IGO |
| **Period** | 2017-01 through 2019-06 |
| **Downloaded** | 2026-09-06 |

## What It Contains

Opted-in UK panel visits to `netflix.com/watch` **movie** URLs on desktop/laptop only. Duration is seconds until the user's next tracked navigation (0 = instant bounce).

| File | Description |
|------|-------------|
| `vodclickstream_uk_movies_03.csv` | 671,736 watch-URL clicks |

### Schema

| Column | Description |
|--------|-------------|
| `datetime` | Click timestamp |
| `duration` | Seconds until next tracked Netflix.com click; 0 = bounce |
| `title` | Movie title |
| `genres` | Genre string |
| `release_date` | Theatrical release, not Netflix add date |
| `movie_id` | VODC title id (not TMDB) |
| `user_id` | VODC anonymous user id |

## How to Reproduce

```bash
# Requires: kaggle CLI + ~/.kaggle/kaggle.json
cd data/vod-clickstream
python3 download.py
```

**Script:** `download.py`

## Purpose

**Calibration source** for the simulator — not a representative global Netflix sample:

- watch duration / very-fast abandonment
- session length
- time between watches
- sequential watching
- rewatch behavior

Join titles via name+year → TMDB → `catalog_availability` (`provider_name = 'Netflix'`).

## Compliance Notes

- Independent research panel, not Netflix first-party logs
- UK movies + desktop/laptop only (Netflix has estimated desktop as ~25% of traffic)
- Label as **calibration**, never as current global viewing
- CC BY-NC-SA — attribute VOD Clickstream; non-commercial share-alike
