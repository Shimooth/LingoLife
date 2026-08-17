#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -un)" != "lingolife-deploy" ]]; then
  echo "Run this script as lingolife-deploy." >&2
  exit 1
fi

PROJECT_ROOT=/opt/lingolife/app
COMPOSE_FILE="${PROJECT_ROOT}/deploy/compose.yaml"
ENV_FILE=/etc/lingolife/lingolife.env
test -f "${COMPOSE_FILE}"
test -r "${ENV_FILE}" || { echo "Cannot read ${ENV_FILE}." >&2; exit 1; }
test "$(stat -c '%a' "${ENV_FILE}")" = 640 || { echo "${ENV_FILE} must have mode 0640." >&2; exit 1; }
docker compose version >/dev/null
cd "${PROJECT_ROOT}"
SOURCE_REVISION="$(git rev-parse --short HEAD 2>/dev/null || echo archive)"
docker compose -f "${COMPOSE_FILE}" build --pull api
docker compose -f "${COMPOSE_FILE}" up -d --remove-orphans api
for attempt in {1..20}; do
  if curl --fail --silent http://127.0.0.1:8010/api/v1/health >/dev/null; then
    echo "Local health check passed. Source revision: ${SOURCE_REVISION}"
    exit 0
  fi
  sleep 2
done
docker compose -f "${COMPOSE_FILE}" ps
docker compose -f "${COMPOSE_FILE}" logs --tail=100 api
echo "Deployment failed its health check." >&2
exit 1
