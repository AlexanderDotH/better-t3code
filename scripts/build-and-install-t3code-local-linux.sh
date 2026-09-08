#!/usr/bin/env bash
# Legacy entry point retained as a build-only Linux AppImage workflow.
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "error: run as a normal user; this workflow never uses sudo" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
RELEASE_DIR="$ROOT/apps/desktop/release"
INSTALL_DEPS=true
PNPM_SHIM_DIR=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/build-and-install-t3code-local-linux.sh [--no-install-deps]

Builds the current checkout in a temporary directory, verifies required feature
markers, and records build provenance. This is a build-only workflow: it never
installs, starts, stops, or restarts T3 Code.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      echo "error: --profile is no longer accepted by this build-only workflow" >&2
      echo "Installation requires a separate, explicit later user action." >&2
      exit 78
      ;;
    --no-install-deps)
      INSTALL_DEPS=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

CANONICAL_CHECKOUT="${T3CODE_CANONICAL_CHECKOUT:-/home/alex/Workspace/Projects/Apps/better-t3code}"
if [[ -d "$CANONICAL_CHECKOUT" ]]; then
  CANONICAL_ROOT="$(cd "$CANONICAL_CHECKOUT" && pwd -P)"
  if [[ "$ROOT" != "$CANONICAL_ROOT" ]]; then
    echo "error: $ROOT is not the canonical T3 Code checkout" >&2
    echo "Build from $CANONICAL_ROOT instead." >&2
    exit 78
  fi
fi

if [[ "$(uname -s)" != Linux ]]; then
  echo "error: Linux AppImage builds are only supported on Linux" >&2
  exit 1
fi
if [[ ! -f "$ROOT/package.json" ]]; then
  echo "error: incomplete repository checkout at $ROOT" >&2
  exit 1
fi

cd "$ROOT"

resolve_pnpm_runner() {
  local pnpm_error=""
  if command -v pnpm >/dev/null 2>&1; then
    if pnpm -v >/dev/null 2>&1; then
      PNPM_BIN="$(command -v pnpm)"
      PNPM_COREPACK_ROOT=""
      return
    fi
    pnpm_error="$(pnpm -v 2>&1 || true)"
    if [[ "$pnpm_error" == *"ERR_UNKNOWN_BUILTIN_MODULE"* ]] || [[ "$pnpm_error" == *"This version of pnpm requires at least Node.js"* ]]; then
      echo "warning: installed pnpm is not compatible with Node.js $(node -v)" >&2
    else
      echo "warning: unable to use pnpm: $pnpm_error" >&2
    fi
  fi

  local bundled_pnpm_bin="$HOME/.vite-plus/package_manager/pnpm/10.24.0/pnpm/bin/pnpm.cjs"
  if [[ -f "$bundled_pnpm_bin" ]]; then
    PNPM_BIN="$bundled_pnpm_bin"
    PNPM_COREPACK_ROOT="/tmp/t3code-pnpm-corepack-compat"
    return
  fi

  echo "error: no compatible pnpm executable found." >&2
  echo "error: install a newer Node.js + pnpm toolchain or ensure Node.js >=22.13 for pnpm@11+" >&2
  exit 1
}

run_pnpm() {
  if [[ -n "${PNPM_COREPACK_ROOT:-}" ]]; then
    COREPACK_ROOT="$PNPM_COREPACK_ROOT" node "$PNPM_BIN" "$@"
  else
    "$PNPM_BIN" "$@"
  fi
}

resolve_pnpm_runner
if [[ -n "${PNPM_COREPACK_ROOT:-}" ]]; then
  export COREPACK_ROOT="$PNPM_COREPACK_ROOT"
  export T3CODE_PNPM_COREPACK_ROOT="$PNPM_COREPACK_ROOT"
fi
if [[ "$PNPM_BIN" == *"/pnpm/"* ]]; then
  T3CODE_PNPM_MANAGER="${PNPM_BIN#*/pnpm/}"
  T3CODE_PNPM_MANAGER="${T3CODE_PNPM_MANAGER%%/*}"
  export T3CODE_PNPM_MANAGER="pnpm@${T3CODE_PNPM_MANAGER}"
elif [[ -x "${PNPM_BIN:-}" ]]; then
  T3CODE_PNPM_MANAGER="$("$PNPM_BIN" -v 2>/dev/null | sed -n '1,1p' | tr -d '[:space:]')"
  if [[ -n "${T3CODE_PNPM_MANAGER:-}" ]]; then
    export T3CODE_PNPM_MANAGER="pnpm@${T3CODE_PNPM_MANAGER}"
  fi
fi
if [[ -z "${T3CODE_PNPM_MANAGER:-}" ]]; then
  export T3CODE_PNPM_MANAGER="pnpm@11.10.0"
fi
if [[ -n "${PNPM_BIN:-}" ]]; then
  PNPM_SHIM_DIR="$(mktemp -d /tmp/t3code-pnpm-bin-XXXXXX)"
  T3CODE_PNPM_BIN="$PNPM_SHIM_DIR/pnpm"
  cat >"$T3CODE_PNPM_BIN" <<EOF
#!/usr/bin/env sh
exec node "$PNPM_BIN" "\$@"
EOF
  chmod +x "$T3CODE_PNPM_BIN"
  export T3CODE_PNPM_BIN
  export PATH="$PNPM_SHIM_DIR:$PATH"
fi

if $INSTALL_DEPS && {
  [[ ! -d "$ROOT/node_modules" ]] || \
  [[ ! -d "$ROOT/node_modules/.pnpm" ]] || \
  [[ ! -d "$ROOT/node_modules/@t3tools/shared" ]];
}; then
  echo "==> pnpm install --frozen-lockfile"
  run_pnpm install --frozen-lockfile
fi
if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "error: node_modules is missing; rerun without --no-install-deps" >&2
  exit 1
fi

BUILD_OUT="$(mktemp -d -p /tmp t3code-local-build-XXXXXX)"
RELEASE_TEMP="$RELEASE_DIR/.T3Code.AppImage.new.$$"
cleanup() {
  rm -rf "$BUILD_OUT"
  rm -f "$RELEASE_TEMP"
  if [[ -n "${PNPM_SHIM_DIR:-}" ]]; then
    rm -rf "$PNPM_SHIM_DIR"
  fi
}
trap cleanup EXIT

echo "==> building Linux AppImage in $BUILD_OUT"
T3CODE_DESKTOP_OUTPUT_DIR="$BUILD_OUT" run_pnpm run dist:desktop:linux

shopt -s nullglob
artifacts=("$BUILD_OUT"/*.AppImage)
shopt -u nullglob
if [[ ${#artifacts[@]} -ne 1 ]]; then
  echo "error: expected exactly one AppImage in $BUILD_OUT, found ${#artifacts[@]}" >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR"
install -m 0755 "${artifacts[0]}" "$RELEASE_TEMP"
PERSISTED_APPIMAGE="$RELEASE_DIR/T3Code.AppImage"
mv "$RELEASE_TEMP" "$PERSISTED_APPIMAGE"

INSPECT_DIR="$BUILD_OUT/inspect"
mkdir -p "$INSPECT_DIR"
(
  cd "$INSPECT_DIR"
  "$PERSISTED_APPIMAGE" --appimage-extract >/dev/null
)
PACKAGED_RESOURCES="$INSPECT_DIR/squashfs-root/resources"
if [[ ! -d "$PACKAGED_RESOURCES" ]]; then
  echo "error: AppImage extraction did not produce packaged resources" >&2
  exit 1
fi

declare -a FEATURE_MARKERS=(
  "McpConfigEngine"
  "SkillEngine"
  "t3ChatImport"
  "ThreadTranscriptExport"
  "AssemblyAiStreamingToken"
  "t3-assemblyai-pcm16"
  "GrokDriver"
  "ProviderInstanceRegistry reconcile failed"
  'max: "Maximum"'
)
MARKER_REPORT="$RELEASE_DIR/T3Code.AppImage.feature-markers.txt"
: >"$MARKER_REPORT"
for marker in "${FEATURE_MARKERS[@]}"; do
  if ! rg -a -F -q -- "$marker" "$PACKAGED_RESOURCES"; then
    echo "error: packaged AppImage is missing required feature marker: $marker" >&2
    exit 1
  fi
  printf 'present\t%s\n' "$marker" >>"$MARKER_REPORT"
done

HEAD_REVISION="$(git rev-parse HEAD)"
PACKAGE_VERSION="$(node -p "require('./apps/desktop/package.json').version")"
ARTIFACT_SIZE="$(stat -c %s "$PERSISTED_APPIMAGE")"
ARTIFACT_SHA256="$(sha256sum "$PERSISTED_APPIMAGE" | awk '{print $1}')"
DIRTY_TREE_HASH="$({
  git diff --binary --cached
  git diff --binary
  while IFS= read -r -d '' path; do
    printf 'untracked %s\0' "$path"
    sha256sum -- "$path"
  done < <(git ls-files --others --exclude-standard -z | sort -z)
} | sha256sum | awk '{print $1}')"

BUILD_INFO="$RELEASE_DIR/T3Code.AppImage.build-info.txt"
cat >"$BUILD_INFO" <<EOF
head=$HEAD_REVISION
dirty_tree_sha256=$DIRTY_TREE_HASH
package_version=$PACKAGE_VERSION
artifact_size_bytes=$ARTIFACT_SIZE
artifact_sha256=$ARTIFACT_SHA256
EOF

echo "==> verified all required feature markers"
echo "==> artifact: $PERSISTED_APPIMAGE"
echo "==> sha256: $ARTIFACT_SHA256"
echo "==> build-only workflow complete; no T3 Code installation or process action was performed"
echo "==> installation requires a separate, explicit later user action"
