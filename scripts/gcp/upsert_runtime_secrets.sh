#!/usr/bin/env bash
# Push API runtime credentials into Secret Manager. Values are piped and
# never printed. The Cloud Run service account is granted accessor on each.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$REPO_ROOT/.gcloud}"
export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-$REPO_ROOT/secrets/pctg-sa.json}"
export CLOUDSDK_CORE_PROJECT="${CLOUDSDK_CORE_PROJECT:-pctg-503822}"

set -a
# shellcheck disable=SC1091
source "$REPO_ROOT/secrets/clickhouse.env"
# shellcheck disable=SC1091
source "$REPO_ROOT/secrets/tmdb.env"
set +a

API_SA="streamlens-api@${CLOUDSDK_CORE_PROJECT}.iam.gserviceaccount.com"

upsert() {
  local name="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    echo "skip ${name}: empty" >&2
    return 1
  fi
  if ! gcloud secrets describe "${name}" >/dev/null 2>&1; then
    gcloud secrets create "${name}" --replication-policy=automatic >/dev/null
  fi
  printf '%s' "${value}" | gcloud secrets versions add "${name}" --data-file=- >/dev/null
  gcloud secrets add-iam-policy-binding "${name}" \
    --member="serviceAccount:${API_SA}" \
    --role=roles/secretmanager.secretAccessor \
    --quiet >/dev/null
  echo "ok ${name}"
}

upsert streamlens-clickhouse-host "${CLICKHOUSE_HOST}"
upsert streamlens-clickhouse-user "${CLICKHOUSE_USER}"
upsert streamlens-clickhouse-password "${CLICKHOUSE_PASSWORD}"
upsert streamlens-clickhouse-reader-user "${CLICKHOUSE_READER_USER}"
upsert streamlens-clickhouse-reader-password "${CLICKHOUSE_READER_PASSWORD}"
upsert streamlens-clickhouse-cloud-api-key "${CLICKHOUSE_CLOUD_API_KEY}"
upsert streamlens-clickhouse-cloud-api-secret "${CLICKHOUSE_CLOUD_API_SECRET}"
upsert streamlens-clickhouse-org-id "${CLICKHOUSE_ORG_ID}"
upsert streamlens-clickhouse-service-id "${CLICKHOUSE_SERVICE_ID}"
upsert streamlens-tmdb-read-access-token "${TMDB_READ_ACCESS_TOKEN}"
upsert streamlens-tmdb-api-key "${TMDB_API_KEY}"
