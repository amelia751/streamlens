"""Runtime settings for the Streamlens agent backend.

Credentials are never committed. They are read at import time from
`secrets/` at the repo root, or from the process environment when
running somewhere without that directory (Cloud Run, CI).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
SECRETS_DIR = REPO_ROOT / "secrets"

# Local dev convenience. Existing env vars always win, so Cloud Run and CI
# can inject the same names without touching this file.
for _env_file in ("clickhouse.env", "gcs.env", "tmdb.env", "youtube.env"):
    load_dotenv(SECRETS_DIR / _env_file, override=False)


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"{name} is not set. Source secrets/clickhouse.env or export it."
        )
    return value


def _as_bool(name: str, default: bool) -> bool:
    """Read a flag written as 1/true/yes/on in any casing.

    `mcp-clickhouse` and clickhouse-connect only accept the literal string
    "true", so a raw passthrough of CLICKHOUSE_SECURE=1 silently downgrades
    the connection to plaintext.
    """
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _as_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class GoogleCloudSettings:
    project: str
    model_location: str
    model: str
    credentials_path: Path | None

    def apply_defaults(self) -> None:
        """Fill in credentials locally without overriding a host platform.

        Deliberately does not touch GOOGLE_CLOUD_LOCATION. Agent Runtime is
        regional and sets that to its own region, while `model_location`
        must stay `global`; the model pins its endpoint through
        `client_kwargs` instead of through the environment.
        """
        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", self.project)
        # Agent Runtime executes as a Google-managed service agent whose
        # credentials carry no quota project, so Vertex bills every call to
        # an empty default bucket and returns 429 regardless of the quota
        # the project actually has. google-auth reads this when it resolves
        # credentials, which covers the model and ADK's session service
        # alike. It has to be set here rather than in the deployment spec,
        # where Agent Runtime rejects the name as reserved.
        os.environ.setdefault("GOOGLE_CLOUD_QUOTA_PROJECT", self.project)
        if self.credentials_path is not None:
            os.environ.setdefault(
                "GOOGLE_APPLICATION_CREDENTIALS", str(self.credentials_path)
            )

    @property
    def client_kwargs(self) -> dict[str, object]:
        return {
            "vertexai": True,
            "project": self.project,
            "location": self.model_location,
        }


@dataclass(frozen=True)
class ProposalSettings:
    """Where a proposal's generated stills live, and how big they may get.

    The bucket is deliberately not `streamlens-data`: `raw/` in that bucket
    is the immutable lake ClickPipes reads from, and a model-driven write
    path must not share an IAM boundary with it.
    """

    bucket: str
    image_model: str
    image_location: str
    max_stills_per_proposal: int
    max_still_bytes: int


def proposal_settings() -> ProposalSettings:
    return ProposalSettings(
        bucket=os.environ.get("STREAMLENS_PROPOSAL_BUCKET", "streamlens-proposals"),
        # Nano Banana Pro. Like gemini-3.8-flash it is served only from the
        # global endpoint.
        image_model=os.environ.get("STREAMLENS_IMAGE_MODEL", "gemini-3-pro-image"),
        image_location=os.environ.get("STREAMLENS_IMAGE_LOCATION", "global"),
        max_stills_per_proposal=_as_int("STREAMLENS_MAX_STILLS", 3),
        # A Nano Banana Pro PNG measures ~1.7 MB. Twelve is headroom, not a
        # target; anything larger is a bug rather than an image.
        max_still_bytes=_as_int("STREAMLENS_MAX_STILL_BYTES", 12 * 1024 * 1024),
    )


@dataclass(frozen=True)
class ClickHouseSettings:
    host: str
    port: str
    user: str
    password: str
    secure: bool
    verify: bool
    database: str | None

    def mcp_env(self) -> dict[str, str]:
        """Environment for the `mcp-clickhouse` stdio subprocess.

        CLICKHOUSE_ALLOW_WRITE_ACCESS is deliberately absent: the server
        refuses INSERT/ALTER/DROP unless it is set.
        """
        env = {
            "CLICKHOUSE_HOST": self.host,
            "CLICKHOUSE_PORT": self.port,
            "CLICKHOUSE_USER": self.user,
            "CLICKHOUSE_PASSWORD": self.password,
            "CLICKHOUSE_SECURE": str(self.secure).lower(),
            "CLICKHOUSE_VERIFY": str(self.verify).lower(),
            "CLICKHOUSE_CONNECT_TIMEOUT": "30",
            "CLICKHOUSE_SEND_RECEIVE_TIMEOUT": "300",
            "CHDB_ENABLED": "false",
        }
        if self.database:
            env["CLICKHOUSE_DATABASE"] = self.database
        return env


@dataclass(frozen=True)
class ClickHouseCloudSettings:
    """Credentials for the Cloud control plane, not the SQL interface.

    Separate from ClickHouseSettings because these manage the service
    (ClickPipes, backups, scaling) and must never reach the browser.
    """

    api_key: str
    api_secret: str
    organization_id: str
    service_id: str
    service_name: str

    @property
    def clickpipes_url(self) -> str:
        return (
            "https://api.clickhouse.cloud/v1"
            f"/organizations/{self.organization_id}"
            f"/services/{self.service_id}/clickpipes"
        )


def clickhouse_cloud_settings() -> ClickHouseCloudSettings:
    return ClickHouseCloudSettings(
        api_key=_require("CLICKHOUSE_CLOUD_API_KEY"),
        api_secret=_require("CLICKHOUSE_CLOUD_API_SECRET"),
        organization_id=_require("CLICKHOUSE_ORG_ID"),
        service_id=_require("CLICKHOUSE_SERVICE_ID"),
        service_name=os.environ.get("CLICKHOUSE_SERVICE", "streamlens"),
    )


def google_cloud_settings() -> GoogleCloudSettings:
    sa_key = SECRETS_DIR / "pctg-sa.json"
    return GoogleCloudSettings(
        project=os.environ.get("GOOGLE_CLOUD_PROJECT", "pctg-503822"),
        # gemini-3.8-flash is served only from the global endpoint; the
        # us-central1 endpoint returns 404 for it.
        model_location=os.environ.get("STREAMLENS_MODEL_LOCATION", "global"),
        model=os.environ.get("STREAMLENS_MODEL", "gemini-3.8-flash"),
        credentials_path=sa_key if sa_key.exists() else None,
    )


def clickhouse_reader_settings() -> ClickHouseSettings:
    """The least-privilege identity for anything the model influences.

    `streamlens_reader` holds SELECT and nothing else, so a write is refused
    by ClickHouse rather than by an application check. Falls back to the
    admin credentials when the reader has not been created yet, so a fresh
    checkout still works; run scripts/clickhouse/create_reader.py to get the
    real boundary.
    """
    base = clickhouse_settings()
    user = os.environ.get("CLICKHOUSE_READER_USER")
    password = os.environ.get("CLICKHOUSE_READER_PASSWORD")
    if not user or not password:
        return base
    return replace(base, user=user, password=password)


def clickhouse_settings() -> ClickHouseSettings:
    return ClickHouseSettings(
        host=_require("CLICKHOUSE_HOST"),
        # secrets/clickhouse.env splits HTTPS and native ports; the MCP server
        # and clickhouse-connect both speak HTTPS.
        port=os.environ.get("CLICKHOUSE_PORT")
        or os.environ.get("CLICKHOUSE_HTTPS_PORT", "8443"),
        user=_require("CLICKHOUSE_USER"),
        password=_require("CLICKHOUSE_PASSWORD"),
        secure=_as_bool("CLICKHOUSE_SECURE", True),
        verify=_as_bool("CLICKHOUSE_VERIFY", True),
        database=os.environ.get("CLICKHOUSE_DATABASE"),
    )
