#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

APP_ROOT=/opt/lingolife
APP_USER=lingolife
DEPLOY_USER=lingolife-deploy

apt-get update
apt-get install -y --no-install-recommends python3-venv nginx certbot python3-certbot-nginx

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_ROOT}" --shell /usr/sbin/nologin "${APP_USER}"
fi

id "${DEPLOY_USER}" >/dev/null 2>&1 || { echo "Missing ${DEPLOY_USER} user." >&2; exit 1; }

install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 0755 "${APP_ROOT}/app"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${APP_ROOT}/data"
install -d -o root -g "${APP_USER}" -m 0750 /etc/lingolife

echo "Host directories and packages are ready. Copy the repository into ${APP_ROOT}/app, then continue with the root-only configuration steps in deploy/README.md."
