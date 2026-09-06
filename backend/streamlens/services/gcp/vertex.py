"""The Gemini model the agent runs on, via Gemini Enterprise Agent Platform.

`aiplatform.googleapis.com` is the Agent Platform API (formerly Vertex
AI). The model is built as an explicit object rather than a bare model-id
string so its endpoint is pinned in code: `gemini-3.8-flash` is served
only from `global`, while Agent Runtime is regional and exports its own
region in the environment.
"""

from __future__ import annotations

from google.adk.models.google_llm import Gemini

from streamlens.config import google_cloud_settings


def gemini_model() -> Gemini:
    settings = google_cloud_settings()
    settings.apply_defaults()
    return Gemini(model=settings.model, client_kwargs=settings.client_kwargs)
