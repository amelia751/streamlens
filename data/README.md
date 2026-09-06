# Data Sources — Streamlens

Publicly reconstructed Netflix catalog + engagement warehouse. Each subfolder
is one source: `README.md` (attribution, schema, compliance) + `download.py`.

We do **not** claim Netflix’s internal catalog. Identity is TMDB-centric.

## Quick Reproduce

```bash
python3 data/netflix-what-we-watched/download.py
python3 data/netflix-top10/download.py
python3 data/movielens-32m/download.py
python3 data/movielens-tag-genome/download.py
python3 data/imdb-datasets/download.py
python3 data/tmdb-watch-providers/download.py # needs secrets/tmdb.env
python3 data/netflix-prize/download.py        # needs kaggle CLI
python3 data/vod-clickstream/download.py      # needs kaggle CLI
```

Gemini is Vertex on `pctg-503822` (`gemini-3.8-flash`, `locations/global`) — not a download source.

YouTube is different from everything above: it has no `download.py` and writes
nothing to disk. See `data/youtube-netflix/`.

```bash
python3 scripts/youtube/sync.py --plan   # then --backfill, then bare for cycles
```

## Directory Layout

```
data/
├── README.md                      ← this file
├── netflix-what-we-watched/       VIEWING — half-year hours/views
├── netflix-top10/                 TIME — weekly global + country ranks
├── movielens-32m/                 OPINION — 32M ratings + 2M tags + TMDB links
├── movielens-tag-genome/          SEMANTICS — movie × tag relevance
├── imdb-datasets/                 ENRICHMENT — ratings, episodes, akas
├── tmdb-watch-providers/          CATALOG — JustWatch availability + US Netflix discover
├── netflix-prize/                 PREFERENCE — 100M Netflix ratings, 1998–2005
├── vod-clickstream/               SESSIONS — UK desktop movie clickstream, 2017–2019
└── youtube-netflix/               PROMOTION — 44 Netflix channels (no disk, no GCS)
```

## Source Summary

| # | Source | Type | Script | Key? | Role |
|---|--------|------|--------|------|------|
| 1 | Netflix What We Watched | Excel workbooks | `download.py` | No | Observed consumption |
| 2 | Netflix Weekly Top 10 | Official TSVs | `download.py` | No | Weekly momentum / geography |
| 3 | MovieLens 32M | GroupLens zip | `download.py` | No | Film ratings + tags + `tmdbId` |
| 4 | MovieLens Tag Genome | GroupLens zip | `download.py` | No | Semantic tag matrix |
| 5 | IMDb datasets | Daily TSV.gz | `download.py` | No | Independent ratings / TV episodes |
| 6 | TMDB / JustWatch | API snapshot | `download.py` | `secrets/tmdb.env` | Current catalog availability |
| 7 | Netflix Prize | Kaggle dump | `download.py` | Kaggle CLI | Historical Netflix ratings (calibration) |
| 8 | VOD Clickstream | Kaggle CSV | `download.py` | Kaggle CLI | UK desktop watch sessions (calibration) |
| 9 | YouTube (Netflix) | API poll | `scripts/youtube/sync.py` | `secrets/youtube.env` | Promotional push + audience response |

MovieLens, YouTube, Prize, and Clickstream all join through TMDB, then
`catalog_availability` where `provider_name = 'Netflix'`. That filter is the
analytic universe — not “all ratings ever.”

Downloaded dumps are gitignored. Scripts and READMEs are tracked.

## GCS

Raw dumps upload to `gs://streamlens-data/raw/...` (US multi-region).
Mapping: `scripts/gcs/`. Tabular dumps land in ClickHouse `landing` via
ClickPipes (`scripts/clickhouse/`). xlsx / Prize / TMDB JSON stay in GCS until
ETL.

**YouTube is excluded, and not by preference.** `raw/` is immutable, while the
YouTube API Developer Policies require public API data to be deleted or
refreshed within 30 days. Both cannot hold for the same bytes, so YouTube skips
GCS entirely and writes to the `youtube` database under a TTL — a poll job, not
a ClickPipe. See `data/youtube-netflix/README.md`.

## Compliance

Label outputs as **publicly observed / reconstructed**. Do not present TMDB
availability as Netflix ground truth, or MovieLens ratings as Netflix ratings.
IMDb dumps are non-commercial. Never print or commit API keys.
