"""FastAPI surface for the Streamlens dashboards.

Two kinds of route:

    /api/query/{name}   deterministic reads from the named registry, used by
                        every chart. No model in the path.
    /api/agent/brief    the Gemini crew, for the parts that need judgement.

Charts must not go through the model — a bar chart that hallucinates is
worse than no bar chart. The agent is reserved for synthesis on top of
numbers the deterministic path already returned.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Query as Q
from fastapi.middleware.cors import CORSMiddleware

from streamlens.api import queries
from streamlens.services.clickhouse.client import shared_client

log = logging.getLogger(__name__)

app = FastAPI(
    title="Streamlens API",
    version="0.1.0",
    description="Read-only analytics over ClickHouse Cloud for the Streamlens dashboards.",
)

# The Next.js app is the only intended caller. Overridable so a deployed
# frontend origin can be added without a code change.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "STREAMLENS_CORS_ORIGINS", "http://localhost:3000"
    ).split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

def client():
    return shared_client()


@app.get("/health")
def health() -> dict[str, Any]:
    try:
        version = client().command("SELECT version()")
        return {"ok": True, "clickhouse": version}
    except Exception as exc:
        log.exception("health check failed")
        raise HTTPException(503, f"clickhouse unreachable: {exc}") from exc


@app.get("/api/queries")
def list_queries() -> dict[str, Any]:
    return {
        "queries": [
            {"name": n, "summary": queries.get(n).summary,
             "params": sorted(queries.get(n).defaults)}
            for n in queries.names()
        ]
    }


@app.get("/api/query/{name}")
def run_query(
    name: str,
    title: str | None = None,
    week: str | None = None,
    category: str | None = None,
    limit: int | None = Q(None, ge=1, le=5000),
    min_channels: int | None = Q(None, ge=1),
    months: int | None = Q(None, ge=1, le=240),
) -> dict[str, Any]:
    try:
        q = queries.get(name)
    except KeyError:
        raise HTTPException(404, f"unknown query {name!r}") from None

    supplied = {
        "title": title, "week": week, "category": category,
        "limit": limit, "min_channels": min_channels, "months": months,
    }
    params = dict(q.defaults)
    for key, value in supplied.items():
        if value is not None and key in params:
            params[key] = value

    try:
        result = client().query(q.sql, parameters=params)
    except Exception as exc:
        log.exception("query %s failed", name)
        raise HTTPException(500, f"query failed: {exc}") from exc

    return {
        "name": name,
        "columns": result.column_names,
        "rows": [
            dict(zip(result.column_names, row)) for row in result.result_rows
        ],
        "row_count": len(result.result_rows),
    }


@app.get("/api/agent/brief")
def agent_brief(title: str, evidence: bool = False) -> dict[str, Any]:
    """Gemini's read on one title, over a fixed retrieval pipeline.

    Every figure the model sees came from the same named queries that back
    the dashboards, so the brief and the charts cannot disagree.
    """
    from streamlens.agents.greenlight import write_brief

    if not title.strip():
        raise HTTPException(400, "title is required")

    try:
        brief = write_brief(client(), title)
    except Exception as exc:
        log.exception("brief failed for %s", title)
        raise HTTPException(502, f"brief failed: {exc}") from exc

    body: dict[str, Any] = {"title": brief.title, "brief": brief.text}
    if evidence:
        body["evidence"] = brief.evidence
    return body
