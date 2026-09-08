"""Every Google Cloud service Streamlens uses, registered and called here.

This is the single file to read to see what the product actually does with
Google Cloud. Nothing else in the codebase constructs a Google client: the
credentials, the clients, and every direct SDK call live below, and the rest
of the code imports from here. If a Google service is used at runtime, its
call is in this file; if it is not in this file, it is not used.

    SERVICES  — the registry, one row per service, with the callable that
                exercises it. `python -m streamlens.services.gcp.gcp_services`
                runs a live smoke test against every one of them.

What runs where:

| Service                      | API                       | Used for |
|------------------------------|---------------------------|----------|
| Vertex AI (Agent Platform)   | aiplatform.googleapis.com | `gemini-3.8-flash` drives the analyst and the greenlight brief |
| Vertex AI — image            | aiplatform.googleapis.com | `gemini-3-pro-image` (Nano Banana Pro) renders proposal stills |
| Vertex AI — built-in tools   | aiplatform.googleapis.com | Google Search grounding and the code sandbox, declared on the agent |
| Cloud Storage                | storage.googleapis.com    | `gs://streamlens-data` raw lake, `gs://streamlens-proposals` stills |
| Cloud Run                    | run.googleapis.com        | the IAM-gated ClickHouse MCP service, called with a Google-signed ID token |
| Agent Engine (Agent Runtime) | aiplatform.googleapis.com | the deployed analyst, queried by `scripts/ask_remote_agent.py` |
| Secret Manager               | secretmanager.googleapis.com | warehouse credentials where no `secrets/` directory exists |

Credentials come from Application Default Credentials — a service-account
key locally, the metadata server once deployed — so the same code path
works in both. `apply_credentials()` is the only place that touches the
environment.
"""

from __future__ import annotations

import logging
import re
import threading
import uuid
from dataclasses import dataclass
from typing import Callable

import anyio
import google.auth.transport.requests
import httpx
from google import genai
from google.adk.models.google_llm import Gemini
from google.cloud import storage
from google.genai import types
from google.oauth2 import id_token

from streamlens.config import google_cloud_settings, proposal_settings

log = logging.getLogger(__name__)

# A client owns an HTTP session, and FastAPI runs sync endpoints on a
# bounded threadpool, so one client per thread settles into a small reused
# pool. Building one per call is also a correctness bug for `genai`: the
# session is closed when the object is collected, which can happen while a
# request is still in flight.
_local = threading.local()


# --------------------------------------------------------- credentials


def apply_credentials() -> None:
    """Put Application Default Credentials where the SDKs will find them.

    The only function in the codebase that writes to the environment. It
    sets defaults rather than overriding, so a host platform that already
    configured itself wins.
    """
    google_cloud_settings().apply_defaults()


# ------------------------------------------ Vertex AI — text and agents


def gemini_model() -> Gemini:
    """The Gemini model the agents run on, via the Agent Platform API.

    Built as an explicit object rather than a bare model-id string so the
    endpoint is pinned in code: `gemini-3.8-flash` is served only from
    `global`, while Agent Runtime is regional and exports its own region
    into the environment.
    """
    settings = google_cloud_settings()
    settings.apply_defaults()
    return Gemini(model=settings.model, client_kwargs=settings.client_kwargs)


def genai_client() -> genai.Client:
    """The Vertex AI GenAI client, bound to the calling thread.

    Held for the life of the thread. A fresh client used inline —
    `genai_client().models.generate_content(...)` — is unreachable the
    moment `.models` has been read, so CPython is free to close its session
    out from under the request. That surfaces as "Cannot send a request, as
    the client has been closed": a lifetime bug wearing a network error's
    clothes.
    """
    client = getattr(_local, "genai", None)
    if client is None:
        settings = google_cloud_settings()
        settings.apply_defaults()
        client = genai.Client(
            vertexai=True,
            project=settings.project,
            location=proposal_settings().image_location,
        )
        _local.genai = client
    return client


def generate_text(prompt: str, model: str | None = None) -> str:
    """One non-streaming completion, at the model's default temperature."""
    settings = google_cloud_settings()
    response = genai_client().models.generate_content(
        model=model or settings.model, contents=prompt
    )
    return response.text or ""


def generate_brief_text(prompt: str, temperature: float = 0.2) -> str:
    """The greenlight brief's completion.

    Low temperature on purpose: the model is synthesising evidence it was
    handed, not choosing what to look at, so there is nothing here worth
    being creative about.
    """
    settings = google_cloud_settings()
    response = genai_client().models.generate_content(
        model=settings.model,
        contents=prompt,
        config=types.GenerateContentConfig(temperature=temperature),
    )
    return response.text or ""


# ------------------------------------------------ Vertex AI — images


class ImageError(RuntimeError):
    """Raised with a message written to be read by the model."""


# What a browser will render and what the bucket will hold. Anything else
# coming back is a bug, not a picture.
ALLOWED_MIME = ("image/png", "image/jpeg")

ASPECT_RATIOS = ("16:9", "4:3", "1:1", "3:4", "9:16", "21:9")


def generate_image(
    prompt: str, aspect_ratio: str = "16:9"
) -> tuple[bytes, str, str]:
    """Ask Nano Banana Pro for one image. Returns (bytes, mime type, model).

    Raises unless the model finished cleanly and handed back exactly the
    kind of thing we asked for. A refusal — a safety stop, or a reply that
    is only text — is an error here rather than an empty image, so the
    caller can save the proposal without a still instead of writing a row
    that points at nothing.

    Every output carries a SynthID watermark, which the report footer says
    out loud.
    """
    if aspect_ratio not in ASPECT_RATIOS:
        raise ImageError(
            f"unknown aspect ratio {aspect_ratio!r}; use one of "
            f"{', '.join(ASPECT_RATIOS)}"
        )

    model = proposal_settings().image_model
    try:
        response = genai_client().models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                # The model narrates as well as draws; asking for both and
                # ignoring the text is what it expects. Asking for IMAGE
                # alone is rejected.
                response_modalities=["TEXT", "IMAGE"],
                image_config=types.ImageConfig(aspect_ratio=aspect_ratio),
            ),
        )
    except Exception as exc:
        raise ImageError(f"image generation failed: {exc}") from exc

    candidates = response.candidates or []
    if not candidates:
        raise ImageError("the image model returned nothing")

    candidate = candidates[0]
    finish = getattr(candidate.finish_reason, "name", str(candidate.finish_reason))
    if finish != "STOP":
        raise ImageError(
            f"the image model stopped early ({finish}); nothing was generated"
        )

    parts = (candidate.content.parts if candidate.content else []) or []
    for part in parts:
        data = getattr(part, "inline_data", None)
        if data is None or not data.data:
            continue
        mime = data.mime_type or ""
        if mime not in ALLOWED_MIME:
            raise ImageError(f"the model returned {mime!r}, which is not an image")
        return bytes(data.data), mime, model

    # A text-only reply is how a blocked prompt usually comes back.
    said = " ".join(p.text for p in parts if getattr(p, "text", None))[:200]
    raise ImageError(
        "the model replied without an image" + (f": {said}" if said else "")
    )


# ----------------------------------------------------- Cloud Storage


class StorageError(RuntimeError):
    """Raised with a message written to be read by the model."""


# Same shape the proposal store enforces on an id. Checked again here
# because this is the last point before an id becomes part of an object
# name, and a key is not the place to discover that an id had a slash in it.
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def storage_client() -> storage.Client:
    """A Cloud Storage client bound to the calling thread."""
    client = getattr(_local, "storage", None)
    if client is None:
        settings = google_cloud_settings()
        settings.apply_defaults()
        client = storage.Client(project=settings.project)
        _local.storage = client
    return client


def bucket(name: str) -> storage.Bucket:
    return storage_client().bucket(name)


def proposal_bucket() -> storage.Bucket:
    """Where generated stills live.

    Deliberately not `gs://streamlens-data`: `raw/` in that bucket is the
    immutable lake ClickPipes read from, and a model-driven write path must
    not share an IAM boundary with it. Uniform bucket-level access, public
    access prevention enforced, nothing in it public.
    """
    return bucket(proposal_settings().bucket)


def still_key(proposal_id: str) -> tuple[str, str]:
    """A fresh (still_id, object name) for one proposal's next image.

    Derived server-side from a validated id and a random uuid, so two
    proposals cannot collide and nothing outside this process can guess or
    choose where bytes land. The model passes a prompt and never a bucket,
    key, path, URL, content type or size.
    """
    if not _ID.match(proposal_id or ""):
        raise StorageError(f"{proposal_id!r} is not a proposal id")
    still_id = uuid.uuid4().hex
    return still_id, f"proposals/{proposal_id}/stills/{still_id}.png"


def put_object(key: str, data: bytes, content_type: str) -> None:
    try:
        proposal_bucket().blob(key).upload_from_string(
            data, content_type=content_type
        )
    except Exception as exc:
        raise StorageError(f"could not write {key}: {exc}") from exc


def read_object(key: str) -> bytes:
    """The bytes at `key`, or a refusal.

    A missing object is an ordinary outcome — a row can outlive what it
    describes — so callers turn this into a 404 rather than a 500.
    """
    try:
        return proposal_bucket().blob(key).download_as_bytes()
    except Exception as exc:
        raise StorageError(f"could not read {key}: {exc}") from exc


def object_exists(key: str) -> bool:
    try:
        return proposal_bucket().blob(key).exists()
    except Exception:
        return False


def list_keys(prefix: str) -> list[str]:
    """Every object under `prefix`. Used by the still garbage collector."""
    try:
        return [b.name for b in proposal_bucket().list_blobs(prefix=prefix)]
    except Exception as exc:
        raise StorageError(f"could not list {prefix}: {exc}") from exc


def delete_object(key: str) -> None:
    try:
        proposal_bucket().blob(key).delete()
    except Exception as exc:
        raise StorageError(f"could not delete {key}: {exc}") from exc


def delete_prefix(prefix: str) -> int:
    """Delete everything under a prefix. Returns how many objects went."""
    keys = list_keys(prefix)
    for key in keys:
        delete_object(key)
    return len(keys)


def raw_lake_prefixes(limit: int = 20) -> list[str]:
    """A peek at `gs://streamlens-data/raw/`, the ClickPipes source.

    Read-only by construction — nothing in this codebase writes to `raw/`
    except `scripts/gcs/upload_raw.py`, which refuses to overwrite.
    """
    name = google_cloud_settings().raw_bucket
    try:
        blobs = storage_client().list_blobs(name, prefix="raw/", max_results=limit)
        return [b.name for b in blobs]
    except Exception as exc:
        raise StorageError(f"could not list gs://{name}/raw/: {exc}") from exc


# ---------------------------------------------------------- Cloud Run


class CloudRunIdTokenAuth(httpx.Auth):
    """Signs each request with a Google ID token for a Cloud Run service.

    The ClickHouse MCP service is deployed `--no-allow-unauthenticated`, so
    it only accepts callers holding `roles/run.invoker`.
    `fetch_id_token_credentials` resolves the caller from a service-account
    key file locally and from the metadata server once deployed, so the same
    code works in both places.
    """

    def __init__(self, audience: str) -> None:
        apply_credentials()
        self._credentials = id_token.fetch_id_token_credentials(audience)
        self._request = google.auth.transport.requests.Request()

    def _token(self) -> str:
        if not self._credentials.valid:
            self._credentials.refresh(self._request)
        return self._credentials.token

    def sync_auth_flow(self, request):
        request.headers["Authorization"] = f"Bearer {self._token()}"
        yield request

    async def async_auth_flow(self, request):
        # Refreshing is a blocking HTTPS call, so keep it off the loop.
        token = await anyio.to_thread.run_sync(self._token)
        request.headers["Authorization"] = f"Bearer {token}"
        yield request


def cloud_run_client_factory(audience: str) -> Callable[..., httpx.AsyncClient]:
    """An httpx client factory that authenticates to one Cloud Run service.

    Handed to the ADK MCP toolset, which calls it with its own headers and
    timeout and passes `auth=None` — the ID token is ours to attach.
    """

    def factory(headers=None, timeout=None, auth=None) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            headers=headers,
            timeout=timeout,
            auth=CloudRunIdTokenAuth(audience),
            follow_redirects=True,
        )

    return factory


# ------------------------------------------------------- Agent Engine


def agent_engine(engine_id: str | None = None):
    """The analyst deployed to Agent Runtime, as a queryable handle.

    Driven by `scripts/ask_remote_agent.py`. Nothing runs locally on that
    path: the reasoning engine calls the Cloud Run MCP service itself.
    """
    import vertexai

    settings = google_cloud_settings()
    settings.apply_defaults()
    engine_id = engine_id or settings.agent_engine_id
    client = vertexai.Client(project=settings.project, location=settings.region)
    return client.agent_engines.get(
        name=(
            f"projects/{settings.project}/locations/{settings.region}"
            f"/reasoningEngines/{engine_id}"
        )
    )


# ----------------------------------------------------- Secret Manager


def read_secret(name: str, version: str = "latest") -> str | None:
    """One secret's payload, or None if it cannot be read.

    The local path never needs this — credentials come from `secrets/`. It
    exists for a deployment that has no such directory: Cloud Run mounts
    these into the MCP service directly, and anything else reads them here.
    Returns None rather than raising so a missing secret degrades to "not
    configured" instead of taking the process down at import time.
    """
    from google.cloud import secretmanager

    settings = google_cloud_settings()
    path = f"projects/{settings.project}/secrets/{name}/versions/{version}"
    try:
        client = secretmanager.SecretManagerServiceClient()
        return client.access_secret_version(name=path).payload.data.decode("utf-8")
    except Exception as exc:
        log.debug("secret %s unavailable: %s", name, exc)
        return None


# -------------------------------------------------------- the registry


@dataclass(frozen=True)
class Service:
    """One Google Cloud service, and the call that proves we use it."""

    name: str
    api: str
    used_for: str
    entrypoint: str
    smoke: Callable[[], str] | None = None


def _smoke_vertex_text() -> str:
    return f"gemini responded: {generate_text('Reply with the word ready.')[:40]!r}"


def _smoke_vertex_model() -> str:
    return f"model pinned to {gemini_model().model} on {google_cloud_settings().model_location}"


def _smoke_vertex_image() -> str:
    data, mime, model = generate_image(
        "An empty cinema seat under a single work light, no people.", "16:9"
    )
    return f"{model} returned {len(data):,} bytes of {mime}"


def _smoke_storage() -> str:
    key = "healthcheck/roundtrip.txt"
    put_object(key, b"streamlens", "text/plain")
    body = read_object(key)
    delete_object(key)
    return f"wrote, read ({len(body)} bytes) and deleted gs://{proposal_settings().bucket}/{key}"


def _smoke_raw_lake() -> str:
    return f"gs://{google_cloud_settings().raw_bucket}/raw/ holds {len(raw_lake_prefixes())}+ objects"


def _smoke_cloud_run() -> str:
    from streamlens.services.clickhouse.clickhouse_services import MCP_SERVICE_URL

    if not MCP_SERVICE_URL:
        return "skipped — STREAMLENS_MCP_URL not set, MCP runs as a local subprocess"
    audience = MCP_SERVICE_URL.split("/mcp")[0].rstrip("/")
    auth = CloudRunIdTokenAuth(audience)
    return f"minted an ID token for {audience} ({len(auth._token())} chars)"


def _smoke_secret_manager() -> str:
    value = read_secret("streamlens-clickhouse-host")
    return (
        "read streamlens-clickhouse-host from Secret Manager"
        if value
        else "no access (expected locally — credentials come from secrets/)"
    )


SERVICES: tuple[Service, ...] = (
    Service(
        "Vertex AI — Gemini",
        "aiplatform.googleapis.com",
        "gemini-3.8-flash drives the analyst and the greenlight brief",
        "gcp_services.gemini_model / generate_text",
        _smoke_vertex_model,
    ),
    Service(
        "Vertex AI — GenAI text",
        "aiplatform.googleapis.com",
        "one-shot completions behind the greenlight brief",
        "gcp_services.generate_text",
        _smoke_vertex_text,
    ),
    Service(
        "Vertex AI — Nano Banana Pro",
        "aiplatform.googleapis.com",
        "gemini-3-pro-image renders the still behind a proposal",
        "gcp_services.generate_image",
        _smoke_vertex_image,
    ),
    Service(
        "Cloud Storage — proposals",
        "storage.googleapis.com",
        "gs://streamlens-proposals holds generated stills, served only via the API",
        "gcp_services.put_object / read_object / delete_object",
        _smoke_storage,
    ),
    Service(
        "Cloud Storage — raw lake",
        "storage.googleapis.com",
        "gs://streamlens-data/raw/ is what the ClickPipes ingest",
        "gcp_services.raw_lake_prefixes",
        _smoke_raw_lake,
    ),
    Service(
        "Cloud Run",
        "run.googleapis.com",
        "the IAM-gated ClickHouse MCP service; every call carries a signed ID token",
        "gcp_services.CloudRunIdTokenAuth",
        _smoke_cloud_run,
    ),
    Service(
        "Agent Engine (Agent Runtime)",
        "aiplatform.googleapis.com",
        "the deployed analyst, queried by scripts/ask_remote_agent.py",
        "gcp_services.agent_engine",
        None,
    ),
    Service(
        "Secret Manager",
        "secretmanager.googleapis.com",
        "warehouse credentials where no secrets/ directory exists",
        "gcp_services.read_secret",
        _smoke_secret_manager,
    ),
)


def main() -> None:
    """Call every registered service for real and report what came back.

        uv run python -m streamlens.services.gcp.gcp_services
    """
    apply_credentials()
    settings = google_cloud_settings()
    print(f"project {settings.project} · region {settings.region} · models on {settings.model_location}\n")

    for service in SERVICES:
        if service.smoke is None:
            print(f"  --   {service.name}: {service.entrypoint} (not smoke-tested)")
            continue
        try:
            print(f"  ok   {service.name}: {service.smoke()}")
        except Exception as exc:
            print(f"  FAIL {service.name}: {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
