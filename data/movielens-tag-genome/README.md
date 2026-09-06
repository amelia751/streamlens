# MovieLens Tag Genome

## Attribution

| Field | Value |
|-------|-------|
| **Source** | [GroupLens — MovieLens Latest](https://grouplens.org/datasets/movielens/latest/) (genome files) |
| **Research dump** | [Tag Genome Dataset 2021](https://grouplens.org/datasets/movielens/tag-genome-2021/) (`genome_2021.zip`, 1.8 GB) |
| **License** | GroupLens MovieLens usage license (see extracted `README.txt`) |
| **Downloaded** | 2026-09-06 |

## What It Contains

A dense movie × tag relevance matrix. Conceptually: *The Matrix* × `cyberpunk` ≈ 0.98.

Default download uses **MovieLens Latest**, which ships the current genome plus `links.csv` for TMDB joins.

| File | Description |
|------|-------------|
| `genome-scores.csv` | `movieId,tagId,relevance` |
| `genome-tags.csv` | `tagId,tag` |
| `links.csv` | `movieId,imdbId,tmdbId` |
| `ml-latest.zip` | Upstream archive |
| `README.txt` | Upstream license + schema |

The 2021 research zip is the ~10.5M-score / 1,084-tag / 9,734-movie paper dump plus regeneration inputs. Use `--research-2021` only if you need that exact matrix.

## How to Reproduce

```bash
cd data/movielens-tag-genome
python3 download.py

# Optional 1.8 GB paper dump
python3 download.py --research-2021
```

**Script:** `download.py`

No API key. `files.grouplens.org` currently presents an expired TLS certificate; the script uses `curl -k`.

## Purpose

Human-derived semantic space for films (`tag_genome_scores`). Prefer this over asking Gemini what a movie "is about." Join `movieId` → `tmdbId` via `links.csv`.

TV series are out of scope here.

## Compliance Notes

- Cite GroupLens / MovieLens Tag Genome (Vig et al. 2012; Kotkov et al. 2021)
- Follow the usage license in `README.txt`
