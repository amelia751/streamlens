#!/usr/bin/env python
"""Create the least-privilege ClickHouse identity the agent queries through.

Everything the model influences — the ClickHouse MCP server and every panel
query — connects as `streamlens_reader`. That user is granted SELECT and
nothing else, so a write is refused by the server itself rather than by an
application check that a future code path could forget to make.

Dashboard and proposal definitions are written by `default` through the
typed helpers in `streamlens.dashboards.store` and
`streamlens.proposals.store`, where the model never supplies the SQL. They
are read back by `default` too, so the reader is not granted `streamlens`
at all — see READABLE below.

    uv run --directory backend python ../scripts/clickhouse/create_reader.py

Idempotent. Prints no secret; the generated password is appended to
secrets/clickhouse.env as CLICKHOUSE_READER_PASSWORD.
"""

from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SECRETS = REPO_ROOT / "secrets" / "clickhouse.env"

sys.path.insert(0, str(REPO_ROOT / "backend"))

from streamlens.services.clickhouse.clickhouse_services import get_client  # noqa: E402

READER = "streamlens_reader"
PROFILE = "streamlens_reader_profile"

# The databases the agent is allowed to read in full.
#
# `streamlens` is deliberately absent. It holds dashboard and proposal
# definitions rather than data, every path that reads or writes them
# connects as `default` through `shared_client()`, and `run_panel_query` —
# the one thing the reader is for — needs nothing from it. Granting it
# would only let a model-authored panel query read the agent's own output
# back, which is pointless rather than dangerous, but the smaller grant is
# free.
READABLE = ("landing", "youtube")

# `system` is granted table by table, not wholesale. Cloud refuses a blanket
# GRANT SELECT ON system.* because `default` does not hold every system table
# with grant option, and the agent only needs the catalog anyway.
READABLE_SYSTEM = (
    "system.databases",
    "system.tables",
    "system.columns",
    "system.parts",
    "system.one",
    "system.numbers",
)


def existing_password() -> str | None:
    if not SECRETS.exists():
        return None
    for line in SECRETS.read_text().splitlines():
        if line.startswith("CLICKHOUSE_READER_PASSWORD="):
            return line.split("=", 1)[1].strip()
    return None


def main() -> None:
    password = existing_password() or secrets.token_urlsafe(32)
    client = get_client()

    # A per-query ceiling so one bad model-authored aggregation cannot pin the
    # service. readonly=2 permits SELECT and per-query settings, never writes.
    client.command(
        f"""
        CREATE SETTINGS PROFILE IF NOT EXISTS {PROFILE} SETTINGS
            readonly = 2,
            max_execution_time = 30,
            max_result_rows = 100000,
            max_memory_usage = 4000000000,
            result_overflow_mode = 'break'
        """
    )

    # Cloud refuses a passwordless user, so the credential is set at creation
    # and re-asserted below.
    client.command(
        f"CREATE USER IF NOT EXISTS {READER} "
        f"IDENTIFIED WITH sha256_password BY '{password}'"
    )
    # Set the credential every run rather than only at creation. CREATE USER
    # IF NOT EXISTS silently keeps the old password, so a run that failed
    # after creating the user would otherwise leave the stored password and
    # the real one permanently out of step.
    client.command(
        f"ALTER USER {READER} "
        f"IDENTIFIED WITH sha256_password BY '{password}' "
        f"SETTINGS PROFILE {PROFILE}"
    )

    for database in READABLE:
        client.command(f"GRANT SELECT ON {database}.* TO {READER}")
    for table in READABLE_SYSTEM:
        client.command(f"GRANT SELECT ON {table} TO {READER}")

    if existing_password() is None:
        with SECRETS.open("a") as fh:
            fh.write(f"\nCLICKHOUSE_READER_USER={READER}\n")
            fh.write(f"CLICKHOUSE_READER_PASSWORD={password}\n")
        print(f"wrote CLICKHOUSE_READER_PASSWORD to {SECRETS.relative_to(REPO_ROOT)}")

    grants = client.query(
        "SELECT access_type, database FROM system.grants "
        "WHERE user_name = {u:String} ORDER BY database",
        parameters={"u": READER},
    ).result_rows
    print(f"{READER} grants:", [(g[0], g[1]) for g in grants])


if __name__ == "__main__":
    main()
