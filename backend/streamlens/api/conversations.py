"""Saved conversations, read back out of whatever is storing them.

The rail needs a list of threads and a transcript for the one being opened.
Both come from the ADK session service rather than from a table of our own:
the transcript is already there, and a second copy would be a second thing
to keep in step with compaction, deletion and every future backend.

An ADK session is an event log, not a chat log. One request produces dozens
of events — function calls, their results, thinking, the reply — and only
two of those are things a person said. `replay` is that filter, and it has
to agree with what `chat.tsx` renders live, or reopening a thread would show
a different conversation from the one the user just had.
"""

from __future__ import annotations

import logging
from typing import Any

from google.adk.events import Event
from google.adk.sessions import Session

from streamlens.agents.analyst.agent import APP_NAME
from streamlens.agents.analyst.sessions import session_service
from streamlens.api.chat import TITLE_KEY, conversation_title

log = logging.getLogger(__name__)

DEFAULT_USER = "local"


class ConversationError(Exception):
    """No such conversation for this user."""


def _title(session: Session) -> str:
    return str((session.state or {}).get(TITLE_KEY) or "New chat")


def _is_recap(event: Event) -> bool:
    """Whether this event is a compaction summary rather than a turn.

    Compaction writes the recap of older turns as an event of its own. It is
    context for the model, not something anyone said, so it stays out of the
    transcript — the turns it summarises are still listed above it.
    """
    actions = getattr(event, "actions", None)
    return bool(actions is not None and getattr(actions, "compaction", None))


def replay(session: Session) -> list[dict[str, str]]:
    """The messages a person would recognise, oldest first.

    Thinking is dropped. It is streamed live because a minute of silence
    looks broken, but a reopened thread is being read rather than waited on,
    and forty paragraphs of deliberation above the answer is not a
    transcript.

    So is the block describing a chart the user attached. It rides along in
    the user's own turn, because that is what makes a follow-up work, but it
    is a spec and a page of rows — nobody typed it, and reading it back as a
    message would bury the sentence that was typed.
    """
    from streamlens.api.attachments import MARK
    messages: list[dict[str, str]] = []

    for event in session.events or []:
        if _is_recap(event) or not event.content or not event.content.parts:
            continue

        role = "user" if event.author == "user" else "agent"
        for part in event.content.parts:
            # Tool traffic and thinking are not messages.
            if part.function_call or part.function_response:
                continue
            if getattr(part, "thought", None):
                continue
            text = (part.text or "").strip()
            if not text or text.startswith(MARK):
                continue
            messages.append({"role": role, "text": text})

    return messages


async def list_conversations(user: str = DEFAULT_USER) -> list[dict[str, Any]]:
    """Every saved thread, most recently used first.

    `list_sessions` returns sessions without their events on most backends,
    so this deliberately does not report a message count: paying one full
    read per thread to put a number in a tab is the wrong trade.
    """
    service = session_service()
    listed = await service.list_sessions(app_name=APP_NAME, user_id=user)

    threads = [
        {
            "id": session.id,
            "title": _title(session),
            "updated_at": session.last_update_time,
        }
        for session in listed.sessions
    ]
    threads.sort(key=lambda t: t["updated_at"] or 0, reverse=True)
    return threads


async def read_conversation(
    conversation_id: str, user: str = DEFAULT_USER
) -> dict[str, Any]:
    service = session_service()
    session = await service.get_session(
        app_name=APP_NAME, user_id=user, session_id=conversation_id
    )
    if session is None:
        raise ConversationError(f"no conversation {conversation_id!r}")

    return {
        "id": session.id,
        "title": _title(session),
        "updated_at": session.last_update_time,
        "messages": replay(session),
    }


async def rename_conversation(
    conversation_id: str, title: str, user: str = DEFAULT_USER
) -> dict[str, Any]:
    """Rename a thread by appending an event, not by editing state in place.

    A session object handed back by the service is a copy. Writing to its
    state changes nothing a persistent backend will save, which is why the
    rename goes through `append_event` with a `state_delta` like every other
    state change in the app.
    """
    from google.adk.events import EventActions

    service = session_service()
    session = await service.get_session(
        app_name=APP_NAME, user_id=user, session_id=conversation_id
    )
    if session is None:
        raise ConversationError(f"no conversation {conversation_id!r}")

    named = conversation_title(title) if title.strip() else "New chat"
    await service.append_event(
        session,
        Event(
            author="user",
            invocation_id=Event.new_id(),
            actions=EventActions(state_delta={TITLE_KEY: named}),
        ),
    )
    return {"id": conversation_id, "title": named}


async def delete_conversation(
    conversation_id: str, user: str = DEFAULT_USER
) -> dict[str, Any]:
    service = session_service()
    await service.delete_session(
        app_name=APP_NAME, user_id=user, session_id=conversation_id
    )
    return {"deleted": conversation_id}
