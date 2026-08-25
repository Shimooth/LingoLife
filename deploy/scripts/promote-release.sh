#!/usr/bin/env bash
set -euo pipefail

[[ "$(id -un)" == "lingolife-deploy" ]] || {
  echo "Run this script as lingolife-deploy." >&2
  exit 1
}

PACKAGE="${1:-}"
EXPECTED_SHA256="${2:-}"
APP_ROOT=/opt/lingolife/app
MIRROR_ROOT=/home/lingolife-deploy/lingolife-release
RELEASE_ROOT=/home/lingolife-deploy/lingolife-releases

[[ "${PACKAGE}" == /home/lingolife-deploy/* ]] || {
  echo "Release package must be below /home/lingolife-deploy." >&2
  exit 1
}
test -f "${PACKAGE}" || { echo "Release package not found: ${PACKAGE}" >&2; exit 1; }
if [[ -n "${EXPECTED_SHA256}" ]]; then
  [[ "${EXPECTED_SHA256}" =~ ^[0-9a-f]{64}$ ]] || { echo "Invalid SHA-256." >&2; exit 1; }
  printf '%s  %s\n' "${EXPECTED_SHA256}" "${PACKAGE}" | sha256sum --check --status || {
    echo "Release package checksum mismatch." >&2
    exit 1
  }
fi
test -d "${APP_ROOT}"
test -d "${MIRROR_ROOT}"
command -v rsync >/dev/null

mkdir -p "${RELEASE_ROOT}"
STAGE="$(mktemp -d "${RELEASE_ROOT}/incoming.XXXXXX")"
cleanup_stage() {
  case "${STAGE}" in
    "${RELEASE_ROOT}"/incoming.*) rm -rf -- "${STAGE}" ;;
    *) echo "Refusing to clean unexpected staging path: ${STAGE}" >&2 ;;
  esac
}
trap cleanup_stage EXIT
tar -xf "${PACKAGE}" -C "${STAGE}"
test -s "${STAGE}/web/dist/index.html" || { echo "Release is missing web/dist/index.html." >&2; exit 1; }
test -x "${STAGE}/deploy/scripts/deploy-release.sh" || { echo "Release deploy script is not executable." >&2; exit 1; }
test -x "${STAGE}/deploy/scripts/backup-database.sh" || { echo "Release backup script is not executable." >&2; exit 1; }
test -f "${STAGE}/.source-revision" || { echo "Release is missing .source-revision." >&2; exit 1; }
SOURCE_REVISION="$(tr -d '[:space:]' < "${STAGE}/.source-revision")"
[[ "${SOURCE_REVISION}" =~ ^[0-9a-f]{40,64}$ ]] || { echo "Invalid .source-revision." >&2; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROLLBACK="${RELEASE_ROOT}/rollback-${STAMP}"
mkdir "${ROLLBACK}"
rsync -a "${APP_ROOT}/" "${ROLLBACK}/"
OLD_IMAGE="$(docker compose -f "${APP_ROOT}/deploy/compose.yaml" images -q api)"
test -n "${OLD_IMAGE}" || { echo "Current API image not found." >&2; exit 1; }
"${APP_ROOT}/deploy/scripts/backup-database.sh"

promote() {
  rsync -a --delete "${STAGE}/" "${APP_ROOT}/" &&
    rsync -a --delete "${STAGE}/" "${MIRROR_ROOT}/" &&
    "${APP_ROOT}/deploy/scripts/deploy-release.sh"
}

set +e
promote
PROMOTE_STATUS=$?
set -e
if (( PROMOTE_STATUS != 0 )); then
  echo "Release failed; restoring the previous source tree and image inputs." >&2
  rsync -a --delete "${ROLLBACK}/" "${APP_ROOT}/"
  rsync -a --delete "${ROLLBACK}/" "${MIRROR_ROOT}/"
  docker tag "${OLD_IMAGE}" lingolife-api:local
  set +e
  docker compose -f "${APP_ROOT}/deploy/compose.yaml" up -d --no-build --remove-orphans api
  ROLLBACK_STATUS=$?
  if (( ROLLBACK_STATUS == 0 )); then
    for attempt in {1..20}; do
      if curl --fail --silent http://127.0.0.1:8010/api/v1/health >/dev/null; then
        ROLLBACK_STATUS=0
        break
      fi
      ROLLBACK_STATUS=1
      sleep 2
    done
  fi
  set -e
  if (( ROLLBACK_STATUS != 0 )); then
    echo "Automatic rollback also failed. Previous image: ${OLD_IMAGE}; rollback tree: ${ROLLBACK}" >&2
    exit 2
  fi
  echo "Previous release restored. Image before promotion: ${OLD_IMAGE}; rollback tree: ${ROLLBACK}" >&2
  exit "${PROMOTE_STATUS}"
fi

while IFS= read -r old_rollback; do
  case "${old_rollback}" in
    "${RELEASE_ROOT}"/rollback-*) rm -rf -- "${old_rollback}" ;;
    *) echo "Refusing to prune unexpected rollback path: ${old_rollback}" >&2 ;;
  esac
done < <(
  find "${RELEASE_ROOT}" -mindepth 1 -maxdepth 1 -type d -name 'rollback-*' -printf '%T@ %p\n' \
    | sort -rn \
    | tail -n +4 \
    | cut -d' ' -f2-
)

echo "Release promoted: ${SOURCE_REVISION}"
echo "Previous image: ${OLD_IMAGE}"
echo "Rollback tree: ${ROLLBACK}"
