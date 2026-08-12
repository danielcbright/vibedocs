#!/usr/bin/env bash
#
# Install VibeDocs as a macOS LaunchAgent that starts at login.
#
# Which folders get indexed is a question, not an assumption: this script asks,
# because the right answer is personal. A home directory typically holds
# ~/Library (thousands of directories of application state) and often
# employer-synced folders, and neither belongs in a documentation browser.
#
# Selected folders are symlinked into a roots directory and VIBEDOCS_ROOT points
# at that. Discovery follows symlinks, so each one appears as a project, and
# changing the selection later is adding or removing a link — no reindexing, no
# config migration.
#
# Interactive:
#   ./scripts/install-macos.sh
#
# Non-interactive (an agent installing on someone's behalf):
#   ./scripts/install-macos.sh --folders Development,Operations,Documents --yes
#
# Options:
#   --folders a,b,c   Folder names under $HOME (or absolute paths) to index.
#   --root <dir>      Where to keep the symlink roots. Default ~/.vibedocs/roots
#   --port <n>        Port to serve on. Default 8080.
#   --runs            Enable the Agent Runs viewer and mint an ingest token.
#   --yes             Do not prompt; requires --folders.
#   --uninstall       Unload and remove the LaunchAgent. Leaves your data alone.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.vibedocs.server"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
VIBEDOCS_HOME="$HOME/.vibedocs"
ROOTS_DIR="$VIBEDOCS_HOME/roots"
PORT=8080
FOLDERS=""
ASSUME_YES=0
ENABLE_RUNS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --folders)   FOLDERS="${2:-}"; shift 2 ;;
    --root)      ROOTS_DIR="${2:-}"; shift 2 ;;
    --port)      PORT="${2:-}"; shift 2 ;;
    --runs)      ENABLE_RUNS=1; shift ;;
    --yes|-y)    ASSUME_YES=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help)   sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ "${UNINSTALL:-0}" = "1" ]; then
  if [ -f "$PLIST" ]; then
    launchctl unload -w "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed $PLIST. Your documents and run data were not touched."
  else
    echo "Not installed — nothing to remove."
  fi
  exit 0
fi

# ── Which folders? ───────────────────────────────────────────────────────────

if [ -z "$FOLDERS" ]; then
  if [ "$ASSUME_YES" = "1" ]; then
    echo "--yes requires --folders." >&2
    exit 2
  fi

  echo "VibeDocs indexes the folders you choose. Nothing else is scanned."
  echo
  echo "Folders in $HOME that contain markdown:"
  echo

  candidates=()
  i=0
  while IFS= read -r dir; do
    name="$(basename "$dir")"
    case "$name" in
      Library|Applications|Movies|Music|Pictures|.*) continue ;;
    esac
    count=$(find "$dir" -maxdepth 4 -name '*.md' \
      -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | wc -l | tr -d ' ')
    [ "$count" -eq 0 ] && continue
    i=$((i + 1))
    candidates+=("$name")
    noun="markdown files"; [ "$count" -eq 1 ] && noun="markdown file"
    printf "  %2d) %-34s %s %s\n" "$i" "$name" "$count" "$noun"
  done < <(find "$HOME" -maxdepth 1 -type d ! -path "$HOME" | sort)

  if [ ${#candidates[@]} -eq 0 ]; then
    echo "  (none found)"
    echo
    echo "Pass folders explicitly: --folders path/one,path/two"
    exit 1
  fi

  echo
  echo "Enter numbers to index, separated by spaces (or 'all'):"
  read -r -p "> " picks

  selected=()
  if [ "$picks" = "all" ]; then
    selected=("${candidates[@]}")
  else
    for n in $picks; do
      idx=$((n - 1))
      [ "$idx" -ge 0 ] && [ "$idx" -lt ${#candidates[@]} ] && selected+=("${candidates[$idx]}")
    done
  fi
  # `set -u` makes an unset array expansion fatal, and an empty selection is a
  # normal outcome (someone typing nothing to back out), not an error.
  if [ ${#selected[@]} -eq 0 ]; then
    echo
    echo "Nothing selected — no changes made."
    exit 0
  fi
  FOLDERS="$(IFS=,; echo "${selected[*]}")"
fi

if [ -z "$FOLDERS" ]; then
  echo "No folders selected — nothing to do." >&2
  exit 1
fi

# ── Link the selection ───────────────────────────────────────────────────────

mkdir -p "$ROOTS_DIR"
# Clear only symlinks, so a stray real directory is never deleted by this script.
find "$ROOTS_DIR" -maxdepth 1 -type l -delete 2>/dev/null || true

echo
echo "Indexing:"
IFS=',' read -ra parts <<< "$FOLDERS"
for raw in "${parts[@]}"; do
  folder="$(echo "$raw" | sed 's/^ *//; s/ *$//')"
  [ -z "$folder" ] && continue
  case "$folder" in
    /*) target="$folder" ;;
     *) target="$HOME/$folder" ;;
  esac
  if [ ! -d "$target" ]; then
    echo "  ! $folder — not a directory, skipped"
    continue
  fi
  # Symlink names become project names, and a slash would not survive.
  link="$ROOTS_DIR/$(basename "$target" | tr '/' '-')"
  ln -sfn "$target" "$link"
  echo "  ✓ $target"
done

# ── Agent Runs ───────────────────────────────────────────────────────────────

RUNS_ENV=""
if [ "$ENABLE_RUNS" = "1" ]; then
  TOKEN_FILE="$VIBEDOCS_HOME/runs-token"
  if [ ! -f "$TOKEN_FILE" ]; then
    mkdir -p "$VIBEDOCS_HOME"
    openssl rand -hex 16 > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
  fi
  RUNS_TOKEN="$(cat "$TOKEN_FILE")"
  RUNS_ENV="
    <key>VIBEDOCS_RUNS_ENABLED</key><string>true</string>
    <key>VIBEDOCS_RUNS_TOKEN</key><string>${RUNS_TOKEN}</string>"
fi

# ── LaunchAgent ──────────────────────────────────────────────────────────────

mkdir -p "$HOME/Library/LaunchAgents" "$VIBEDOCS_HOME"
[ -f "$PLIST" ] && launchctl unload -w "$PLIST" 2>/dev/null || true

NODE_BIN="$(command -v node)"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${REPO_DIR}/dist-cli/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>${REPO_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>VIBEDOCS_ROOT</key><string>${ROOTS_DIR}</string>
    <key>VIBEDOCS_PORT</key><string>${PORT}</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>${RUNS_ENV}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${VIBEDOCS_HOME}/vibedocs.log</string>
  <key>StandardErrorPath</key><string>${VIBEDOCS_HOME}/vibedocs.error.log</string>
</dict>
</plist>
PLIST_EOF

echo
echo "Building…"
( cd "$REPO_DIR" && npm run build:cli >/dev/null && npm run build >/dev/null )

launchctl load -w "$PLIST"

echo
echo "VibeDocs is running at http://localhost:${PORT}"
echo "  roots:  $ROOTS_DIR"
echo "  logs:   $VIBEDOCS_HOME/vibedocs.log"
if [ "$ENABLE_RUNS" = "1" ]; then
  echo "  runs:   enabled — ingest token in $VIBEDOCS_HOME/runs-token"
fi
echo
echo "Stop it with:   ./scripts/install-macos.sh --uninstall"
echo "Change folders: re-run this script, or add/remove links in $ROOTS_DIR"
