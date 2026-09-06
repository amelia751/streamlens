# GCS raw zone

Public dumps go to GCS **first**, then ClickHouse. Do not load `/data` straight
into ClickHouse.

```
PUBLIC SOURCES → gs://streamlens-data/raw/ (immutable) → ETL → curated Parquet → ClickHouse
Live simulator → ClickHouse directly (optional Parquet archive under telemetry_archive/)
```

Bucket: `streamlens-data` on `pctg-503822`, **US** multi-region.
Raw objects are never overwritten.

## Local → raw mapping

Scripts and our `README.md` stay local.

No YouTube — and that is a legal constraint, not a preference. Raw objects here
are never overwritten, while the YouTube API Developer Policies require public
API data to be deleted or refreshed within 30 days. YouTube therefore bypasses
GCS and writes straight to the `youtube` database under a TTL
(`data/youtube-netflix/README.md`).

| Local | GCS |
|-------|-----|
| `data/netflix-top10/*.tsv` | `gs://streamlens-data/raw/netflix/top10/` |
| `data/netflix-what-we-watched/*.xlsx` | `gs://streamlens-data/raw/netflix/engagement/` |
| `data/netflix-prize/{combined_data_*,movie_titles.csv,probe.txt,qualifying.txt,README}` | `gs://streamlens-data/raw/netflix/prize/` |
| `data/vod-clickstream/*.csv` | `gs://streamlens-data/raw/netflix/vod_clickstream/` |
| `data/tmdb-watch-providers/{watch_*.json,netflix_us_*.json}` | `gs://streamlens-data/raw/tmdb/providers/` |
| `data/movielens-32m/{ratings,tags,movies,links}.csv` + `README.txt` + zip | `gs://streamlens-data/raw/movielens/ratings/` and `.../tags/` |
| `data/movielens-tag-genome/{genome-*.csv,links.csv,README.txt}` + zip | `gs://streamlens-data/raw/movielens/genome/` |
| `data/imdb-datasets/*.tsv.gz` | `gs://streamlens-data/raw/imdb/` |

MovieLens ratings/tags CSVs land in their own prefixes; `movies.csv` / `links.csv` / zip go with ratings.

## Do not run until the GCS key is in `secrets/`

```bash
# Plan only (default)
python3 scripts/gcs/upload_raw.py

# After the key is in place
python3 scripts/gcs/upload_raw.py --apply
```

Uses isolated gcloud state (`CLOUDSDK_CONFIG=.gcloud`) and
`GOOGLE_APPLICATION_CREDENTIALS` from `gcloud-owner-key.mdc`.

ClickPipes read this bucket with the HMAC in `secrets/gcs.env`
(`clickhouse-gcs@pctg-503822`). Setup: `scripts/clickhouse/`.
