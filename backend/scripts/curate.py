"""Drive the curator from the terminal, one turn per argument.

    uv run python scripts/curate.py "build me a dashboard of YouTube uploads"
    uv run python scripts/curate.py "first prompt" "now make it weekly"

Turns share a session, so the second prompt can refer to what the first
built. Every tool call is printed, which is how we watch the agent's
recovery when a panel fails validation.
"""

from __future__ import annotations

import asyncio
import sys

from google.adk.runners import InMemoryRunner
from google.genai import types

from streamlens.agents.curator import root_agent

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


async def main(prompts: list[str]) -> None:
    runner = InMemoryRunner(agent=root_agent, app_name="streamlens")
    session = await runner.session_service.create_session(
        app_name="streamlens", user_id="local"
    )

    for prompt in prompts:
        print(f"\n{BOLD}user>{OFF} {prompt}\n")
        message = types.Content(role="user", parts=[types.Part(text=prompt)])

        async for event in runner.run_async(
            user_id="local", session_id=session.id, new_message=message
        ):
            for part in (event.content.parts if event.content else []) or []:
                if part.function_call:
                    args = {
                        k: _short(str(v), 160)
                        for k, v in (part.function_call.args or {}).items()
                    }
                    print(f"{CYAN}  → {part.function_call.name}{OFF} {args}")
                elif part.function_response:
                    body = str(part.function_response.response)
                    colour = RED if '"ok": false' in body or "'ok': False" in body else GREEN
                    print(f"{colour}  ← {OFF}{_short(body)}")
                elif part.executable_code:
                    print(f"{CYAN}  → code{OFF}\n{_short(part.executable_code.code)}")
                elif part.code_execution_result:
                    print(f"{GREEN}  ← {OFF}{_short(str(part.code_execution_result.output))}")
                elif part.text and event.author != "user":
                    print(part.text, end="")

        print()

    await runner.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or [DEFAULT_PROMPT]))
