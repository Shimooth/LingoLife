#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root after the repository exists at /opt/lingolife/app." >&2
  exit 1
fi

PROJECT_ROOT=/opt/lingolife/app
BACKEND_ROOT="${PROJECT_ROOT}/backend"
VENV_ROOT=/opt/lingolife/venv

test -f "${BACKEND_ROOT}/requirements.txt"
test -f /etc/lingolife/lingolife.env

"${VENV_ROOT}/bin/pip" install --disable-pip-version-check --no-cache-dir -r "${BACKEND_ROOT}/requirements.txt"
chown -R lingolife:lingolife "${PROJECT_ROOT}" /opt/lingolife/data
chmod 0750 /etc/lingolife
chmod 0640 /etc/lingolife/lingolife.env

install -o root -g root -m 0644 "${PROJECT_ROOT}/deploy/systemd/lingolife-api.service" /etc/systemd/system/lingolife-api.service
install -o root -g root -m 0644 "${PROJECT_ROOT}/deploy/nginx/lingolife.api.shimooth.me.conf" /etc/nginx/sites-available/lingolife.api.shimooth.me.conf
ln -sfn /etc/nginx/sites-available/lingolife.api.shimooth.me.conf /etc/nginx/sites-enabled/lingolife.api.shimooth.me.conf

systemctl daemon-reload
nginx -t
systemctl enable --now lingolife-api.service
systemctl reload nginx

curl --fail --silent --show-error http://127.0.0.1:8010/api/v1/health
echo
echo "Local health check passed. Issue TLS separately after DNS and HTTP are verified."
