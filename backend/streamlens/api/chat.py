"""The analyst, streamed to the browser over server-sent events.

The canvas is not redrawn from anything the model says. When a tool call
changes a dashboard we emit a `canvas` event carrying only its id, and when
one changes a proposal a `proposal` event carrying only its id; the browser
refetches through the ordinary REST route either way. So the chat can be
wrong about what it built and the canvas still shows the truth.

Everything else here exists because a turn takes a minute and the user is
watching it. A tool call is announced when it is made (`activity`), and the
ones that put something on the canvas are announced with the shape of what is
coming (`building`, then `built`), so a chart holds its place while its query
runs instead of appearing from nowhere. The reply streams as it is written
(`delta`) rather than landing whole. None of it changes what the turn does —
it changes when the user can see that it is happening.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator, Sequence

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

# Calls that put a visible thing on the canvas and take long enough that the
# canvas should not pretend otherwise. `add_panel` runs its query before it
# saves, and the model fires four of them at once, so waiting for the results
# means four charts appear together after twenty quiet seconds. Announcing the
# calls instead gives the canvas four labelled holes to fill.
BUILDS = {
    "add_panel",
    "update_panel",
    "adopt_panel",
    "add_proposal_panel",
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


def _made_panel(response: object) -> str:
    """The id of the panel a call just saved, from its result.

    From the result and never from the arguments, unlike `_touched`: on
    `adopt_panel` the argument named `panel_id` is the chart being copied *from*
    and the result's is the copy that now exists, which is the one the canvas is
    about to draw.
    """
    if not isinstance(response, dict):
        return ""
    if response.get("panel_id"):
        return str(response["panel_id"])
    nested = response.get("structuredContent") or response.get("result")
    if isinstance(nested, dict) and nested.get("panel_id"):
        return str(nested["panel_id"])
    return ""


def _int(value: object, fallback: int) -> int:
    """A grid number from a model-written argument, or the tool's own default."""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback


def _building(token: str, name: str, args: dict) -> dict | None:
    """The shape of what a call is about to make, for the canvas to hold open.

    Read off the arguments the model has already written, which is what makes
    this possible at all: `add_panel` is told the title, the chart type and the
    grid span before it runs, so the placeholder can stand in the cell the real
    chart will occupy, at the size it will be, with its name on it. The layout
    that settles while the queries run is the layout that stays.

    Nothing here is trusted as data — the canvas still refetches when the call
    lands. A placeholder is a hole of roughly the right shape, and a wrong
    guess about the shape costs one reflow.

    `token` is the call id, which comes back on the response, so the browser
    can drop this again without matching on titles.
    """
    if name in ("add_panel", "update_panel"):
        dashboard_id = args.get("dashboard_id")
        if not dashboard_id:
            return None
        return {
            "type": "building",
            "token": token,
            "kind": "panel",
            "dashboard_id": str(dashboard_id),
            # Set on a rewrite, empty on a new panel: the difference between
            # marking a chart busy and holding a space for one.
            "panel_id": str(args.get("panel_id") or ""),
            "title": str(args.get("title") or "").strip(),
            "chart": str(args.get("chart_type") or ""),
            "width": _int(args.get("width"), 6),
            "height": _int(args.get("height"), 1),
        }

    if name in ("adopt_panel", "add_proposal_panel"):
        proposal_id = args.get("proposal_id")
        if not proposal_id:
            return None
        return {
            "type": "building",
            "token": token,
            "kind": "panel",
            "proposal_id": str(proposal_id),
            "panel_id": "",
            # An adopted chart keeps the dashboard's title unless it is given
            # a new one, and we do not have the old one here.
            "title": str(args.get("title") or "").strip(),
            "chart": str(args.get("chart_type") or ""),
            "width": _int(args.get("width"), 6),
            "height": _int(args.get("height"), 1),
        }

    if name == "generate_still":
        proposal_id = args.get("proposal_id")
        if not proposal_id:
            return None
        return {
            "type": "building",
            "token": token,
            "kind": "still",
            "proposal_id": str(proposal_id),
        }

    return None


async def stream_turn(
    message: str,
    session_id: str,
    user: str = "local",
    focus_kind: str = "",
    focus_id: str = "",
    attachments: Sequence[str] = (),
) -> AsyncIterator[str]:
    """One turn, on MCP connections opened and closed for this turn alone.

    Reconnecting costs a second or two against a turn that runs for a minute,
    which is a good trade for never serving a stale session.

    `focus_kind` and `focus_id` are the tab the user has open. They go into
    session state rather than into the message, so the agent reads them as a
    standing fact about the canvas instead of as something the user just
    said — and so a turn that changes tabs corrects the referent instead of
    stacking a second one.

    `attachments` are canvas paths the user pasted into the box — a chart they
    copied, usually. Those go into the message as content, because they are
    something the user just said: "this chart" is a different claim from
    "the tab I have open", and it is true of this turn only.

    The session store and the memory service outlive the turn. The transcript
    is what makes "make that weekly" work; memory is what makes it work
    tomorrow, in a thread that has not been opened yet.
    """
    from streamlens.api.attachments import describe
    from streamlens.agents.analyst import build_app, build_toolsets, run_config

    toolsets = build_toolsets()
    # The App rather than the bare agent, so the browser gets the same
    # context caching the terminal runner measures.
    runner = Runner(
        app=build_app(toolsets),
        session_service=session_service(),
        memory_service=memory_service(),
    )

    # The attached charts first and the request last, so the thing the model
    # acts on is the sentence the user wrote.
    # Off the loop: resolving an attachment replays its query, and this
    # generator is also the thing streaming the answer.
    attached = await asyncio.to_thread(describe, attachments) if attachments else ""
    content = types.Content(
        role="user",
        parts=(
            [types.Part(text=attached)] if attached else []
        )
        + [types.Part(text=message)],
    )
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
            # What the model call in flight has already sent in pieces. ADK
            # streams prose as it is written and then repeats it in a closing
            # event — sometimes in more than one, which is why a flag that gets
            # spent on the first close is not enough. The closing copy is
            # judged on its text instead: prose already inside what was
            # streamed is a repeat, and only prose that is new gets sent, which
            # is what a model call that streamed nothing looks like.
            said = ""
            mused = ""

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
                partial = bool(event.partial)
                for part in (event.content.parts if event.content else []) or []:
                    # A chunk of something still being written. Text is the
                    # only part of it that means anything yet — a function call
                    # arrives in chunks too, name first and arguments a
                    # fragment at a time — so the rest waits for the event ADK
                    # closes the call with, which is also when the call runs.
                    if partial:
                        if not part.text:
                            continue
                        if getattr(part, "thought", None):
                            mused += part.text
                            yield _sse({"type": "thought", "text": part.text})
                        else:
                            said += part.text
                            yield _sse({"type": "delta", "text": part.text})
                        continue

                    if part.function_call:
                        call = part.function_call
                        token = call.id or call.name or ""
                        args = dict(call.args or {})
                        pending[token] = args
                        yield _sse(
                            {
                                "type": "activity",
                                "tool": call.name,
                                "label": ACTIVITY.get(call.name, "working"),
                            }
                        )
                        if call.name in BUILDS:
                            coming = _building(token, call.name or "", args)
                            if coming:
                                yield _sse(coming)

                    elif part.function_response:
                        response = part.function_response
                        token = response.id or response.name or ""
                        args = pending.pop(token, {})
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

                        # After the refetch it triggered, and carrying what it
                        # made, so the placeholder can stay up until the chart
                        # itself is on the canvas rather than leaving a hole
                        # for the length of one fetch.
                        if response.name in BUILDS:
                            yield _sse(
                                {
                                    "type": "built",
                                    "token": token,
                                    "panel_id": _made_panel(response.response),
                                }
                            )

                        # A tool round trip ends a model call, so what that
                        # call wrote stops counting as a repeat. Without this
                        # the second half of a turn could suppress a genuinely
                        # new line that happens to match the first half.
                        said = ""
                        mused = ""

                    # The closing copy of prose already sent in pieces, which is
                    # the common case and sends nothing.
                    elif getattr(part, "thought", None) and part.text:
                        if part.text not in mused:
                            mused = part.text
                            yield _sse({"type": "thought", "text": part.text})

                    elif part.text and event.author != "user":
                        if part.text not in said:
                            said = part.text
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
