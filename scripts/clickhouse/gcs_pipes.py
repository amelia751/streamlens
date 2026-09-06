"""Create GCS ClickPipes on service `streamlens` for tabular objects in gs://streamlens-data.

Does not ingest xlsx, Prize text dumps, zips, or TMDB JSON arrays.
Raw objects are never overwritten. Pipes are one-shot (isContinuous=false).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = "https://api.clickhouse.cloud/v1"


def load_env() -> None:
    for name in ("clickhouse.env", "gcs.env"):
        path = ROOT / "secrets" / name
        if not path.exists():
            raise SystemExit(f"missing {path}")
        for line in path.read_text().splitlines():
            if line.strip() and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def ch_query(sql: str, timeout: int = 60) -> str:
    host = os.environ["CLICKHOUSE_HOST"]
    user = os.environ["CLICKHOUSE_USER"]
    password = os.environ["CLICKHOUSE_PASSWORD"]
    port = os.environ.get("CLICKHOUSE_HTTPS_PORT", "8443")
    url = (
        f"https://{host}:{port}/?user={urllib.parse.quote(user)}"
        f"&password={urllib.parse.quote(password)}"
    )
    req = urllib.request.Request(url, data=sql.encode(), method="POST")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            return r.read().decode().strip()
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        for secret in (
            os.environ.get("GCS_HMAC_SECRET", ""),
            os.environ.get("CLICKHOUSE_PASSWORD", ""),
            os.environ.get("GCS_HMAC_ACCESS_ID", ""),
        ):
            if secret:
                err = err.replace(secret, "[redacted]")
        raise SystemExit(f"clickhouse {e.code}: {err[:500]}") from e


def cloud_json(method: str, path: str, body: dict | None = None) -> dict:
    key = os.environ["CLICKHOUSE_CLOUD_API_KEY"]
    secret = os.environ["CLICKHOUSE_CLOUD_API_SECRET"]
    data = None if body is None else json.dumps(body).encode()
    token = base64.b64encode(f"{key}:{secret}".encode()).decode()
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Basic {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise SystemExit(f"cloud {method} {path} -> {e.code}: {err[:800]}") from e


def org_and_service() -> tuple[str, str]:
    org = os.environ.get("CLICKHOUSE_ORG_ID")
    svc = os.environ.get("CLICKHOUSE_SERVICE_ID")
    if org and svc:
        return org, svc
    orgs = cloud_json("GET", "/organizations")
    result = orgs.get("result") or []
    if isinstance(result, dict):
        result = [result]
    org = result[0]["id"]
    services = cloud_json("GET", f"/organizations/{org}/services")
    items = services.get("result") or []
    if isinstance(items, dict):
        items = [items]
    match = next((s for s in items if s.get("name") == "streamlens"), items[0])
    svc = match["id"]
    env_path = ROOT / "secrets" / "clickhouse.env"
    text = env_path.read_text()
    extras = []
    if "CLICKHOUSE_ORG_ID=" not in text:
        extras.append(f"CLICKHOUSE_ORG_ID={org}")
    if "CLICKHOUSE_SERVICE_ID=" not in text:
        extras.append(f"CLICKHOUSE_SERVICE_ID={svc}")
    if extras:
        env_path.write_text(text.rstrip() + "\n" + "\n".join(extras) + "\n")
        env_path.chmod(0o600)
    os.environ["CLICKHOUSE_ORG_ID"] = org
    os.environ["CLICKHOUSE_SERVICE_ID"] = svc
    return org, svc


def cols(*pairs: tuple[str, str]) -> tuple[list[dict], list[dict]]:
    columns = [{"name": n, "type": t} for n, t in pairs]
    mappings = [{"sourceField": n, "destinationField": n} for n, _ in pairs]
    return columns, mappings


def pipe(
    name: str,
    url: str,
    fmt: str,
    table: str,
    columns: list[tuple[str, str]],
    sorting_key: list[str],
    compression: str | None = None,
    source_aliases: dict[str, str] | None = None,
) -> dict:
    dest_cols, mappings = cols(*columns)
    if source_aliases:
        for m in mappings:
            src = source_aliases.get(m["destinationField"])
            if src is not None:
                m["sourceField"] = src
    obj: dict = {
        "type": "gcs",
        "url": url,
        "format": fmt,
        "authentication": "IAM_USER",
        "accessKey": {
            "accessKeyId": os.environ["GCS_HMAC_ACCESS_ID"],
            "secretKey": os.environ["GCS_HMAC_SECRET"],
        },
        "isContinuous": False,
    }
    if compression:
        obj["compression"] = compression
    return {
        "name": name,
        "source": {"objectStorage": obj},
        "destination": {
            "database": "landing",
            "table": table,
            "managedTable": True,
            "tableDefinition": {
                "engine": {"type": "MergeTree"},
                "sortingKey": sorting_key,
            },
            "columns": dest_cols,
        },
        "fieldMappings": mappings,
    }


def definitions() -> list[dict]:
    base = "https://storage.googleapis.com/streamlens-data/raw"
    return [
        pipe(
            "gcs-netflix-top10-most-popular",
            f"{base}/netflix/top10/most-popular.tsv",
            "TabSeparatedWithNames",
            "netflix_top10_most_popular",
            [
                ("category", "String"),
                ("rank", "UInt16"),
                ("show_title", "String"),
                ("season_title", "String"),
                ("hours_viewed_first_91_days", "UInt64"),
                ("runtime", "Float64"),
                ("views_first_91_days", "UInt64"),
            ],
            ["category", "rank"],
        ),
        pipe(
            "gcs-netflix-top10-global",
            f"{base}/netflix/top10/all-weeks-global.tsv",
            "TabSeparatedWithNames",
            "netflix_top10_global",
            [
                ("week", "Date"),
                ("category", "String"),
                ("weekly_rank", "UInt8"),
                ("show_title", "String"),
                ("season_title", "String"),
                ("weekly_hours_viewed", "UInt64"),
                ("runtime", "Float64"),
                ("weekly_views", "Nullable(UInt64)"),
                ("cumulative_weeks_in_top_10", "UInt32"),
            ],
            ["week", "category", "weekly_rank"],
        ),
        pipe(
            "gcs-netflix-top10-countries",
            f"{base}/netflix/top10/all-weeks-countries.tsv",
            "TabSeparatedWithNames",
            "netflix_top10_countries",
            [
                ("country_iso2", "LowCardinality(String)"),
                ("country_name", "String"),
                ("week", "Date"),
                ("category", "String"),
                ("weekly_rank", "UInt8"),
                ("show_title", "String"),
                ("season_title", "String"),
                ("cumulative_weeks_in_top_10", "UInt32"),
            ],
            ["week", "country_iso2", "weekly_rank"],
        ),
        pipe(
            "gcs-vod-clickstream",
            f"{base}/netflix/vod_clickstream/vodclickstream_uk_movies_03.csv",
            "CSVWithNames",
            "vod_clickstream",
            [
                ("datetime", "DateTime"),
                ("duration", "Float64"),
                ("title", "String"),
                ("genres", "String"),
                ("release_date", "String"),
                ("movie_id", "String"),
                ("user_id", "String"),
            ],
            ["datetime", "user_id"],
        ),
        pipe(
            "gcs-movielens-movies",
            f"{base}/movielens/ratings/movies.csv",
            "CSVWithNames",
            "movielens_movies",
            [
                ("movieId", "UInt32"),
                ("title", "String"),
                ("genres", "String"),
            ],
            ["movieId"],
        ),
        pipe(
            "gcs-movielens-links",
            f"{base}/movielens/ratings/links.csv",
            "CSVWithNames",
            "movielens_links",
            [
                ("movieId", "UInt32"),
                ("imdbId", "String"),
                ("tmdbId", "Nullable(UInt32)"),
            ],
            ["movieId"],
        ),
        pipe(
            "gcs-movielens-ratings",
            f"{base}/movielens/ratings/ratings.csv",
            "CSVWithNames",
            "movielens_ratings",
            [
                ("userId", "UInt32"),
                ("movieId", "UInt32"),
                ("rating", "Float32"),
                ("timestamp", "UInt32"),
            ],
            ["movieId", "userId"],
        ),
        pipe(
            "gcs-movielens-tags",
            f"{base}/movielens/tags/tags.csv",
            "CSVWithNames",
            "movielens_tags",
            [
                ("userId", "UInt32"),
                ("movieId", "UInt32"),
                ("tag", "String"),
                ("timestamp", "UInt32"),
            ],
            ["movieId", "userId"],
        ),
        pipe(
            "gcs-movielens-genome-scores",
            f"{base}/movielens/genome/genome-scores.csv",
            "CSVWithNames",
            "movielens_genome_scores",
            [
                ("movieId", "UInt32"),
                ("tagId", "UInt32"),
                ("relevance", "Float32"),
            ],
            ["movieId", "tagId"],
        ),
        pipe(
            "gcs-movielens-genome-tags",
            f"{base}/movielens/genome/genome-tags.csv",
            "CSVWithNames",
            "movielens_genome_tags",
            [
                ("tagId", "UInt32"),
                ("tag", "String"),
            ],
            ["tagId"],
        ),
        pipe(
            "gcs-imdb-title-ratings",
            f"{base}/imdb/title.ratings.tsv.gz",
            "TabSeparatedWithNames",
            "imdb_title_ratings",
            [
                ("tconst", "String"),
                ("averageRating", "Float32"),
                ("numVotes", "UInt32"),
            ],
            ["tconst"],
            compression="gzip",
        ),
        pipe(
            "gcs-imdb-title-basics",
            f"{base}/imdb/title.basics.tsv.gz",
            "TabSeparatedWithNames",
            "imdb_title_basics",
            [
                ("tconst", "String"),
                ("titleType", "LowCardinality(String)"),
                ("primaryTitle", "String"),
                ("originalTitle", "String"),
                ("isAdult", "String"),
                ("startYear", "String"),
                ("endYear", "String"),
                ("runtimeMinutes", "String"),
                ("genres", "String"),
            ],
            ["tconst"],
            compression="gzip",
        ),
        pipe(
            "gcs-imdb-title-episode",
            f"{base}/imdb/title.episode.tsv.gz",
            "TabSeparatedWithNames",
            "imdb_title_episode",
            [
                ("tconst", "String"),
                ("parentTconst", "String"),
                ("seasonNumber", "String"),
                ("episodeNumber", "String"),
            ],
            ["parentTconst", "tconst"],
            compression="gzip",
        ),
        pipe(
            "gcs-imdb-title-crew",
            f"{base}/imdb/title.crew.tsv.gz",
            "TabSeparatedWithNames",
            "imdb_title_crew",
            [
                ("tconst", "String"),
                ("directors", "String"),
                ("writers", "String"),
            ],
            ["tconst"],
            compression="gzip",
        ),
        pipe(
            "gcs-imdb-name-basics",
            f"{base}/imdb/name.basics.tsv.gz",
            "TabSeparatedWithNames",
            "imdb_name_basics",
            [
                ("nconst", "String"),
                ("primaryName", "String"),
                ("birthYear", "String"),
                ("deathYear", "String"),
                ("primaryProfession", "String"),
                ("knownForTitles", "String"),
            ],
            ["nconst"],
            compression="gzip",
        ),
        pipe(
            "gcs-imdb-title-akas",
            f"{base}/imdb/title.akas.tsv.gz",
            "TabSeparatedWithNames",
            "imdb_title_akas",
            [
                ("titleId", "String"),
                ("ordering", "UInt16"),
                ("title", "String"),
                ("region", "String"),
                ("language", "String"),
                ("types", "String"),
                ("attributes", "String"),
                ("isOriginalTitle", "String"),
            ],
            ["titleId", "ordering"],
            compression="gzip",
        ),
        pipe(
            "gcs-imdb-title-principals",
            f"{base}/imdb/title.principals.tsv.gz",
            "TabSeparatedWithNames",
            "imdb_title_principals",
            [
                ("tconst", "String"),
                ("ordering", "UInt16"),
                ("nconst", "String"),
                ("category", "LowCardinality(String)"),
                ("job", "String"),
                ("characters", "String"),
            ],
            ["tconst", "ordering"],
            compression="gzip",
        ),
    ]


def list_pipes(org: str, svc: str) -> list[dict]:
    data = cloud_json("GET", f"/organizations/{org}/services/{svc}/clickpipes")
    result = data.get("result") or []
    if isinstance(result, dict):
        result = [result]
    return result


def ensure_database() -> None:
    ch_query("CREATE DATABASE IF NOT EXISTS landing")


def ensure_named_collection() -> None:
    access = os.environ["GCS_HMAC_ACCESS_ID"]
    secret = os.environ["GCS_HMAC_SECRET"]
    ch_query(
        "CREATE NAMED COLLECTION IF NOT EXISTS gcs_streamlens AS "
        "url = 'https://storage.googleapis.com/streamlens-data/', "
        f"access_key_id = '{access}', secret_access_key = '{secret}'"
    )


def smoke_s3() -> None:
    n = ch_query(
        "SELECT count() FROM s3(gcs_streamlens, "
        "filename='raw/netflix/top10/most-popular.tsv', format='TSVWithNames')"
    )
    print(f"gcs_sql_ok most-popular.tsv rows={n}")


def create_missing(org: str, svc: str, wanted: list[dict]) -> list[str]:
    existing = {p.get("name"): p for p in list_pipes(org, svc)}
    created = []
    for body in wanted:
        name = body["name"]
        if name in existing:
            state = existing[name].get("state")
            print(f"exists {name} state={state}")
            continue
        resp = cloud_json(
            "POST",
            f"/organizations/{org}/services/{svc}/clickpipes",
            body,
        )
        result = resp.get("result") or {}
        print(f"created {name} id={result.get('id')} state={result.get('state')}")
        created.append(name)
    return created


def wait_states(org: str, svc: str, names: set[str], timeout_s: int = 900) -> None:
    deadline = time.time() + timeout_s
    terminal = {"Completed", "Failed", "InternalError", "Stopped"}
    while time.time() < deadline:
        pipes = {p.get("name"): p for p in list_pipes(org, svc) if p.get("name") in names}
        states = {n: (pipes.get(n) or {}).get("state", "missing") for n in names}
        print("states", " ".join(f"{n}={s}" for n, s in sorted(states.items())))
        if names <= {n for n, s in states.items() if s in terminal}:
            failed = [n for n, s in states.items() if s not in {"Completed", "Stopped"}]
            if failed:
                raise SystemExit(f"pipes not completed: {states}")
            return
        time.sleep(15)
    raise SystemExit("timed out waiting for ClickPipes")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--only", default="", help="comma-separated pipe names")
    parser.add_argument("--wait", action="store_true")
    args = parser.parse_args()
    load_env()
    org, svc = org_and_service()
    print(f"org={org[:8]}… service={svc[:8]}…")
    wanted = definitions()
    if args.only:
        allow = {x.strip() for x in args.only.split(",") if x.strip()}
        wanted = [p for p in wanted if p["name"] in allow]
        missing = allow - {p["name"] for p in wanted}
        if missing:
            raise SystemExit(f"unknown --only {sorted(missing)}")
    print(f"pipes {len(wanted)}")
    for p in wanted:
        print(f"  {p['name']} -> landing.{p['destination']['table']}")
    if not args.apply:
        print("dry-run. Pass --apply to create.")
        return
    ensure_database()
    try:
        ensure_named_collection()
        print("named_collection gcs_streamlens ok")
    except SystemExit as e:
        print(f"named_collection skipped: {e}")
        access = os.environ["GCS_HMAC_ACCESS_ID"]
        secret = os.environ["GCS_HMAC_SECRET"]
        n = ch_query(
            "SELECT count() FROM s3("
            "'https://storage.googleapis.com/streamlens-data/raw/netflix/top10/most-popular.tsv', "
            f"'{access}', '{secret}', 'TSVWithNames')"
        )
        print(f"gcs_sql_ok most-popular.tsv rows={n}")
    else:
        smoke_s3()
    create_missing(org, svc, wanted)
    if args.wait:
        wait_states(org, svc, {p["name"] for p in wanted})


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(line_buffering=True)
        main()
    except KeyboardInterrupt:
        sys.exit(130)
