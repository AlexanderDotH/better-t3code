#!/usr/bin/env bash
# Install a Linux AppImage after an explicit, separate user confirmation.
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "error: run as a normal user; this installer only writes user-local files" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ICON_PNG="$ROOT/apps/desktop/resources/icon.png"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/install-t3code-local-linux.sh --confirm-install [--profile isolated|shared-system] /path/to/T3-Code-x86_64.AppImage

Profiles:
  isolated       Use ~/.t3-local and ~/.config/t3code-local.
  shared-system  Use ~/.t3 and ~/.config/t3code after taking a one-time backup.

If --profile is omitted, the previously installed profile is retained. New
installations default to isolated.

Installs:
  ~/.local/share/t3code-local/T3CodeLocal.AppImage
  ~/.local/bin/t3code-local
  ~/.local/share/applications/t3code-local.desktop

This script never starts, stops, or restarts T3 Code. The confirmation flag
keeps installation separate from automated build and agent workflows.
EOF
}

PROFILE=""
INPUT_APPIMAGE=""
CONFIRM_INSTALL=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm-install)
      CONFIRM_INSTALL=true
      shift
      ;;
    --profile)
      if [[ $# -lt 2 ]]; then
        echo "error: --profile requires isolated or shared-system" >&2
        exit 2
      fi
      PROFILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$INPUT_APPIMAGE" ]]; then
        echo "error: only one AppImage may be installed" >&2
        usage >&2
        exit 2
      fi
      INPUT_APPIMAGE="$1"
      shift
      ;;
  esac
done

APPIMAGE="$INPUT_APPIMAGE"
if [[ -z "$APPIMAGE" ]]; then
  usage >&2
  exit 2
fi

if [[ "$CONFIRM_INSTALL" != true ]]; then
  echo "error: installation requires a separate, explicit later user action" >&2
  echo "Run this installer again with --confirm-install when all active T3 Code work is finished." >&2
  exit 78
fi

CANONICAL_CHECKOUT="${T3CODE_CANONICAL_CHECKOUT:-/home/alex/Workspace/Projects/Apps/better-t3code}"
if [[ -d "$CANONICAL_CHECKOUT" ]]; then
  CANONICAL_ROOT="$(cd "$CANONICAL_CHECKOUT" && pwd -P)"
  if [[ "$ROOT" != "$CANONICAL_ROOT" ]]; then
    echo "error: $ROOT is not the canonical T3 Code checkout" >&2
    echo "Install only from $CANONICAL_ROOT; carry source changes there first." >&2
    exit 78
  fi
fi

if [[ "$(uname -s)" != Linux ]]; then
  echo "error: Linux user-local install is only supported on Linux" >&2
  exit 1
fi

if [[ ! -f "$APPIMAGE" ]]; then
  echo "error: AppImage not found: $APPIMAGE" >&2
  exit 1
fi

if [[ ! -f "$ICON_PNG" ]]; then
  echo "error: missing icon: $ICON_PNG" >&2
  exit 1
fi

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APP_DIR="$DATA_HOME/t3code-local"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/512x512/apps"

APPIMAGE_TARGET="$APP_DIR/T3CodeLocal.AppImage"
PREVIOUS_APPIMAGE="$APP_DIR/T3CodeLocal.previous.AppImage"
PROFILE_PATH="$APP_DIR/install-profile"
WRAPPER_PATH="$BIN_DIR/t3code-local"
DESKTOP_PATH="$DESKTOP_DIR/t3code-local.desktop"
ICON_PATH="$ICON_DIR/t3code-local.png"
SHARED_BACKUP_REQUIRED="$APP_DIR/shared-profile-backup-required"

mkdir -p "$APP_DIR" "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"

PREVIOUS_PROFILE=""
if [[ -f "$PROFILE_PATH" ]]; then
  PREVIOUS_PROFILE="$(<"$PROFILE_PATH")"
fi
if [[ -z "$PROFILE" ]]; then
  PROFILE="${PREVIOUS_PROFILE:-isolated}"
fi
if [[ "$PROFILE" != "isolated" && "$PROFILE" != "shared-system" ]]; then
  echo "error: invalid profile '$PROFILE'; expected isolated or shared-system" >&2
  exit 2
fi

APPIMAGE_TEMP="$APP_DIR/.T3CodeLocal.AppImage.new.$$"
PROFILE_TEMP="$APP_DIR/.install-profile.new.$$"
WRAPPER_TEMP="$BIN_DIR/.t3code-local.new.$$"
DESKTOP_TEMP="$DESKTOP_DIR/.t3code-local.desktop.new.$$"
ICON_TEMP="$ICON_DIR/.t3code-local.png.new.$$"
MUTATION_STARTED=false
INSTALL_COMMITTED=false

declare -a INSTALL_TARGETS=(
  "$APPIMAGE_TARGET"
  "$PREVIOUS_APPIMAGE"
  "$PROFILE_PATH"
  "$WRAPPER_PATH"
  "$DESKTOP_PATH"
  "$ICON_PATH"
  "$SHARED_BACKUP_REQUIRED"
)

for target in "${INSTALL_TARGETS[@]}"; do
  if [[ -e "$target" && ! -f "$target" ]]; then
    echo "error: local install target is not a regular file: $target" >&2
    exit 1
  fi
done

ROLLBACK_DIR="$(mktemp -d "$APP_DIR/.install-rollback.XXXXXX")"

backup_target() {
  local target="$1"
  local backup_name="$2"
  if [[ -e "$target" ]]; then
    cp -a -- "$target" "$ROLLBACK_DIR/$backup_name"
  fi
}

restore_target() {
  local target="$1"
  local backup_name="$2"
  if ! rm -f -- "$target"; then
    echo "warning: failed to remove partial install target during rollback: $target" >&2
    return
  fi
  if [[ -e "$ROLLBACK_DIR/$backup_name" ]] &&
    ! cp -a -- "$ROLLBACK_DIR/$backup_name" "$target"; then
    echo "warning: failed to restore install target during rollback: $target" >&2
  fi
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$MUTATION_STARTED" == true && "$INSTALL_COMMITTED" != true ]]; then
    echo "warning: local installation failed; restoring the previous installation" >&2
    restore_target "$APPIMAGE_TARGET" appimage
    restore_target "$PREVIOUS_APPIMAGE" previous-appimage
    restore_target "$PROFILE_PATH" profile
    restore_target "$WRAPPER_PATH" wrapper
    restore_target "$DESKTOP_PATH" desktop-entry
    restore_target "$ICON_PATH" icon
    restore_target "$SHARED_BACKUP_REQUIRED" shared-backup-required
  fi
  rm -f "$APPIMAGE_TEMP" "$PROFILE_TEMP" "$WRAPPER_TEMP" "$DESKTOP_TEMP" "$ICON_TEMP"
  rm -rf "$ROLLBACK_DIR"
  exit "$status"
}
trap cleanup EXIT

backup_target "$APPIMAGE_TARGET" appimage
backup_target "$PREVIOUS_APPIMAGE" previous-appimage
backup_target "$PROFILE_PATH" profile
backup_target "$WRAPPER_PATH" wrapper
backup_target "$DESKTOP_PATH" desktop-entry
backup_target "$ICON_PATH" icon
backup_target "$SHARED_BACKUP_REQUIRED" shared-backup-required

install -m 0755 "$APPIMAGE" "$APPIMAGE_TEMP"
SOURCE_SHA256="$(sha256sum "$APPIMAGE" | awk '{print $1}')"
TEMP_SHA256="$(sha256sum "$APPIMAGE_TEMP" | awk '{print $1}')"
if [[ "$SOURCE_SHA256" != "$TEMP_SHA256" ]]; then
  echo "error: copied AppImage checksum does not match source" >&2
  exit 1
fi

MUTATION_STARTED=true
if [[ -f "$APPIMAGE_TARGET" ]]; then
  rm -f "$PREVIOUS_APPIMAGE"
  mv "$APPIMAGE_TARGET" "$PREVIOUS_APPIMAGE"
fi
mv -fT "$APPIMAGE_TEMP" "$APPIMAGE_TARGET"

printf '%s\n' "$PROFILE" >"$PROFILE_TEMP"
mv -fT "$PROFILE_TEMP" "$PROFILE_PATH"

if [[ "$PROFILE" == "shared-system" ]]; then
  if [[ ! -f "$APP_DIR/shared-profile-backup-complete" ]]; then
    : >"$SHARED_BACKUP_REQUIRED"
  fi
else
  rm -f "$SHARED_BACKUP_REQUIRED"
fi

install -m 0644 "$ICON_PNG" "$ICON_TEMP"
mv -fT "$ICON_TEMP" "$ICON_PATH"

cat >"$WRAPPER_TEMP" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
state_home="${XDG_STATE_HOME:-$HOME/.local/state}"
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
appdir="$data_home/t3code-local"
appimage="$appdir/T3CodeLocal.AppImage"
profile_path="$appdir/install-profile"
profile="isolated"
if [[ -f "$profile_path" ]]; then
  profile="$(<"$profile_path")"
fi

notify() {
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "T3 Code Local" "$1" >/dev/null 2>&1 || true
  fi
}

backup_shared_profile() {
  local required_marker="$appdir/shared-profile-backup-required"
  local completed_marker="$appdir/shared-profile-backup-complete"
  if [[ ! -f "$required_marker" || -f "$completed_marker" ]]; then
    return
  fi

  local lock_file="$appdir/shared-profile-backup.lock"
  exec 9>"$lock_file"
  if command -v flock >/dev/null 2>&1; then
    flock 9
  fi
  if [[ ! -f "$required_marker" || -f "$completed_marker" ]]; then
    return
  fi

  local timestamp backup_root backup_dir backend_source electron_source
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_root="$state_home/t3code-local/backups"
  backup_dir="$backup_root/shared-system-$timestamp"
  backend_source="$HOME/.t3/userdata"
  electron_source="$config_home/t3code"
  mkdir -p "$backup_dir/backend" "$backup_dir/electron"

  echo "Creating one-time shared-profile backup at $backup_dir" >&2
  if [[ -f "$backend_source/state.sqlite" ]]; then
    if ! command -v sqlite3 >/dev/null 2>&1; then
      echo "error: sqlite3 is required to back up the shared T3 Code state" >&2
      notify "Shared-profile backup failed because sqlite3 is unavailable."
      return 1
    fi
    local sqlite_target sqlite_target_escaped
    sqlite_target="$backup_dir/backend/state.sqlite"
    sqlite_target_escaped="${sqlite_target//\'/\'\'}"
    sqlite3 "$backend_source/state.sqlite" ".backup '$sqlite_target_escaped'"
  fi

  local item
  for item in \
    anonymous-id \
    attachments \
    client-settings.json \
    desktop-settings.json \
    environment-id \
    keybindings.json \
    secrets \
    server-runtime.json \
    settings.json \
    skills; do
    if [[ -e "$backend_source/$item" ]]; then
      cp -a "$backend_source/$item" "$backup_dir/backend/"
    fi
  done

  if [[ -d "$electron_source" ]]; then
    tar -C "$electron_source" \
      --exclude='./Cache' \
      --exclude='./Code Cache' \
      --exclude='./Crashpad' \
      --exclude='./DawnGraphiteCache' \
      --exclude='./DawnWebGPUCache' \
      --exclude='./GPUCache' \
      --exclude='./ShaderCache' \
      --exclude='./SingletonCookie' \
      --exclude='./SingletonLock' \
      --exclude='./SingletonSocket' \
      -cf - . | tar -C "$backup_dir/electron" -xf -
  fi

  printf '%s\n' "$backup_dir" >"$completed_marker.new"
  mv "$completed_marker.new" "$completed_marker"
  rm -f "$required_marker"
  notify "Shared profile backed up. Starting the local build."
}

case "$profile" in
  isolated)
    export T3CODE_HOME="${T3CODE_HOME:-$HOME/.t3-local}"
    user_data_dir="$config_home/t3code-local"
    ;;
  shared-system)
    system_pattern="${T3CODE_LOCAL_SYSTEM_PROCESS_PATTERN:-^/opt/t3code-bin/t3code([[:space:]]|$)}"
    if pgrep -f -- "$system_pattern" >/dev/null 2>&1; then
      message="Close the paru-installed T3 Code before starting T3 Code Local."
      echo "$message" >&2
      notify "$message"
      exit 75
    fi
    export T3CODE_HOME="${T3CODE_HOME:-$HOME/.t3}"
    user_data_dir="$config_home/t3code"
    backup_shared_profile
    ;;
  *)
    echo "error: invalid installed T3 Code Local profile '$profile'" >&2
    exit 2
    ;;
esac

export APPDIR="$appdir"
export T3CODE_DISABLE_AUTO_UPDATE="${T3CODE_DISABLE_AUTO_UPDATE:-1}"
export T3CODE_DESKTOP_DISPLAY_NAME="${T3CODE_DESKTOP_DISPLAY_NAME:-T3 Code Local}"
export T3CODE_DESKTOP_APP_USER_MODEL_ID="${T3CODE_DESKTOP_APP_USER_MODEL_ID:-com.t3tools.t3code.local}"
export T3CODE_DESKTOP_USER_DATA_DIR_NAME="${T3CODE_DESKTOP_USER_DATA_DIR_NAME:-t3code-local}"
export T3CODE_DESKTOP_LEGACY_USER_DATA_DIR_NAME="${T3CODE_DESKTOP_LEGACY_USER_DATA_DIR_NAME:-T3 Code Local}"
export T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME="${T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME:-t3code-local.desktop}"
export T3CODE_DESKTOP_LINUX_WM_CLASS="${T3CODE_DESKTOP_LINUX_WM_CLASS:-t3code-local}"
export CHROME_DESKTOP="t3code-local.desktop"
unset ELECTRON_RUN_AS_NODE

if [[ -z "${CODEX_CLI_PATH-}" ]] && command -v codex >/dev/null 2>&1; then
  export CODEX_CLI_PATH="$(command -v codex)"
fi

export PATH="$appdir:$PATH"
mkdir -p "$user_data_dir"
app_args=("--user-data-dir=$user_data_dir")

if [[ ! -e /dev/fuse ]]; then
  export APPIMAGE_EXTRACT_AND_RUN=1
fi

if [[ "${T3CODE_LOCAL_FOREGROUND:-0}" == "1" ]]; then
  exec "$appimage" "${app_args[@]}" "$@"
fi

if command -v setsid >/dev/null 2>&1; then
  setsid -f "$appimage" "${app_args[@]}" "$@" >/dev/null 2>&1
else
  nohup "$appimage" "${app_args[@]}" "$@" >/dev/null 2>&1 &
fi
EOF
chmod 0755 "$WRAPPER_TEMP"
mv -fT "$WRAPPER_TEMP" "$WRAPPER_PATH"

cat >"$DESKTOP_TEMP" <<EOF
[Desktop Entry]
Name=T3 Code Local
Comment=T3 Code local development build
Exec=$WRAPPER_PATH %U
TryExec=$WRAPPER_PATH
Terminal=false
Type=Application
Icon=t3code-local
StartupWMClass=t3code-local
Categories=Development;
MimeType=x-scheme-handler/t3code;
EOF
chmod 0755 "$DESKTOP_TEMP"
mv -fT "$DESKTOP_TEMP" "$DESKTOP_PATH"

update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

INSTALLED_SHA256="$(sha256sum "$APPIMAGE_TARGET" | awk '{print $1}')"
if [[ "$INSTALLED_SHA256" != "$SOURCE_SHA256" ]]; then
  echo "error: installed AppImage checksum does not match source" >&2
  exit 1
fi
INSTALL_COMMITTED=true

echo "Installed T3 Code Local ($PROFILE profile):"
echo "  command: $WRAPPER_PATH"
echo "  desktop entry: $DESKTOP_PATH"
echo "  app: $APPIMAGE_TARGET"
echo "  sha256: $INSTALLED_SHA256"
echo "No T3 Code process was started, stopped, or restarted."
