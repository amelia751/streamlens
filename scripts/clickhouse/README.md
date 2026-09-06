# ClickHouse ← GCS ClickPipes

ClickPipes on service `streamlens` read `gs://streamlens-data` through the
Cloud Storage XML API (`https://storage.googleapis.com/streamlens-data/...`).

Identity is a dedicated SA + HMAC, not the owner key:

- SA: `clickhouse-gcs@pctg-503822.iam.gserviceaccount.com`
- Role: `roles/storage.objectViewer` on `gs://streamlens-data`
- HMAC: `secrets/gcs.env` (`GCS_HMAC_ACCESS_ID`, `GCS_HMAC_SECRET`)

```bash
set -a && source "$PWD/secrets/clickhouse.env" && source "$PWD/secrets/gcs.env" && set +a
python3 scripts/clickhouse/gcs_pipes.py          # plan
python3 scripts/clickhouse/gcs_pipes.py --apply  # create missing pipes
```

`--apply` is idempotent. `--only name` limits the set. `--wait` blocks until
one-shot pipes reach `Completed`.

## Landing tables

Database `landing`. One-shot pipes (`isContinuous=false`). Raw GCS is never
overwritten.

| Pipe | Table | Source |
|------|-------|--------|
| `gcs-netflix-top10-most-popular` | `netflix_top10_most_popular` | `raw/netflix/top10/most-popular.tsv` |
| `gcs-netflix-top10-global` | `netflix_top10_global` | `raw/netflix/top10/all-weeks-global.tsv` |
| `gcs-netflix-top10-countries` | `netflix_top10_countries` | `raw/netflix/top10/all-weeks-countries.tsv` |
| `gcs-vod-clickstream` | `vod_clickstream` | `raw/netflix/vod_clickstream/*.csv` |
| `gcs-movielens-movies` | `movielens_movies` | `raw/movielens/ratings/movies.csv` |
| `gcs-movielens-links` | `movielens_links` | `raw/movielens/ratings/links.csv` |
| `gcs-movielens-ratings` | `movielens_ratings` | `raw/movielens/ratings/ratings.csv` |
| `gcs-movielens-tags` | `movielens_tags` | `raw/movielens/tags/tags.csv` |
| `gcs-movielens-genome-scores` | `movielens_genome_scores` | `raw/movielens/genome/genome-scores.csv` |
| `gcs-movielens-genome-tags` | `movielens_genome_tags` | `raw/movielens/genome/genome-tags.csv` |
| `gcs-imdb-title-ratings` | `imdb_title_ratings` | `raw/imdb/title.ratings.tsv.gz` |
| `gcs-imdb-title-basics` | `imdb_title_basics` | `raw/imdb/title.basics.tsv.gz` |
| `gcs-imdb-title-episode` | `imdb_title_episode` | `raw/imdb/title.episode.tsv.gz` |
| `gcs-imdb-title-crew` | `imdb_title_crew` | `raw/imdb/title.crew.tsv.gz` |
| `gcs-imdb-name-basics` | `imdb_name_basics` | `raw/imdb/name.basics.tsv.gz` |
| `gcs-imdb-title-akas` | `imdb_title_akas` | `raw/imdb/title.akas.tsv.gz` |
| `gcs-imdb-title-principals` | `imdb_title_principals` | `raw/imdb/title.principals.tsv.gz` |

Not piped (need ETL / curated Parquet): What We Watched xlsx, Prize text dumps,
TMDB JSON arrays, zips.

`landing` is a dump landing zone. Analytic tables still join through TMDB and
`catalog_availability` where `provider_name = 'Netflix'`.

## Not a ClickPipe: `youtube`

ClickPipes has no HTTP/REST source, so an API-polling pipeline needs its own
fetcher regardless. YouTube also cannot use the GCS hop at all — `raw/` is
immutable and the YouTube API Developer Policies require public API data to be
deleted or refreshed within 30 days.

So the `youtube` database is written directly by `scripts/youtube/sync.py` and
every table carries a TTL. Schema in `scripts/youtube/schema.sql`, background in
`data/youtube-netflix/README.md`.

## Ad-hoc SQL

`default` cannot `CREATE NAMED COLLECTION`. Use the HMAC from `secrets/gcs.env`:

```sql
SELECT count()
FROM s3(
  'https://storage.googleapis.com/streamlens-data/raw/netflix/top10/most-popular.tsv',
  '<GCS_HMAC_ACCESS_ID>',
  '<GCS_HMAC_SECRET>',
  'TSVWithNames'
)
```

Do not paste those values into chat, commits, or screenshots.
