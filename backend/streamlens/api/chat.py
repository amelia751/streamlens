"""The curator, streamed to the browser over server-sent events.

The canvas is not redrawn from anything the model says. When a tool call
changes a dashboard we emit a `canvas` event carrying only its id, and the
browser refetches that dashboard through the ordinary REST route. So the
chat can be wrong about what it built and the canvas still shows the truth.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

log = logging.getLogger(__name__)

APP_NAME = "streamlens"

# Tools that change what is on the canvas. Anything here triggers a refetch.
MUTATING = {
    "create_dashboard",
    "update_dashboard",
    "delete_dashboard",
    "add_panel",
    "update_panel",
    "delete_panel",
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
}

# Conversation history outlives any one turn; the MCP connections do not.
_sessions = InMemorySessionService()


async def unreachable(toolsets: dict) -> list[str]:
    """Names of the MCP servers that will not answer right now.

    Worth paying a round trip for. When a toolset fails to load, the ADK logs
    a warning and runs the agent without it — so an unreachable warehouse
    turns into a curator that confidently invents column names instead of an
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


async def ensure_session(runner: Runner, session_id: str, user: str) -> str:
    existing = await runner.session_service.get_session(
        app_name=APP_NAME, user_id=user, session_id=session_id
    )
    if existing:
        return existing.id
    created = await runner.session_service.create_session(
        app_name=APP_NAME, user_id=user, session_id=session_id
    )
    return created.id


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _dashboard_id(args: dict, response: object) -> str | None:
    """Find the dashboard a tool call touched, from its args or its result."""
    if isinstance(args, dict) and args.get("dashboard_id"):
        return str(args["dashboard_id"])
    # create_dashboard only reveals the id in its result.
    if isinstance(response, dict):
        for key in ("dashboard_id", "id"):
            if key in response:
                return str(response[key])
        nested = response.get("structuredContent") or response.get("result")
        if isinstance(nested, dict) and nested.get("dashboard_id"):
            return str(nested["dashboard_id"])
    return None


async def stream_turn(
    message: str, session_id: str, user: str = "local"
) -> AsyncIterator[str]:
    """One turn, on MCP connections opened and closed for this turn alone.

    Reconnecting costs a second or two against a turn that runs for a minute,
    which is a good trade for never serving a stale session.
    """
    from streamlens.agents.curator import build_agent, build_toolsets

    toolsets = build_toolsets()
    runner = Runner(
        agent=build_agent(toolsets),
        app_name=APP_NAME,
        session_service=_sessions,
    )

    content = types.Content(role="user", parts=[types.Part(text=message)])
    # Tool calls carry the dashboard id; their responses often do not, so we
    # remember what each call was for and resolve it when the result lands.
    pending: dict[str, dict] = {}

    try:
        session_id = await ensure_session(runner, session_id, user)

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
                user_id=user, session_id=session_id, new_message=content
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
                            touched = _dashboard_id(args, response.response)
                            if touched:
                                yield _sse(
                                    {"type": "canvas", "dashboard_id": touched}
                                )

                    elif getattr(part, "thought", None) and part.text:
                        yield _sse({"type": "thought", "text": part.text})

                    elif part.text and event.author != "user":
                        yield _sse({"type": "text", "text": part.text})

    except Exception as exc:
        log.exception("chat turn failed")
        yield _sse({"type": "error", "message": str(exc)})

    finally:
        # Closes the HTTP session and reaps the stdio subprocess.
        try:
            await runner.close()
        except Exception:
            log.exception("closing the turn's runner failed")

    yield _sse({"type": "done"})
