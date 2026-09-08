"""Where a conversation lives between turns, and what it remembers after it.

A turn is deliberately stateless — the MCP connections open and close with
it — but a conversation is not. "Make that one weekly" only means something
if the turn before it is still on the record, and it has to survive a
restart too: an analyst that forgets every thread when uvicorn reloads is
an analyst nobody can work with for an afternoon.

Two different problems, two ADK services:

**Session** is this conversation. Its events are the transcript the model is
re-sent every turn, so it is what makes a follow-up land.

**Memory** is every other conversation. It is searched, not replayed, and it
is what lets a new thread pick up "the dashboard we built yesterday" without
carrying yesterday's tokens forever.

Session backends, chosen by `STREAMLENS_SESSION_BACKEND`:

| value | service | persistence |
|---|---|---|
| `db` (default) | `DatabaseSessionService` | the SQLAlchemy URL you give it |
| `vertex` | `VertexAiSessionService` | Agent Engine, managed by Google |
| `memory` | `InMemorySessionService` | none — tests only |

`db` with no URL means a SQLite file under `backend/.data/`, which is the
same service and the same code path as production with a different driver,
so local development exercises persistence rather than a dict that lies
about it. Production is Cloud SQL for Postgres:

    STREAMLENS_SESSION_DB_URL=postgresql+asyncpg://user:pw@host/streamlens

Postgres is not a preference. `DatabaseSessionService` serialises writes to
one session with `SELECT ... FOR UPDATE` there, which is what makes two API
replicas safe on the same conversation; SQLite has one writer and no such
guarantee. Both drivers must be async — `sqlite+aiosqlite`, not `sqlite`.

`vertex` is the other production shape: sessions live in the same Agent
Engine the analyst deploys to, so the deployed agent and this process read
one set of threads instead of two.

Services are cached per process. Each one owns a connection pool, and
building a second on every request would open a second pool.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path

from google.adk.memory import BaseMemoryService
from google.adk.sessions import BaseSessionService

log = logging.getLogger(__name__)

# Beside the code that writes it, and git-ignored. Not /tmp: a conversation
# that disappears when the machine reboots is the bug this file exists to fix.
DATA_DIR = Path(__file__).resolve().parents[3] / ".data"

SESSION_BACKEND_ENV = "STREAMLENS_SESSION_BACKEND"
SESSION_DB_URL_ENV = "STREAMLENS_SESSION_DB_URL"
MEMORY_BACKEND_ENV = "STREAMLENS_MEMORY_BACKEND"


def default_db_url() -> str:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{DATA_DIR / 'sessions.db'}"


def session_db_url() -> str:
    return os.environ.get(SESSION_DB_URL_ENV) or default_db_url()


def _backend() -> str:
    return (os.environ.get(SESSION_BACKEND_ENV) or "db").strip().lower()


@lru_cache(maxsize=1)
def session_service() -> BaseSessionService:
    """The conversation store, built once for this process.

    Falls back rather than crashes. A misconfigured database URL should cost
    the user their saved threads, not the ability to ask a question — and the
    log line says which happened.
    """
    backend = _backend()

    if backend == "memory":
        from google.adk.sessions import InMemorySessionService

        log.warning("sessions are in memory: threads will not survive a restart")
        return InMemorySessionService()

    if backend == "vertex":
        from google.adk.sessions import VertexAiSessionService

        from streamlens.config import google_cloud_settings

        cloud = google_cloud_settings()
        try:
            service = VertexAiSessionService(
                project=cloud.project,
                location=cloud.region,
                agent_engine_id=cloud.agent_engine_id,
            )
            log.info(
                "sessions in Agent Engine %s (%s)",
                cloud.agent_engine_id,
                cloud.region,
            )
            return service
        except Exception:
            log.exception("Agent Engine sessions unavailable; falling back to a database")

    from google.adk.sessions import DatabaseSessionService

    url = session_db_url()
    try:
        service = DatabaseSessionService(db_url=url)
        # The password is in that URL when it is Postgres, so only the scheme
        # is logged.
        log.info("sessions in %s", url.split("://", 1)[0])
        return service
    except Exception:
        from google.adk.sessions import InMemorySessionService

        log.exception("session database unavailable; conversations will not be saved")
        return InMemorySessionService()


@lru_cache(maxsize=1)
def memory_service() -> BaseMemoryService:
    """What the analyst can recall from conversations other than this one.

    Memory Bank by default, because it is the only backend that survives a
    restart and the only one that searches by meaning rather than by shared
    words. It extracts facts from a finished thread — "they are working on
    the Shorts dashboard", "they want maps for country data" — and hands the
    relevant ones back on a later turn.

    Set `STREAMLENS_MEMORY_BACKEND=memory` for the in-process keyword store
    (tests, offline work), or `off` to give the analyst no cross-conversation
    recall at all.
    """
    backend = (os.environ.get(MEMORY_BACKEND_ENV) or "vertex").strip().lower()

    if backend not in {"vertex", "memory", "off"}:
        log.warning("unknown %s=%r; using memory bank", MEMORY_BACKEND_ENV, backend)
        backend = "vertex"

    if backend == "vertex":
        from google.adk.memory import VertexAiMemoryBankService

        from streamlens.config import google_cloud_settings

        cloud = google_cloud_settings()
        try:
            service = VertexAiMemoryBankService(
                project=cloud.project,
                location=cloud.region,
                agent_engine_id=cloud.agent_engine_id,
            )
            log.info("memory bank %s (%s)", cloud.agent_engine_id, cloud.region)
            return service
        except Exception:
            log.exception("memory bank unavailable; recall stays in this process")

    from google.adk.memory import InMemoryMemoryService

    return InMemoryMemoryService()


def memory_enabled() -> bool:
    """Whether the agent should be given the memory-recall tool.

    Read while the agent is built, so an instruction never promises recall
    the runner was not given a service for.
    """
    return (os.environ.get(MEMORY_BACKEND_ENV) or "vertex").strip().lower() != "off"


def describe() -> dict[str, str]:
    """What is storing conversations, for `/health` and the startup log."""
    backend = _backend()
    where = (
        "agent-engine"
        if backend == "vertex"
        else "in-process"
        if backend == "memory"
        else session_db_url().split("://", 1)[0]
    )
    return {
        "sessions": where,
        "memory": (os.environ.get(MEMORY_BACKEND_ENV) or "vertex").strip().lower(),
    }
