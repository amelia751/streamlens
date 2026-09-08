"""Google Cloud.

Every service is registered and called in `gcp_services.py` — that one file
is the whole surface, and nothing else in the codebase constructs a Google
client. Import from here or from there; do not build your own.
"""

from streamlens.services.gcp import gcp_services
from streamlens.services.gcp.gcp_services import (
    ASPECT_RATIOS,
    SERVICES,
    CloudRunIdTokenAuth,
    ImageError,
    StorageError,
    agent_engine,
    apply_credentials,
    cloud_run_client_factory,
    delete_object,
    delete_prefix,
    gemini_model,
    generate_image,
    generate_text,
    list_keys,
    proposal_bucket,
    put_object,
    read_object,
    read_secret,
    still_key,
    storage_client,
)

__all__ = [
    "ASPECT_RATIOS",
    "CloudRunIdTokenAuth",
    "ImageError",
    "SERVICES",
    "StorageError",
    "agent_engine",
    "apply_credentials",
    "cloud_run_client_factory",
    "delete_object",
    "delete_prefix",
    "gcp_services",
    "gemini_model",
    "generate_image",
    "generate_text",
    "list_keys",
    "proposal_bucket",
    "put_object",
    "read_object",
    "read_secret",
    "still_key",
    "storage_client",
]
