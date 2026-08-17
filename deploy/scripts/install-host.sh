#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
fi

APP_ROOT=/opt/lingolife
APP_USER=lingolife

apt-get update
apt-get install -y --no-install-recommends python3-venv nginx certbot python3-certbot-nginx

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_ROOT}" --shell /usr/sbin/nologin "${APP_USER}"
fi

install -d -o "${APP_USER}" -g "${APP_USER}" -m 0755 "${APP_ROOT}/app"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${APP_ROOT}/data"
install -d -o root -g "${APP_USER}" -m 0750 /etc/lingolife

if [[ ! -e "${APP_ROOT}/venv/bin/python" ]]; then
  python3 -m venv "${APP_ROOT}/venv"
fi

echo "Host directories and packages are ready. Continue with deploy-release.sh."
