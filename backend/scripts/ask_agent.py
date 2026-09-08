"""Drive the analyst from the terminal, one turn per argument.

    uv run python scripts/ask_agent.py "what data do you have access to?"
    uv run python scripts/ask_agent.py "build me a dashboard of YouTube uploads"
    uv run python scripts/ask_agent.py "first prompt" "now make it weekly"

    STREAMLENS_TRACE=run.jsonl uv run python scripts/ask_agent.py "..."

Turns share a session, so the second prompt can refer to what the first
built. Every tool call is printed, which is how we watch the agent's
recovery when a panel fails validation — and it doubles as the proof that
Vertex AI, the ClickHouse MCP server, and the in-repo dashboard and
proposal servers are all live.

Set `STREAMLENS_TRACE` to a path and every call and result is also written
there as JSON, untruncated — which is how you measure tool use rather than
eyeball it. The terminal output stays readable; the file is the evidence.

Run from `backend/`, where `secrets/` resolves; that is what puts the
warehouse credentials in the environment and so turns the authoring
toolsets on. See `agents/analyst.authoring_enabled`.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time

from google.adk.runners import InMemoryRunner
from google.genai import types

from streamlens.agents.analyst import authoring_enabled, build_app

DEFAULT_PROMPT = "What could you build me from this warehouse?"

CYAN, GREEN, RED, GREY, BOLD, OFF = (
    "\033[36m",
    "\033[32m",
    "\033[31m",
    "\033[90m",
    "\033[1m",
    "\033[0m",
)


def _short(text: str, limit: int = 600) -> str:
    return text if len(text) <= limit else text[:limit] + f" {GREY}...{OFF}"


class Trace:
    """An untruncated JSONL record of one run, for measuring tool use.

    Off unless STREAMLENS_TRACE names a path. Nothing here changes what the
    agent does — it only writes down what it did, with the full arguments
    the terminal has to abbreviate.
    """

    def __init__(self) -> None:
        path = os.environ.get("STREAMLENS_TRACE")
        self.file = open(path, "w", encoding="utf-8") if path else None
        self.started = time.monotonic()

    def write(self, kind: str, **fields) -> None:
        if self.file is None:
            return
        record = {"t": round(time.monotonic() - self.started, 2), "kind": kind}
        record.update(fields)
        self.file.write(json.dumps(record, default=str) + "\n")
        self.file.flush()

    def close(self) -> None:
        if self.file is not None:
            self.write("end")
            self.file.close()


async def main(prompts: list[str]) -> None:
    trace = Trace()
    # The App, so what this measures is what the browser runs.
    runner = InMemoryRunner(app=build_app())
    session = await runner.session_service.create_session(
        app_name="streamlens", user_id="local"
    )

    mode = "warehouse + dashboards + proposals" if authoring_enabled() else "warehouse only"
    print(f"{GREY}analyst: {mode}{OFF}")

    for prompt in prompts:
        print(f"\n{BOLD}user>{OFF} {prompt}\n")
        trace.write("prompt", text=prompt)
        message = types.Content(role="user", parts=[types.Part(text=prompt)])

        async for event in runner.run_async(
            user_id="local", session_id=session.id, new_message=message
        ):
            for part in (event.content.parts if event.content else []) or []:
                if part.function_call:
                    raw = dict(part.function_call.args or {})
                    trace.write("call", tool=part.function_call.name, args=raw)
                    args = {k: _short(str(v), 160) for k, v in raw.items()}
                    print(f"{CYAN}  → {part.function_call.name}{OFF} {args}")
                elif part.function_response:
                    body = str(part.function_response.response)
                    failed = '"ok": false' in body or "'ok': False" in body
                    trace.write(
                        "result",
                        tool=part.function_response.name,
                        ok=not failed,
                        chars=len(body),
                        body=body[:4000],
                    )
                    print(f"{RED if failed else GREEN}  ← {OFF}{_short(body)}")
                elif part.executable_code:
                    trace.write("code", source=part.executable_code.code)
                    print(f"{CYAN}  → code{OFF}\n{_short(part.executable_code.code)}")
                elif part.code_execution_result:
                    print(f"{GREEN}  ← {OFF}{_short(str(part.code_execution_result.output))}")
                elif getattr(part, "thought", None) and part.text:
                    print(f"{GREY}  · {part.text}{OFF}")
                elif part.text and event.author != "user":
                    trace.write("text", text=part.text)
                    print(part.text, end="")

        print()

    trace.close()
    await runner.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or [DEFAULT_PROMPT]))
