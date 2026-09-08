"""Turning a prompt into a still on a proposal.

The model passes a sentence. It does not pass — and cannot influence — the
bucket, the key, the content type, the size, or the URL the image is later
served from. Everything on that side is derived here and in
`services.gcp.gcp_services`.

Two things are enforced rather than requested:

* **The constraints are appended server-side, on every prompt.** No real or
  identifiable person, no logo or wordmark, no depiction of an actual
  title's cast. This matters specifically because the warehouse behind these
  proposals is about real Netflix titles and real YouTube channels, so a
  prompt that names one is the likely case, not the exotic one.
* **The row is written after the bytes land.** A generation that is blocked
  or fails leaves the proposal exactly as it was — no half-written row, and
  a hero that falls back to its tone gradient rather than a broken image.

Every generated image carries a SynthID watermark, which the report footer
says out loud in the same spirit as the existing "computed by Streamlens"
labelling.
"""

from __future__ import annotations

import logging
from typing import Any

from streamlens.config import proposal_settings
from streamlens.proposals import store
from streamlens.services.gcp import gcp_services

log = logging.getLogger(__name__)

# Appended to whatever the model wrote. Phrased as instructions to the image
# model rather than as a policy note, because that is what it acts on.
CONSTRAINTS = (
    "Cinematic still frame, no text or captions anywhere in the image. "
    "Do not depict any real, identifiable or famous person. "
    "Do not include any logo, wordmark, brand mark or channel branding. "
    "Do not depict the cast, characters, costumes or artwork of any existing "
    "film or series. Invent the place and the people entirely."
)


def _prompt_for(prompt: str) -> str:
    return f"{prompt.strip()}\n\n{CONSTRAINTS}"


def generate_still(
    proposal_id: str, prompt: str, aspect_ratio: str = "16:9"
) -> dict[str, Any]:
    """Generate one image for a proposal and record it.

    Returns `{"ok": true, "still_id": ...}`, or `{"ok": false, "problems":
    [...]}` when the cap is reached or the model would not draw it. Never
    raises for those cases: a proposal without a still is a proposal, and
    the report is built to say so.
    """
    settings = proposal_settings()

    # Reads the proposal first, so an unknown id fails before a single
    # token is spent.
    try:
        store.get_proposal(proposal_id)
    except store.ProposalError as exc:
        return {"ok": False, "problems": [str(exc)]}

    already = store.count_stills(proposal_id)
    if already >= settings.max_stills_per_proposal:
        return {
            "ok": False,
            "problems": [
                f"{proposal_id!r} already has {already} stills, which is the "
                f"limit of {settings.max_stills_per_proposal}. Delete the "
                "proposal or use the images it has."
            ],
        }

    if not prompt.strip():
        return {"ok": False, "problems": ["a still needs a prompt"]}

    try:
        data, mime, model = gcp_services.generate_image(
            _prompt_for(prompt), aspect_ratio
        )
    except gcp_services.ImageError as exc:
        log.warning("still generation refused for %s: %s", proposal_id, exc)
        return {"ok": False, "problems": [str(exc)]}

    if len(data) > settings.max_still_bytes:
        return {
            "ok": False,
            "problems": [
                f"the generated image is {len(data)} bytes, over the "
                f"{settings.max_still_bytes} byte ceiling; nothing was saved"
            ],
        }

    try:
        still_id, key = gcp_services.still_key(proposal_id)
        gcp_services.put_object(key, data, mime)
    except gcp_services.StorageError as exc:
        log.exception("could not store a still for %s", proposal_id)
        return {"ok": False, "problems": [str(exc)]}

    still = store.Still(
        proposal_id=proposal_id,
        id=still_id,
        object=key,
        content_type=mime,
        bytes=len(data),
        # The model's own words, not the appended constraints — this column
        # exists so a generated image can be accounted for after the fact.
        prompt=prompt.strip(),
        model=model,
        aspect_ratio=aspect_ratio,
        position=already,
    )
    store.add_still(still)

    return {
        "ok": True,
        "still_id": still_id,
        "bytes": still.bytes,
        "content_type": mime,
        "model": model,
        "url": store.still_url(proposal_id, still_id),
    }


def read_still(proposal_id: str, still_id: str) -> tuple[bytes, str]:
    """The bytes behind one still, for the route that serves them.

    Looks the object up through the row rather than by guessing a key, so a
    still that was never recorded is not reachable at all.
    """
    still = store.get_still(proposal_id, still_id)
    return gcp_services.read_object(still.object), still.content_type
