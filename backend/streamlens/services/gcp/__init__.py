"""Google Cloud — Vertex AI for the models, GCS for what a column cannot hold."""

from streamlens.services.gcp import images, storage
from streamlens.services.gcp.images import generate_image
from streamlens.services.gcp.vertex import gemini_model

__all__ = ["gemini_model", "generate_image", "images", "storage"]
