#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -un)" != "lingolife-deploy" ]]; then
  echo "Run this script as lingolife-deploy." >&2
  exit 1
fi

PROJECT_ROOT=/opt/lingolife/app
BACKEND_ROOT="${PROJECT_ROOT}/backend"
VENV_ROOT="${BACKEND_ROOT}/.venv"

test -f "${BACKEND_ROOT}/requirements.txt"

if [[ ! -x "${VENV_ROOT}/bin/python" ]]; then
  python3 -m venv "${VENV_ROOT}"
fi
"${VENV_ROOT}/bin/pip" install --disable-pip-version-check --no-cache-dir -r "${BACKEND_ROOT}/requirements.txt"

sudo /usr/bin/systemctl restart lingolife-api.service

curl --fail --silent --show-error http://127.0.0.1:8010/api/v1/health
echo
echo "Local health check passed."
