#!/usr/bin/env bash
set -euo pipefail
[[ "$(id -un)" == "lingolife-deploy" ]] || { echo "Run as lingolife-deploy." >&2; exit 1; }
DATA_DIR=/opt/lingolife/data
BACKUP_DIR=/opt/lingolife/backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/lingolife-${STAMP}.db"
test -d "${BACKUP_DIR}" || { echo "Backup directory not found; rerun install-host.sh." >&2; exit 1; }
COMPOSE_FILE=/opt/lingolife/app/deploy/compose.yaml
IMAGE_ID="$(docker compose -f "${COMPOSE_FILE}" images -q api)"
test -n "${IMAGE_ID}" || { echo "API image not found; deploy first." >&2; exit 1; }
docker run --rm --user 10001:10001 --mount type=bind,src="${DATA_DIR}",dst=/data,readonly --mount type=bind,src="${BACKUP_DIR}",dst=/backups "${IMAGE_ID}" python -c "import os, sqlite3; source='/data/lingolife.db'; target='/backups/lingolife-${STAMP}.db'; assert os.path.isfile(source), f'Database not found: {source}'; src=sqlite3.connect(f'file:{source}?mode=ro', uri=True); dst=sqlite3.connect(target); src.backup(dst); dst.close(); src.close(); assert os.path.getsize(target) > 0, f'Empty backup: {target}'"
echo "Database backup created: ${TARGET}"
