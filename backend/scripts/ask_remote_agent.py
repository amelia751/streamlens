"""Query the analyst agent running on Agent Runtime.

    uv run python scripts/ask_remote_agent.py "what data do you have access to?"

Unlike `ask_agent.py`, nothing runs locally: this calls the deployed
reasoning engine, which in turn calls the ClickHouse MCP server on Cloud
Run. The resource id comes from STREAMLENS_AGENT_ENGINE_ID.
"""

from __future__ import annotations

import os
import sys

import vertexai

DEFAULT_PROMPT = "What data do you have access to?"
PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "pctg-503822")
REGION = os.environ.get("STREAMLENS_AGENT_ENGINE_REGION", "us-central1")
ENGINE_ID = os.environ.get("STREAMLENS_AGENT_ENGINE_ID", "3345740765799120896")


def main(prompt: str) -> None:
    client = vertexai.Client(project=PROJECT, location=REGION)
    name = f"projects/{PROJECT}/locations/{REGION}/reasoningEngines/{ENGINE_ID}"
    agent = client.agent_engines.get(name=name)

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
