# IMDb — Non-commercial datasets

## Attribution

| Field | Value |
|-------|-------|
| **Source** | [IMDb Non-Commercial Datasets](https://developer.imdb.com/non-commercial-datasets/) |
| **Files** | `https://datasets.imdbws.com/` |
| **License** | IMDb non-commercial / personal use only |
| **Refresh** | Daily |
| **Downloaded** | 2026-09-06 |

## What It Contains

Gzipped TSVs. `\N` means null. First row is the header.

| File | Role |
|------|------|
| `title.basics.tsv.gz` | Title type, primary/original title, year, runtime, genres |
| `title.episode.tsv.gz` | Episode → parent series + season/episode numbers |
| `title.ratings.tsv.gz` | IMDb averageRating + numVotes |
| `title.akas.tsv.gz` | Regional / alternative titles |
| `title.crew.tsv.gz` | Directors / writers |
| `title.principals.tsv.gz` | Cast/crew credits |
| `name.basics.tsv.gz` | Person names |

Join key is IMDb `tconst` / `nconst`. TMDB `external_ids.imdb_id` and MovieLens `links.imdbId` map here.

## How to Reproduce

```bash
cd data/imdb-datasets
python3 download.py
```

**Script:** `download.py`

No API key. Leaves files gzipped.

## Purpose

Enrichment, not the warehouse backbone. Independent ratings, TV episode hierarchy, aka titles. Keep IMDb / TMDB / MovieLens ratings as separate measures.

## Compliance Notes

- Non-commercial only. Read [IMDb's terms](https://developer.imdb.com/non-commercial-datasets/) before any public product use.
- Do not present IMDb ratings as Netflix's.
