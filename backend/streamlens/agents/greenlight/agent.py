"""The greenlight brief — a deterministic, multi-step agent.

The analyst agent in `agents/analyst` lets Gemini choose its own SQL through
MCP, which is right for open-ended questions and wrong for a brief that a
commissioning editor is going to act on. Here the retrieval steps are fixed:
the same four named queries run in the same order for every title, straight
from the registry the dashboards use. Gemini is handed those results and does
only the part it is actually good at — reading across four sources and saying
what they collectively imply.

The practical consequence is that no figure in the brief can be invented. If
a number appears, a named query returned it, and the same number is on the
dashboard.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from google.genai import types

from streamlens.api import queries
from streamlens.config import google_cloud_settings

# Ordered, fixed. Each entry is (step name, registry query, params builder).
STEPS: list[tuple[str, str, str]] = [
    ("promo_footprint", "greenlight_channel_mix", "title"),
    ("global_trajectory", "rollout_global_trajectory", "title"),
    ("country_footprint", "rollout_title_footprint", "title"),
    ("reception", "dossier_reception", "title"),
]

INSTRUCTION = """\
You are the Streamlens greenlight analyst. You are given the complete
evidence for one Netflix title, already retrieved from the warehouse. Write a
short brief for a commissioning editor.

Rules:
- Use only the numbers in the evidence. Never estimate, round up, or invent a
  figure. If the evidence does not cover something, say so plainly.
- Each section carries `total_rows` and a `rows` sample. When `truncated` is
  true you are seeing part of the data: cite `total_rows` for any count, and
  never describe the sample as though it were the complete set.
- Quote large numbers readably — "335 million hours", not "335010000".
- Lead with the judgement, then the evidence for it.
- Say explicitly whether the promotional push looks proportionate to the
  result, and name the specific numbers that make you say it.
- Hours viewed and Top 10 ranks are published by Netflix. YouTube clip counts
  are observed through the public API. Do not present a Streamlens-derived
  ratio as though either company published it.
- Three short paragraphs at most, roughly 150 words in total. No headings, no
  bullet lists, no preamble.
"""


@dataclass
class Brief:
    title: str
    evidence: dict[str, Any]
    text: str


def _rows(client, name: str, title: str) -> list[dict[str, Any]]:
    q = queries.get(name)
    params = dict(q.defaults)
    if "title" in params:
        params["title"] = title
    result = client.query(q.sql, parameters=params)
    return [dict(zip(result.column_names, r)) for r in result.result_rows]


SAMPLE = 25


def gather(client, title: str) -> dict[str, Any]:
    """Run the fixed retrieval pipeline. No model involved."""
    evidence: dict[str, Any] = {"title": title}
    for step, query_name, _ in STEPS:
        rows = _rows(client, query_name, title)
        # Only a sample of each result reaches the model, or a long tail of
        # country rows crowds out the signal. The true total travels with it:
        # without that, a 25-row slice of 93 countries reads as the whole
        # world and the brief confidently reports the wrong denominator.
        evidence[step] = {
            "total_rows": len(rows),
            "showing": min(len(rows), SAMPLE),
            "truncated": len(rows) > SAMPLE,
            "rows": rows[:SAMPLE],
        }
    return evidence


def write_brief(client, title: str) -> Brief:
    """Synthesise the brief from evidence the model did not choose.

    The Vertex call goes through `services.gcp.gcp_services`, which is the
    only place in the codebase that constructs a Google client.
    """
    from streamlens.services.gcp.gcp_services import generate_brief_text

    evidence = gather(client, title)
    text = generate_brief_text(
        f"{INSTRUCTION}\n\nEvidence for {title!r}:\n"
        f"{json.dumps(evidence, indent=2, default=str)}"
    )
    return Brief(title=title, evidence=evidence, text=text.strip())
