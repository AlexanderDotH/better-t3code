#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: run-ts-script.sh <script.ts> [args...]" >&2
  exit 2
fi

SCRIPT_PATH="$1"
shift

run_with_node() {
  node "$SCRIPT_PATH" "$@"
}

run_with_bun() {
  bun run "$SCRIPT_PATH" "$@"
}

if node_output="$(run_with_node "$@" 2>&1)"; then
  if [[ -n "$node_output" ]]; then
    echo "$node_output"
  fi
  exit 0
else
  node_status=$?
fi

if grep -q "ERR_UNKNOWN_FILE_EXTENSION" <<< "$node_output" && command -v bun >/dev/null 2>&1; then
  echo "info: Node could not execute '$SCRIPT_PATH' (ERR_UNKNOWN_FILE_EXTENSION), falling back to bun run" >&2
  run_with_bun "$@"
  exit $?
fi

echo "error: Node cannot execute TypeScript scripts for '$SCRIPT_PATH' on this runtime." >&2
echo "error: install Bun (https://bun.sh) or use Node.js with native TypeScript support (current: $(node -v))." >&2
if grep -Eq "Cannot find (module|package)" <<< "$node_output"; then
  echo "hint: if this happens with missing workspace packages (e.g. @t3tools/*), your installation appears incomplete." >&2
  echo "hint: rerun the build script without --no-install-deps (or reinstall node_modules cleanly)." >&2
fi
if [[ -n "$node_output" ]]; then
  echo "$node_output" >&2
fi
exit "$node_status"
