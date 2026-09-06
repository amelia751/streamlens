# The ClickHouse Cloud MCP server, as its own Cloud Run service.
#
# It runs in a separate image from the agent on purpose: ADK requires
# mcp<2 while mcp-clickhouse pulls mcp 2.x through FastMCP 4, so the two
# cannot share an interpreter. Splitting them across a network boundary
# resolves the conflict and lets the agent run on Agent Runtime, which has
# no way to spawn a stdio subprocess.
FROM python:3.13-slim

RUN pip install --no-cache-dir mcp-clickhouse==0.6.0

# Serve MCP over streamable HTTP instead of stdio.
ENV CLICKHOUSE_MCP_SERVER_TRANSPORT=http \
    CLICKHOUSE_MCP_BIND_HOST=0.0.0.0 \
    CLICKHOUSE_SECURE=true \
    CLICKHOUSE_VERIFY=true \
    CLICKHOUSE_CONNECT_TIMEOUT=30 \
    CLICKHOUSE_SEND_RECEIVE_TIMEOUT=300 \
    CHDB_ENABLED=false

# The server's own bearer-token auth is off because Cloud Run IAM is the
# gate: the service is deployed --no-allow-unauthenticated, so every
# request must carry a Google-signed ID token from a principal holding
# roles/run.invoker. CLICKHOUSE_ALLOW_WRITE_ACCESS is never set, so the
# server rejects INSERT, ALTER, and DROP.
ENV CLICKHOUSE_MCP_AUTH_DISABLED=true

# Cloud Run injects PORT; mcp-clickhouse reads CLICKHOUSE_MCP_BIND_PORT.
CMD ["sh", "-c", "CLICKHOUSE_MCP_BIND_PORT=${PORT:-8080} exec mcp-clickhouse"]
