#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

APP_ROOT=/opt/lingolife
DEPLOY_USER=lingolife-deploy
CONTAINER_UID=10001

apt-get update
apt-get install -y --no-install-recommends nginx certbot python3-certbot-nginx curl
if ! command -v docker >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends docker.io
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends docker-compose-v2
fi

id "${DEPLOY_USER}" >/dev/null 2>&1 || { echo "Missing ${DEPLOY_USER} user." >&2; exit 1; }

install -d -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" -m 0755 "${APP_ROOT}/app"
install -d -o "${CONTAINER_UID}" -g "${CONTAINER_UID}" -m 0750 "${APP_ROOT}/data"
install -d -o "${CONTAINER_UID}" -g "${CONTAINER_UID}" -m 0750 "${APP_ROOT}/backups"
install -d -o root -g "${DEPLOY_USER}" -m 0750 /etc/lingolife

systemctl enable --now docker
usermod -aG docker "${DEPLOY_USER}"

echo "Docker host setup is ready. Reconnect ${DEPLOY_USER}'s SSH session before deploying."
