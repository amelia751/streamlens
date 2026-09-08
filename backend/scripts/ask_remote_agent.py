"""Query the analyst agent running on Agent Runtime.

    uv run python scripts/ask_remote_agent.py "what data do you have access to?"

Unlike `ask_agent.py`, nothing runs locally: this calls the deployed
reasoning engine, which in turn calls the ClickHouse MCP server on Cloud
Run. The resource id comes from STREAMLENS_AGENT_ENGINE_ID.

The deployed agent is the same `agents/analyst` the Studio chat runs, minus
the authoring toolsets — it holds no warehouse credentials, so it reads and
does not write. See `agents/analyst.authoring_enabled`.
"""

from __future__ import annotations

import sys

from streamlens.services.gcp.gcp_services import agent_engine

DEFAULT_PROMPT = "What data do you have access to?"


def main(prompt: str) -> None:
    # The handle is built in the Google Cloud service registry, which is the
    # only place a Google client is constructed. Project, region and engine
    # id all come from `config.google_cloud_settings`.
    agent = agent_engine()

    print(f"\n\033[1muser>\033[0m {prompt}\n")

    # No session_id: the deployed ADK server creates and owns the session.
    for event in agent.stream_query(user_id="local", message=prompt):
        for part in event.get("content", {}).get("parts", []):
            if call := part.get("function_call"):
                print(f"\033[36m  tool call\033[0m {call['name']}({call.get('args')})")
            elif response := part.get("function_response"):
                text = str(response.get("response"))
                if len(text) > 400:
                    text = text[:400] + " ...[truncated]"
                print(f"\033[32m  tool result\033[0m {text}")
            elif text := part.get("text"):
                print(text, end="")
    print("\n")


if __name__ == "__main__":
    main(" ".join(sys.argv[1:]) or DEFAULT_PROMPT)
