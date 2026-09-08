"""Drive the analyst through the API the browser uses, and time everything.

    uv run python scripts/probe_chat.py "I'm a filmmaker. Give me an idea."
    uv run python scripts/probe_chat.py --jsonl run.jsonl "first" "then this"

`ask_agent.py` runs the agent in-process, which is the right instrument for
watching it think. This one goes over HTTP to `/api/chat` and reads the
server-sent events, so what it measures is what the browser actually
receives: when the first byte lands, how long the user stares at one
activity label, whether `canvas` and `proposal` events arrive before the
closing text, and where a turn's minute actually goes.

Every event is stamped with its offset from the request and the gap since
the previous event, because the number that matters for the UI is the gap —
a turn that takes ninety seconds in six-second steps feels alive, and one
that takes forty in a single silent block does not.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field

import httpx

CYAN, GREEN, RED, YELLOW, GREY, BOLD, OFF = (
    "\033[36m",
    "\033[32m",
    "\033[31m",
    "\033[33m",
    "\033[90m",
    "\033[1m",
    "\033[0m",
)

DEFAULT_URL = "http://127.0.0.1:8000/api/chat"

# A gap longer than this with nothing on the wire is a stall the user sees as
# a frozen spinner. Flagged rather than failed, because a `generate_still`
# genuinely takes about half a minute.
STALL_SECONDS = 20.0


@dataclass
class Turn:
    prompt: str
    events: list[dict] = field(default_factory=list)
    tools: Counter = field(default_factory=Counter)
    stalls: list[tuple[str, float]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    canvas: list[str] = field(default_factory=list)
    proposals: list[str] = field(default_factory=list)
    text: str = ""
    thought_chars: int = 0
    first_byte: float | None = None
    first_text: float | None = None
    total: float = 0.0


def _short(text: str, limit: int = 110) -> str:
    flat = " ".join(str(text).split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "\u2026"


async def run_turn(
    client: httpx.AsyncClient,
    url: str,
    prompt: str,
    session: str,
    focus: tuple[str, str] = ("", ""),
) -> Turn:
    turn = Turn(prompt=prompt)
    started = time.monotonic()
    last = started

    print(f"\n{BOLD}user>{OFF} {prompt}\n")

    async with client.stream(
        "POST",
        url,
        json={
            "message": prompt,
            "session_id": session,
            "focus_kind": focus[0],
            "focus_id": focus[1],
        },
        headers={"accept": "text/event-stream"},
    ) as response:
        if response.status_code != 200:
            body = (await response.aread()).decode(errors="replace")
            turn.errors.append(f"HTTP {response.status_code}: {body[:400]}")
            print(f"{RED}  ! HTTP {response.status_code}{OFF} {body[:400]}")
            turn.total = time.monotonic() - started
            return turn

        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue

            now = time.monotonic()
            at, gap = now - started, now - last
            last = now
            if turn.first_byte is None:
                turn.first_byte = at

            try:
                event = json.loads(line[6:])
            except json.JSONDecodeError:
                turn.errors.append(f"unparseable SSE frame: {line[:120]}")
                continue

            event["_at"], event["_gap"] = round(at, 2), round(gap, 2)
            turn.events.append(event)
            kind = event.get("type")

            if gap > STALL_SECONDS:
                turn.stalls.append((kind or "?", gap))

            stamp = f"{GREY}{at:7.1f}s +{gap:5.1f}s{OFF}"
            mark = f"{YELLOW}!{OFF}" if gap > STALL_SECONDS else " "

            if kind == "activity":
                tool = event.get("tool", "?")
                turn.tools[tool] += 1
                print(f"{stamp}{mark} {CYAN}-> {tool}{OFF} {GREY}{event.get('label','')}{OFF}")
            elif kind == "thought":
                turn.thought_chars += len(event.get("text", ""))
                print(f"{stamp}{mark} {GREY}.  {_short(event.get('text',''))}{OFF}")
            elif kind == "text":
                turn.text += event.get("text", "")
                if turn.first_text is None:
                    turn.first_text = at
                print(f"{stamp}{mark} {GREEN}>>{OFF} {_short(event.get('text',''), 160)}")
            elif kind == "canvas":
                turn.canvas.append(event.get("dashboard_id", "?"))
                print(f"{stamp}{mark} {BOLD}[canvas]{OFF} {event.get('dashboard_id')}")
            elif kind == "proposal":
                turn.proposals.append(event.get("proposal_id", "?"))
                print(f"{stamp}{mark} {BOLD}[proposal]{OFF} {event.get('proposal_id')}")
            elif kind == "error":
                turn.errors.append(str(event.get("message")))
                print(f"{stamp}{mark} {RED}! error{OFF} {_short(event.get('message',''), 300)}")
            elif kind == "done":
                print(f"{stamp}{mark} {GREY}done{OFF}")

    turn.total = time.monotonic() - started
    return turn


def report(turns: list[Turn]) -> int:
    """Print the summary and return a shell exit code."""
    print(f"\n{BOLD}{'-' * 72}{OFF}")
    bad = 0

    for i, turn in enumerate(turns, 1):
        calls = sum(turn.tools.values())
        print(f"\n{BOLD}turn {i}{OFF}  {_short(turn.prompt, 62)}")
        print(
            f"  total {turn.total:6.1f}s"
            f"   first byte {turn.first_byte or 0:5.1f}s"
            f"   first text {turn.first_text or 0:6.1f}s"
            f"   {calls} tool calls"
        )
        print(
            f"  thinking {turn.thought_chars:,} chars"
            f"   reply {len(turn.text):,} chars"
            f"   canvas {len(set(turn.canvas))}"
            f"   proposals {len(set(turn.proposals))}"
        )

        if turn.tools:
            order = "  ".join(
                f"{t}x{n}" if n > 1 else t for t, n in turn.tools.most_common()
            )
            print(f"  {GREY}tools:{OFF} {order}")

        if turn.stalls:
            worst = max(g for _, g in turn.stalls)
            print(
                f"  {YELLOW}stalls:{OFF} {len(turn.stalls)} gap(s) over "
                f"{STALL_SECONDS:.0f}s, worst {worst:.1f}s"
            )
        if turn.errors:
            bad += 1
            for message in turn.errors:
                print(f"  {RED}error:{OFF} {_short(message, 200)}")
        if not turn.text.strip():
            bad += 1
            print(f"  {RED}error:{OFF} the turn produced no reply text")

    print()
    return 1 if bad else 0


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("prompts", nargs="*", default=[])
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--jsonl", help="write every event to this path")
    parser.add_argument(
        "--timeout", type=float, default=900.0, help="per-turn read timeout"
    )
    parser.add_argument(
        "--focus-kind",
        default="",
        choices=["", "dashboard", "proposal"],
        help="what the first turn should think is open on the canvas",
    )
    parser.add_argument("--focus-id", default="", help="its id")
    parser.add_argument(
        "--session",
        default="",
        help="reuse a saved conversation instead of starting one, so a "
        "follow-up can be sent after a restart",
    )
    args = parser.parse_args()

    prompts = args.prompts or ["What could you build me from this warehouse?"]
    # One session across prompts, so turn two can say "make that weekly".
    session = args.session or f"probe-{uuid.uuid4().hex[:8]}"
    print(f"{GREY}session {session} -> {args.url}{OFF}")

    turns: list[Turn] = []
    timeout = httpx.Timeout(args.timeout, connect=10.0)
    # Follows the tab the way the browser does: whatever the last turn built
    # or revised is what the user is now looking at, and so what the next
    # "make that weekly" refers to.
    focus: tuple[str, str] = (args.focus_kind, args.focus_id)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for prompt in prompts:
            turn = await run_turn(client, args.url, prompt, session, focus)
            turns.append(turn)
            for event in turn.events:
                if event["type"] == "canvas":
                    focus = ("dashboard", event.get("dashboard_id", ""))
                elif event["type"] == "proposal":
                    focus = ("proposal", event.get("proposal_id", ""))
            if focus[1]:
                print(f"{GREY}focus -> {focus[0]} {focus[1]}{OFF}")

    if args.jsonl:
        with open(args.jsonl, "w", encoding="utf-8") as handle:
            for i, turn in enumerate(turns, 1):
                for event in turn.events:
                    handle.write(json.dumps({"turn": i, **event}) + "\n")
        print(f"{GREY}events -> {args.jsonl}{OFF}")

    return report(turns)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
