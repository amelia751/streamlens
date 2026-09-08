"""The analyst, streamed to the browser over server-sent events.

The canvas is not redrawn from anything the model says. When a tool call
changes a dashboard we emit a `canvas` event carrying only its id, and when
one changes a proposal a `proposal` event carrying only its id; the browser
refetches through the ordinary REST route either way. So the chat can be
wrong about what it built and the canvas still shows the truth.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

from google.adk.agents.invocation_context import LlmCallsLimitExceededError
from google.adk.runners import Runner
from google.genai import types

log = logging.getLogger(__name__)

# Sessions are keyed by app name, and the Runner takes the name from the
# App, so these have to be the same string. Imported rather than repeated.
from streamlens.agents.analyst.agent import (  # noqa: E402
    APP_NAME,
    FOCUS_ID,
    FOCUS_KIND,
    MAX_LLM_CALLS,
)
from streamlens.agents.analyst.sessions import (  # noqa: E402
    memory_service,
    session_service,
)

# What the rail calls a conversation. Session state rather than a table of our
# own, so it is stored, listed and deleted by whatever backend is holding the
# transcript.
TITLE_KEY = "conversation_title"

# Tools that change what is on the canvas. Anything here triggers a refetch.
MUTATING = {
    "create_dashboard",
    "update_dashboard",
    "delete_dashboard",
    "add_panel",
    "update_panel",
    "delete_panel",
}

# The same, for proposals. Kept apart because the two emit different events
# and the browser opens a different kind of tab for each.
MUTATING_PROPOSALS = {
    "create_proposal",
    "update_proposal",
    "delete_proposal",
    "adopt_panel",
    "add_proposal_panel",
    "delete_proposal_panel",
    "generate_still",
}

# Names worth showing while the user waits. Everything else streams as a
# generic "working" line rather than leaking tool plumbing into the UI.
ACTIVITY = {
    "list_databases": "reading the warehouse",
    "list_tables": "reading table schemas",
    "run_select_query": "querying ClickHouse",
    "run_query": "querying ClickHouse",
    "warehouse_overview": "reading the warehouse",
    "preview_query": "checking a query",
    "read_panels": "reading the charts",
    "list_dashboards": "looking at your dashboards",
    "get_dashboard": "reading the dashboard",
    "create_dashboard": "creating the dashboard",
    "update_dashboard": "updating the dashboard",
    "delete_dashboard": "deleting the dashboard",
    "add_panel": "adding a panel",
    "update_panel": "updating a panel",
    "delete_panel": "removing a panel",
    "google_search": "searching the web",
    "google_search_agent": "searching the web",
    "list_proposals": "looking at your proposals",
    "read_proposal": "reading the proposal",
    "create_proposal": "writing the proposal",
    "update_proposal": "revising the proposal",
    "delete_proposal": "deleting the proposal",
    "adopt_panel": "putting a chart on the proposal",
    "add_proposal_panel": "adding a chart to the proposal",
    "delete_proposal_panel": "removing a chart from the proposal",
    # Named rather than generic because it is the one call that takes long
    # enough for a spinner with no label to look stuck.
    "generate_still": "generating the still",
}

def human_error(exc: BaseException) -> str:
    """A sentence for the transcript, rather than whatever the exception says.

    Vertex serves its 5xx as a Google error page, so the unedited string is a
    kilobyte of HTML — in the chat log that makes a blip Google tells you to
    retry in thirty seconds look like a broken product. Anything unrecognised
    still comes through, flattened and clipped, because a wrong guess about
    the cause is worse than an ugly message.
    """
    from google.genai import errors as genai_errors

    if isinstance(exc, genai_errors.ServerError):
        return (
            "Vertex AI was briefly unavailable and the turn stopped part way. "
            "Anything already on the canvas is saved — ask again in a moment."
        )
    if isinstance(exc, genai_errors.ClientError):
        return (
            f"The model rejected that request ({exc.code}). If it was a long "
            "one, try asking for less at once."
        )
    return " ".join(str(exc).split())[:300] or exc.__class__.__name__


def conversation_title(text: str) -> str:
    """A thread's name, taken from the request that opened it.

    The user never has to name a conversation, and an untitled row in a rail
    is unusable once there are three of them.
    """
    flat = " ".join(text.split())
    return flat if len(flat) <= 60 else f"{flat[:59]}\u2026"


# Ingesting a finished turn into memory is an API call that writes what the
# analyst should recall later. It happens after the answer has been streamed,
# so it must not be awaited in the request — but a bare task is garbage
# collected mid-flight, so the references are held here until it finishes.
_remembering: set[asyncio.Task] = set()

# Memory Bank buffers what it is sent and distils it into memories when the
# conversation goes quiet, rather than after every turn. A minute is short
# enough that a thread opened after this one can recall it, and long enough
# that a five-turn conversation is summarised once instead of five times.
INGEST_METADATA: dict[str, object] = {
    "generation_trigger_config": {"generation_rule": {"idle_duration": "60s"}},
}


def remember(session_id: str, user: str, since: int) -> None:
    """Send this turn's events to the memory service, in the background.

    `since` is how many events the session had before the turn, so only the
    new ones are sent. This is a stream, not a snapshot: re-sending the whole
    session every turn would hand the same exchange to the extractor five
    times over and pay for it each time.

    The session is read back from its store rather than kept from the run, so
    what is remembered is what was actually persisted.

    Failures are logged and dropped. Losing a memory costs the analyst some
    context in a later thread; failing the turn over it would cost the user
    the answer they were waiting for.
    """

    async def ingest() -> None:
        try:
            session = await session_service().get_session(
                app_name=APP_NAME, user_id=user, session_id=session_id
            )
            if session is None:
                return
            fresh = (session.events or [])[since:]
            if not fresh:
                return
            await memory_service().add_events_to_memory(
                app_name=APP_NAME,
                user_id=user,
                events=fresh,
                session_id=session_id,
                custom_metadata={"stream_id": session_id, **INGEST_METADATA},
            )
        except Exception:
            log.exception("could not add session %s to memory", session_id)

    task = asyncio.create_task(ingest())
    _remembering.add(task)
    task.add_done_callback(_remembering.discard)


async def unreachable(toolsets: dict) -> list[str]:
    """Names of the MCP servers that will not answer right now.

    Worth paying a round trip for. When a toolset fails to load, the ADK logs
    a warning and runs the agent without it — so an unreachable warehouse
    turns into an analyst that confidently invents column names instead of an
    error anyone notices.
    """
    broken = []
    for name, toolset in toolsets.items():
        try:
            await toolset.get_tools()
        except Exception as exc:
            log.warning("MCP toolset %s is unreachable: %s", name, exc)
            broken.append(name)
    return broken


async def ensure_session(
    runner: Runner, session_id: str, user: str
) -> tuple[str, bool, int]:
    """The session for this id, created if the browser has not used it yet.

    Returns whether it still needs a name — the first request is the only one
    that describes the whole conversation — and how many events it already
    has, which is where this turn's contribution to memory begins.
    """
    existing = await runner.session_service.get_session(
        app_name=APP_NAME, user_id=user, session_id=session_id
    )
    if existing:
        return (
            existing.id,
            not (existing.state or {}).get(TITLE_KEY),
            len(existing.events or []),
        )
    created = await runner.session_service.create_session(
        app_name=APP_NAME, user_id=user, session_id=session_id
    )
    return created.id, True, len(created.events or [])


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _touched(key: str, args: dict, response: object) -> str | None:
    """Find the id a tool call touched, from its args or from its result.

    `key` is "dashboard_id" or "proposal_id". A create call only reveals the
    id in its result, and MCP wraps that result one level deeper, so both
    places are checked.
    """
    if isinstance(args, dict) and args.get(key):
        return str(args[key])
    if isinstance(response, dict):
        if response.get(key):
            return str(response[key])
        # `id` is only trustworthy on a call that had no id of its own to
        # begin with, which is exactly the create case.
        if not (isinstance(args, dict) and args.get(key)) and response.get("id"):
            return str(response["id"])
        nested = response.get("structuredContent") or response.get("result")
        if isinstance(nested, dict) and nested.get(key):
            return str(nested[key])
    return None


async def stream_turn(
    message: str,
    session_id: str,
    user: str = "local",
    focus_kind: str = "",
    focus_id: str = "",
) -> AsyncIterator[str]:
    """One turn, on MCP connections opened and closed for this turn alone.

    Reconnecting costs a second or two against a turn that runs for a minute,
    which is a good trade for never serving a stale session.

    `focus_kind` and `focus_id` are the tab the user has open. They go into
    session state rather than into the message, so the agent reads them as a
    standing fact about the canvas instead of as something the user just
    said — and so a turn that changes tabs corrects the referent instead of
    stacking a second one.

    The session store and the memory service outlive the turn. The transcript
    is what makes "make that weekly" work; memory is what makes it work
    tomorrow, in a thread that has not been opened yet.
    """
    from streamlens.agents.analyst import build_app, build_toolsets, run_config

    toolsets = build_toolsets()
    # The App rather than the bare agent, so the browser gets the same
    # context caching the terminal runner measures.
    runner = Runner(
        app=build_app(toolsets),
        session_service=session_service(),
        memory_service=memory_service(),
    )

    content = types.Content(role="user", parts=[types.Part(text=message)])
    # Tool calls carry the dashboard id; their responses often do not, so we
    # remember what each call was for and resolve it when the result lands.
    pending: dict[str, dict] = {}

    turn_starts_at = 0
    try:
        session_id, unnamed, turn_starts_at = await ensure_session(
            runner, session_id, user
        )

        broken = await unreachable(toolsets)
        if broken:
            # Not `return` — the client waits for `done` before it stops
            # showing a spinner.
            yield _sse(
                {
                    "type": "error",
                    "message": (
                        f"Cannot reach the {' and '.join(broken)} MCP server, "
                        "so I would be guessing. Nothing was changed."
                    ),
                }
            )
        else:
            async for event in runner.run_async(
                user_id=user,
                session_id=session_id,
                new_message=content,
                # Overwritten every turn, including with "" when nothing is
                # open, so the referent never outlives the tab. The title is
                # written the same way — through an event, which is what makes
                # a persistent session service actually save it.
                state_delta={
                    FOCUS_KIND: focus_kind or "",
                    FOCUS_ID: focus_id or "",
                    **(
                        {TITLE_KEY: conversation_title(message)} if unnamed else {}
                    ),
                },
                run_config=run_config(),
            ):
                for part in (event.content.parts if event.content else []) or []:
                    if part.function_call:
                        call = part.function_call
                        pending[call.id or call.name] = dict(call.args or {})
                        yield _sse(
                            {
                                "type": "activity",
                                "tool": call.name,
                                "label": ACTIVITY.get(call.name, "working"),
                            }
                        )

                    elif part.function_response:
                        response = part.function_response
                        args = pending.pop(response.id or response.name, {})
                        if response.name in MUTATING:
                            touched = _touched(
                                "dashboard_id", args, response.response
                            )
                            if touched:
                                yield _sse(
                                    {"type": "canvas", "dashboard_id": touched}
                                )

                        elif response.name in MUTATING_PROPOSALS:
                            touched = _touched(
                                "proposal_id", args, response.response
                            )
                            if touched:
                                yield _sse(
                                    {"type": "proposal", "proposal_id": touched}
                                )

                    elif getattr(part, "thought", None) and part.text:
                        yield _sse({"type": "thought", "text": part.text})

                    elif part.text and event.author != "user":
                        yield _sse({"type": "text", "text": part.text})

    except LlmCallsLimitExceededError:
        # The turn hit the ceiling rather than finishing. Whatever it had
        # already written to the canvas is saved and real, so say that: the
        # failure is the missing summary, not the work.
        log.warning("chat turn hit the %s-call ceiling", MAX_LLM_CALLS)
        yield _sse(
            {
                "type": "error",
                "message": (
                    "I took too many steps on that and stopped. Anything I "
                    "already put on the canvas is saved — ask me to pick up "
                    "from there, or narrow the question."
                ),
            }
        )

    except Exception as exc:
        log.exception("chat turn failed")
        yield _sse({"type": "error", "message": human_error(exc)})

    finally:
        # Closes the HTTP session and reaps the stdio subprocess.
        try:
            await runner.close()
        except Exception:
            log.exception("closing the turn's runner failed")
        # After the answer, never in front of it.
        remember(session_id, user, turn_starts_at)

    yield _sse({"type": "done"})
