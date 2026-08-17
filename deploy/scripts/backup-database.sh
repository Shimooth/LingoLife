#!/usr/bin/env bash
set -euo pipefail
[[ "$(id -un)" == "lingolife-deploy" ]] || { echo "Run as lingolife-deploy." >&2; exit 1; }
DATA_DIR=/opt/lingolife/data
BACKUP_DIR=/opt/lingolife/backups
SOURCE="${DATA_DIR}/lingolife.db"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/lingolife-${STAMP}.db"
test -f "${SOURCE}" || { echo "Database not found: ${SOURCE}" >&2; exit 1; }
test -d "${BACKUP_DIR}" || { echo "Backup directory not found; rerun install-host.sh." >&2; exit 1; }
COMPOSE_FILE=/opt/lingolife/app/deploy/compose.yaml
IMAGE_ID="$(docker compose -f "${COMPOSE_FILE}" images -q api)"
test -n "${IMAGE_ID}" || { echo "API image not found; deploy first." >&2; exit 1; }
docker run --rm --user 10001:10001 --mount type=bind,src="${DATA_DIR}",dst=/data --mount type=bind,src="${BACKUP_DIR}",dst=/backups "${IMAGE_ID}" python -c "import sqlite3; src=sqlite3.connect('/data/lingolife.db'); dst=sqlite3.connect('/backups/lingolife-${STAMP}.db'); src.backup(dst); dst.close(); src.close()"
test -s "${TARGET}"
echo "Database backup created: ${TARGET}"
