#!/usr/bin/env python3
"""Apply a .sql file to ClickHouse Cloud, one statement at a time.

Stdlib only, to match the rest of scripts/. Every statement in schema.sql and
analytics.sql is written with IF NOT EXISTS, so this is safe to re-run.

    python3 scripts/youtube/apply_sql.py scripts/youtube/schema.sql
    python3 scripts/youtube/apply_sql.py scripts/youtube/analytics.sql --dry-run
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_env() -> None:
    path = ROOT / "secrets" / "clickhouse.env"
    if not path.exists():
        raise SystemExit(f"missing {path}")
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def strip_comments(sql: str) -> str:
    """Remove -- comments, including trailing ones, leaving quotes alone.

    schema.sql annotates the audit-gated TTL alternatives after the semicolon
    that ends the statement, so a line-anchored strip leaves the note dangling
    at the front of the *next* statement.
    """
    out: list[str] = []
    for line in sql.splitlines():
        quote: str | None = None
        for i, ch in enumerate(line):
            if quote:
                if ch == quote:
                    quote = None
            elif ch in "'\"":
                quote = ch
            elif ch == "-" and line[i : i + 2] == "--":
                line = line[:i]
                break
        out.append(line)
    return "\n".join(out)


def statements(sql: str) -> list[str]:
    return [s.strip() for s in strip_comments(sql).split(";") if s.strip()]


def run(statement: str) -> None:
    req = urllib.request.Request(
        f"https://{os.environ['CLICKHOUSE_HOST']}:8443/",
        data=statement.encode(),
        headers={
            "X-ClickHouse-User": os.environ["CLICKHOUSE_USER"],
            "X-ClickHouse-Key": os.environ["CLICKHOUSE_PASSWORD"],
        },
    )
    urllib.request.urlopen(req, timeout=300).read()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("path", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    stmts = statements(args.path.read_text())
    print(f"{args.path}: {len(stmts)} statements")

    if args.dry_run:
        for s in stmts:
            print(f"  {' '.join(s.split()[:8])} ...")
        return

    load_env()
    for s in stmts:
        label = " ".join(s.split()[:6])
        try:
            run(s)
            print(f"  ok    {label}")
        except urllib.error.HTTPError as exc:
            print(f"  FAIL  {label}\n        {exc.read().decode()[:400]}")
            sys.exit(1)


if __name__ == "__main__":
    main()
