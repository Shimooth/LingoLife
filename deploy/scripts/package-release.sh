#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${PROJECT_ROOT}"

test -z "$(git status --porcelain --untracked-files=normal)" || {
  echo "Working tree changes and untracked source files must be committed before packaging." >&2
  exit 1
}

REVISION="$(git rev-parse --short HEAD)"
TARGET="${1:-/tmp/lingolife-${REVISION}.tar}"
case "${TARGET}" in
  /*) ;;
  *) TARGET="${PROJECT_ROOT}/${TARGET}" ;;
esac

echo "Building the production web client locally..."
npm --prefix web ci
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run build
test -s web/dist/index.html

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT
ARCHIVE="${TEMP_DIR}/release.tar"
git archive --format=tar --output="${ARCHIVE}" HEAD
COPYFILE_DISABLE=1 tar --format ustar --no-xattrs --append --file="${ARCHIVE}" web/dist
mv "${ARCHIVE}" "${TARGET}"
echo "Release package created: ${TARGET} (${REVISION})"
