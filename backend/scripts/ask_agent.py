"""Headless one-shot runner: ask the analyst agent a question.

    uv run python scripts/ask_agent.py "what data do you have access to?"

Prints every tool call the agent makes, so this doubles as the proof that
Vertex AI and the ClickHouse Cloud MCP server are both live.
"""

from __future__ import annotations

import asyncio
import sys

from google.adk.runners import InMemoryRunner
from google.genai import types

from streamlens.agents.analyst import root_agent

DEFAULT_PROMPT = "What data do you have access to?"


async def main(prompt: str) -> None:
    runner = InMemoryRunner(agent=root_agent, app_name="streamlens")
    session = await runner.session_service.create_session(
        app_name="streamlens", user_id="local"
    )

    message = types.Content(role="user", parts=[types.Part(text=prompt)])
    print(f"\n\033[1muser>\033[0m {prompt}\n")

    async for event in runner.run_async(
        user_id="local", session_id=session.id, new_message=message
    ):
        for part in (event.content.parts if event.content else []) or []:
            if part.function_call:
                print(
                    f"\033[36m  tool call\033[0m {part.function_call.name}"
                    f"({part.function_call.args})"
                )
            elif part.function_response:
                response = str(part.function_response.response)
                if len(response) > 500:
                    response = response[:500] + " ...[truncated]"
                print(f"\033[32m  tool result\033[0m {response}")
            elif part.text and event.author != "user":
                print(part.text, end="")

    print("\n")
    await runner.close()


if __name__ == "__main__":
    asyncio.run(main(" ".join(sys.argv[1:]) or DEFAULT_PROMPT))
