#!/usr/bin/env bash
# Deploy both halves of the Streamlens backend.
#
#   ./deploy/deploy.sh mcp      # ClickHouse MCP server -> Cloud Run
#   ./deploy/deploy.sh agent    # analyst agent -> Agent Runtime (read-only)
#   ./deploy/deploy.sh secrets  # push ClickHouse creds to Secret Manager
#
# Run from the backend/ directory. Requires the owner key described in
# ../.cursor/rules/gcloud-owner-key.mdc.
set -euo pipefail

PROJECT=pctg-503822
REGION=us-central1
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND="$REPO_ROOT/backend"

export CLOUDSDK_CONFIG="$REPO_ROOT/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="$REPO_ROOT/secrets/pctg-sa.json"
export CLOUDSDK_CORE_PROJECT="$PROJECT"

MCP_SA="streamlens-mcp@${PROJECT}.iam.gserviceaccount.com"
MCP_SERVICE=streamlens-clickhouse-mcp
AGENT_ENGINE_ID=3345740765799120896

case "${1:-}" in
secrets)
  set -a && source "$REPO_ROOT/secrets/clickhouse.env" && set +a
  for pair in \
    "streamlens-clickhouse-host:$CLICKHOUSE_HOST" \
    "streamlens-clickhouse-user:$CLICKHOUSE_USER" \
    "streamlens-clickhouse-password:$CLICKHOUSE_PASSWORD"; do
    name="${pair%%:*}"
    gcloud secrets describe "$name" >/dev/null 2>&1 ||
      gcloud secrets create "$name" --replication-policy=automatic
    printf '%s' "${pair#*:}" | gcloud secrets versions add "$name" --data-file=-
    gcloud secrets add-iam-policy-binding "$name" \
      --member="serviceAccount:${MCP_SA}" \
      --role=roles/secretmanager.secretAccessor >/dev/null
  done
  ;;

mcp)
  # CLICKHOUSE_MCP_ALLOWED_HOSTS is the server's DNS-rebinding guard; it
  # rejects any Host header not listed, so both Cloud Run hostnames are
  # pinned. --no-allow-unauthenticated is what makes IAM the gate.
  cd "$BACKEND/deploy/clickhouse-mcp"
  gcloud run deploy "$MCP_SERVICE" \
    --source . --region "$REGION" --no-allow-unauthenticated \
    --service-account "$MCP_SA" \
    --set-env-vars "^|^CLICKHOUSE_PORT=8443|CLICKHOUSE_MCP_ALLOWED_HOSTS=${MCP_SERVICE}-z4v26zjidq-uc.a.run.app,${MCP_SERVICE}-148137280149.${REGION}.run.app" \
    --set-secrets 'CLICKHOUSE_HOST=streamlens-clickhouse-host:latest,CLICKHOUSE_USER=streamlens-clickhouse-user:latest,CLICKHOUSE_PASSWORD=streamlens-clickhouse-password:latest' \
    --memory 1Gi --timeout 600 --max-instances 3
  ;;

agent)
  # The same agent the Studio chat runs, but deployed without warehouse
  # credentials: it reaches ClickHouse through the IAM-gated Cloud Run MCP,
  # which holds them itself. `agents/analyst.authoring_enabled()` sees that
  # and attaches neither the dashboard nor the proposal server, so the
  # deployed agent reads and does not write — and its instruction never
  # offers a tool it does not have.
  cd "$BACKEND"
  # The temp folder must sit outside the package tree: ADK copies
  # --extra_packages into it, and a temp folder inside streamlens/ makes
  # that copy recurse until the path length blows up.
  find streamlens -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null || true
  rm -rf /tmp/streamlens-agent-build
  uv run adk deploy agent_engine \
    --project "$PROJECT" --region "$REGION" \
    --agent_engine_id "$AGENT_ENGINE_ID" \
    --display_name "Streamlens Analyst" \
    --temp_folder /tmp/streamlens-agent-build \
    --env_file "$BACKEND/deploy/agent-runtime.vars" \
    --requirements_file "$BACKEND/streamlens/agents/analyst/requirements.txt" \
    --extra_packages "$BACKEND/streamlens" \
    --session_service_uri "memory://" \
    "$BACKEND/streamlens/agents/analyst"
  ;;

*)
  echo "usage: $0 {secrets|mcp|agent}" >&2
  exit 1
  ;;
esac
