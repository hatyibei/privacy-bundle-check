#!/usr/bin/env bash
# Run the bundled CLI against the checked-in fixtures. Used by CI after `npm run build`.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cli="$root/dist/cli.cjs"
if [[ ! -f "$cli" ]]; then
  echo "dist/cli.cjs is missing; run npm run build first" >&2
  exit 1
fi

expect() {
  local want="$1"
  shift
  set +e
  "$cli" "$@"
  local got=$?
  set -e
  if [[ "$got" -ne "$want" ]]; then
    echo "expected exit $want, got $got from: $*" >&2
    exit 1
  fi
}

expect 0 scan "$root/fixtures/app-ok"
expect 0 scan "$root/fixtures/xcarchive-ok"
expect 1 scan "$root/fixtures/app-missing-manifest"
expect 1 scan "$root/fixtures/app-undeclared-api"
expect 1 scan "$root/fixtures/app-duplicate-privacy"
expect 1 scan "$root/fixtures/project-source" --mode project
echo "fixtures: ok"
