#!/usr/bin/env python
"""Sweep stills in the proposal bucket that nothing serves any more.

Deleting a proposal tombstones its rows and leaves the objects behind, on
purpose: the delete has to be three server-side statements and nothing
should be waiting on GCS while the canvas is still replaying queries. What
matters for correctness is that no route can reach the bytes — which is
already true the moment the row is tombstoned, because
`/api/proposals/{id}/stills/{sid}` looks the object up through the row.

So this is housekeeping, not repair. It deletes an object when the
`proposal_still` row that named it is tombstoned or was never there.

    uv run --directory backend python ../scripts/gcs/gc_proposal_stills.py
    uv run --directory backend python ../scripts/gcs/gc_proposal_stills.py --delete

Dry run by default. `--delete` is the only thing that removes anything.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from streamlens.config import proposal_settings  # noqa: E402
from streamlens.services.clickhouse.client import shared_client  # noqa: E402
from streamlens.services.gcp import storage  # noqa: E402

PREFIX = "proposals/"


def live_objects() -> set[str]:
    """Every object name a live still row still points at."""
    rows = shared_client().query(
        "SELECT object FROM streamlens.proposal_still FINAL WHERE is_deleted = 0"
    ).result_rows
    return {r[0] for r in rows}


def main(delete: bool) -> None:
    settings = proposal_settings()
    keys = storage.list_keys(PREFIX)
    live = live_objects()
    orphans = sorted(k for k in keys if k not in live)

    print(f"gs://{settings.bucket}/{PREFIX}")
    print(f"  {len(keys)} objects, {len(live)} still referenced, {len(orphans)} orphaned")

    if not orphans:
        return

    for key in orphans:
        if delete:
            storage.delete_object(key)
            print(f"  deleted {key}")
        else:
            print(f"  would delete {key}")

    if not delete:
        print("\nDry run. Pass --delete to remove them.")


if __name__ == "__main__":
    main(delete="--delete" in sys.argv[1:])
