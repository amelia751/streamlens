"""Image generation on Vertex, for a proposal's stills.

One call, deliberately thin. Everything about *what* may be depicted is
decided a layer up in `proposals.stills`, which appends the constraints to
the prompt; everything about where the bytes go is decided in
`services.gcp.storage`. This module only knows how to ask the model and how
to refuse an answer that is not an image.

Like `gemini-3.8-flash`, `gemini-3-pro-image` is served only from the
`global` endpoint — the regional ones return 404 — so the location is
pinned in `client_kwargs` rather than read from the environment, which
Agent Runtime sets to its own region.
"""

from __future__ import annotations

import threading

from google import genai
from google.genai import types

from streamlens.config import google_cloud_settings, proposal_settings

# What a browser will render and what the bucket will hold. Anything else
# coming back is a bug, not a picture.
ALLOWED_MIME = ("image/png", "image/jpeg")

ASPECT_RATIOS = ("16:9", "4:3", "1:1", "3:4", "9:16", "21:9")


_local = threading.local()


class ImageError(RuntimeError):
    """Raised with a message written to be read by the model."""


def _client() -> genai.Client:
    """A client bound to the calling thread, and held for the process.

    Not built per call. A `genai.Client` owns an httpx session that it
    closes when the object is collected, and a fresh one used inline —
    `_client().models.generate_content(...)` — is unreachable the moment
    `.models` has been read, so CPython is free to close the session out
    from under the request in flight. That reads as "Cannot send a request,
    as the client has been closed", which is a lifetime bug wearing a
    network error's clothes.
    """
    client = getattr(_local, "client", None)
    if client is None:
        settings = google_cloud_settings()
        settings.apply_defaults()
        client = genai.Client(
            vertexai=True,
            project=settings.project,
            location=proposal_settings().image_location,
        )
        _local.client = client
    return client


def generate_image(
    prompt: str, aspect_ratio: str = "16:9"
) -> tuple[bytes, str, str]:
    """Ask for one image. Returns (bytes, mime type, model).

    Raises unless the model finished cleanly and handed back exactly the
    kind of thing we asked for. A refusal — a safety stop, or a reply that
    is only text — is an error here rather than an empty image, so the
    caller can save the proposal without a still instead of writing a row
    that points at nothing.
    """
    if aspect_ratio not in ASPECT_RATIOS:
        raise ImageError(
            f"unknown aspect ratio {aspect_ratio!r}; use one of "
            f"{', '.join(ASPECT_RATIOS)}"
        )

    model = proposal_settings().image_model
    try:
        response = _client().models.generate_content(
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
