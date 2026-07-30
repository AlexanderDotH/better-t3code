#!/usr/bin/env bash
# Build the current checkout and install it as the user-local T3 Code build.
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "error: run as a normal user; this workflow never uses sudo" >&2
  exit 1
fi

CANONICAL_LOCAL_APPIMAGE="${T3CODE_CANONICAL_LOCAL_APPIMAGE:-/opt/t3code-git/t3code}"
if [[ -e "$CANONICAL_LOCAL_APPIMAGE" ]]; then
  echo "error: canonical Local T3Code installation exists at $CANONICAL_LOCAL_APPIMAGE" >&2
  echo "This legacy build-and-install workflow is disabled because it would replace the shared Caelestia launcher." >&2
  echo "Build and deploy from /home/alex/Workspace/Projects/Apps/better-t3code instead." >&2
  exit 78
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$ROOT/apps/desktop/release"
INSTALLER="$ROOT/scripts/install-t3code-local-linux.sh"
PROFILE=""
INSTALL_DEPS=true

usage() {
  cat <<'EOF'
Usage:
  bash scripts/build-and-install-t3code-local-linux.sh [--profile isolated|shared-system] [--no-install-deps]

Builds the current checkout in a temporary directory, verifies required feature
markers, records build provenance, and atomically updates only the user-local
T3 Code installation.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      if [[ $# -lt 2 ]]; then
        echo "error: --profile requires isolated or shared-system" >&2
        exit 2
      fi
      PROFILE="$2"
      shift 2
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

if [[ -n "$PROFILE" && "$PROFILE" != "isolated" && "$PROFILE" != "shared-system" ]]; then
  echo "error: invalid profile '$PROFILE'; expected isolated or shared-system" >&2
  exit 2
fi
if [[ "$(uname -s)" != Linux ]]; then
  echo "error: Linux AppImage builds are only supported on Linux" >&2
  exit 1
fi
if [[ ! -f "$ROOT/package.json" || ! -x "$INSTALLER" ]]; then
  echo "error: incomplete repository checkout at $ROOT" >&2
  exit 1
fi

cd "$ROOT"
if $INSTALL_DEPS && [[ ! -d "$ROOT/node_modules" ]]; then
  echo "==> bun install --frozen-lockfile"
  bun install --frozen-lockfile
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
}
trap cleanup EXIT

echo "==> building Linux AppImage in $BUILD_OUT"
T3CODE_DESKTOP_OUTPUT_DIR="$BUILD_OUT" bun run dist:desktop:linux

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
  "Hyperagent (MCP Proxy)"
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

installer_args=()
if [[ -n "$PROFILE" ]]; then
  installer_args+=(--profile "$PROFILE")
fi
bash "$INSTALLER" "${installer_args[@]}" "$PERSISTED_APPIMAGE"

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
INSTALLED_APPIMAGE="$DATA_HOME/t3code-local/T3CodeLocal.AppImage"
INSTALLED_SHA256="$(sha256sum "$INSTALLED_APPIMAGE" | awk '{print $1}')"
if [[ "$INSTALLED_SHA256" != "$ARTIFACT_SHA256" ]]; then
  echo "error: installed AppImage checksum does not match the built artifact" >&2
  exit 1
fi
echo "==> local installation verified: $INSTALLED_APPIMAGE"
