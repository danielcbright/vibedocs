#!/usr/bin/env bash
#
# Install VibeDocs as a macOS LaunchAgent that starts at login.
#
# Which folders get indexed is a question, not an assumption: this script asks,
# because the right answer is personal. A home directory typically holds
# ~/Library (thousands of directories of application state) and often
# employer-synced folders, and neither belongs in a documentation browser.
#
# Selected folders are named directly in VIBEDOCS_ROOTS, so the watcher sees real
# paths. Changing the selection is re-running this script.
#
# This used to stage symlinks under ~/.vibedocs/roots instead, and claim you could
# change the selection by adding or removing a link. That only half worked — a link
# added while the service ran was listed and indexed once and then silently stopped
# receiving file events, so a restart was already required and you simply were not
# told. The farm was also why the watcher had to reason about symlink-resolved
# paths, which grew it to 866,194 entries once.
#
# Interactive:
#   ./scripts/install-macos.sh
#
# Non-interactive (an agent installing on someone's behalf):
#   ./scripts/install-macos.sh --folders Development,Operations,Documents --yes
#
# Options:
#   --folders a,b,c   Folder names under $HOME (or absolute paths) to index.
#   --port <n>        Port to serve on. Default 8080.
#   --runs            Enable the Agent Runs viewer and mint an ingest token.
#   --yes             Do not prompt; requires --folders.
#   --uninstall       Unload and remove the LaunchAgent. Leaves your data alone.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.vibedocs.server"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
VIBEDOCS_HOME="$HOME/.vibedocs"
# Only referenced to clean up after a previous install that staged symlinks here.
LEGACY_ROOTS_DIR="$VIBEDOCS_HOME/roots"
PORT=8080
FOLDERS=""
ASSUME_YES=0
ENABLE_RUNS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --folders)   FOLDERS="${2:-}"; shift 2 ;;
    # Retired with the symlink farm. Named explicitly rather than left to the
    # catch-all, because "unknown option" would read as a typo to anyone with the
    # old invocation in their shell history.
    --root)      echo "--root is gone: folders are now named directly, with no staging directory. Use --folders." >&2; exit 2 ;;
    --port)      PORT="${2:-}"; shift 2 ;;
    --runs)      ENABLE_RUNS=1; shift ;;
    --yes|-y)    ASSUME_YES=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    # Print the header comment, however long it happens to be. A hard-coded line
    # range silently truncated this the first time the header grew — the options
    # list vanished while --help still exited 0.
    -h|--help)   awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
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
  tcc_seen=0
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
    # Documents / Desktop / Downloads are TCC-protected on macOS. A LaunchAgent
    # without Full Disk Access blocks on them at startup and never binds its
    # port, with an empty log — so warn rather than let someone pick a silent hang.
    tcc=""
    case "$name" in
      Documents|Desktop|Downloads) tcc="  ← needs Full Disk Access"; tcc_seen=1 ;;
    esac
    printf "  %2d) %-34s %s %s%s\n" "$i" "$name" "$count" "$noun" "$tcc"
  done < <(find "$HOME" -maxdepth 1 -type d ! -path "$HOME" | sort)

  if [ ${#candidates[@]} -eq 0 ]; then
    echo "  (none found)"
    echo
    echo "Pass folders explicitly: --folders path/one,path/two"
    exit 1
  fi

  if [ "$tcc_seen" = "1" ]; then
    echo
    echo "  Note: folders marked above are protected by macOS privacy controls."
    echo "  A background service cannot read them until you grant Full Disk Access"
    echo "  to node (System Settings > Privacy & Security > Full Disk Access)."
    echo "  Without it the service starts but never answers, and logs nothing."
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

# ── Resolve the selection ────────────────────────────────────────────────────

echo
echo "Indexing:"
ROOTS=()
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
  # VIBEDOCS_ROOTS is colon-separated, POSIX-style, exactly like PATH — so a path
  # containing a colon cannot be expressed, and APFS does allow one. Joining it
  # anyway yields two roots that are each half a path, and the server then reports
  # directories the operator never named. Refuse instead of splitting it silently.
  case "$target" in
    *:*)
      echo "  ! $folder — contains a colon, which separates roots. Rename the folder." >&2
      exit 2
      ;;
  esac
  ROOTS+=("$target")
  echo "  ✓ $target"
done

if [ ${#ROOTS[@]} -eq 0 ]; then
  echo
  echo "None of those folders exist — nothing to install." >&2
  exit 1
fi

# Colon-separated, which is what VIBEDOCS_ROOTS takes. The server rejects two
# roots sharing a basename, or one nested inside another, and says which — those
# rules are NOT restated here, or they would drift from the ones in the code. The
# health check below reprints whatever the server refuses on.
ROOTS_JOINED="$(IFS=:; echo "${ROOTS[*]}")"

# A folder name containing &, < or > would otherwise produce a plist that is not
# valid XML, and launchd's complaint about that names neither the file nor the
# character.
ROOTS_XML="$(printf '%s' "$ROOTS_JOINED" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')"

# Tidy up after an install that staged symlinks here. Only links, and only if the
# directory is then empty, so anything an operator put there by hand survives.
if [ -d "$LEGACY_ROOTS_DIR" ]; then
  find "$LEGACY_ROOTS_DIR" -maxdepth 1 -type l -delete 2>/dev/null || true
  if rmdir "$LEGACY_ROOTS_DIR" 2>/dev/null; then
    echo
    echo "Removed $LEGACY_ROOTS_DIR (a previous install staged symlinks there; roots are named directly now)."
  fi
fi

# ── Agent Runs ───────────────────────────────────────────────────────────────

RUNS_ENV=""
if [ "$ENABLE_RUNS" = "1" ]; then
  TOKEN_FILE="$VIBEDOCS_HOME/runs-token"
  if [ ! -f "$TOKEN_FILE" ]; then
    mkdir -p "$VIBEDOCS_HOME"
    openssl rand -hex 16 > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
  fi
  # Point at the token file rather than embedding the token. A LaunchAgent
  # plist is world-readable (0644 under the default umask), so a secret pasted
  # into one is readable by every local user; the file it names is 0600.
  RUNS_ENV="
    <key>VIBEDOCS_RUNS_ENABLED</key><string>true</string>
    <key>VIBEDOCS_RUNS_TOKEN_FILE</key><string>${TOKEN_FILE}</string>"
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
    <key>VIBEDOCS_ROOTS</key><string>${ROOTS_XML}</string>
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

# Defense in depth: the plist names no secret, but it does describe how this
# service is wired, and there is no reason for it to be world-readable.
chmod 600 "$PLIST"

echo
echo "Building…"
( cd "$REPO_DIR" && npm run build:cli >/dev/null && npm run build >/dev/null )

# Do not report success without checking. Two failures hide here, and they need
# different messages: a root configuration the server refuses outright, and a
# TCC-protected folder, where the process starts, blocks before binding, and writes
# nothing at all.
#
# The refusal goes to stderr, which the plist routes to the error log — a different
# file from its normal output. Reading only one of them is how a specific,
# actionable message gets replaced by a guess about Full Disk Access.
LOG_OUT="$VIBEDOCS_HOME/vibedocs.log"
LOG_ERR="$VIBEDOCS_HOME/vibedocs.error.log"

# Snapshot the log sizes BEFORE loading, so only bytes this install produced are
# read. Both halves of that are load-bearing:
#
# - Taken *after* `launchctl load`, the refusal can be written in the gap and land
#   below the offset, and would then be invisible. It only appeared to work because
#   KeepAlive restarts the server and appends the message again — i.e. the feature
#   depended on launchd's retry cadence rather than on anything here.
# - Comparing the last refusal LINE instead of a byte offset does not work either:
#   re-running with the same bad selection appends an identical message, which then
#   looks unchanged and gets skipped.
log_size() {
  if [ -f "$1" ]; then wc -c < "$1" | tr -d ' '; else echo 0; fi
}
ERR_OFFSET="$(log_size "$LOG_ERR")"
OUT_OFFSET="$(log_size "$LOG_OUT")"

refusal_line() {
  {
    tail -c "+$((ERR_OFFSET + 1))" "$LOG_ERR" 2>/dev/null || true
    tail -c "+$((OUT_OFFSET + 1))" "$LOG_OUT" 2>/dev/null || true
  } | grep '✖ VibeDocs cannot start' | tail -1 || true
}

launchctl load -w "$PLIST"

printf "\nStarting"
up=""
refusal=""
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://localhost:${PORT}/api/projects" 2>/dev/null; then up="yes"; break; fi
  # Stop waiting the moment the server says why it will not start. KeepAlive
  # restarts it on a loop, so without this the operator watches 30 dots for a
  # verdict that was available after one.
  refusal="$(refusal_line)"
  [ -n "$refusal" ] && break
  printf "."
  sleep 1
done
echo

if [ -z "$up" ]; then
  echo "The service was installed but is not answering on port ${PORT}." >&2
  echo >&2

  # The server refuses to start on a root configuration that cannot work — two
  # roots sharing a basename, or one nested inside another — and prints why. If it
  # did, that is the answer, and it is more specific than anything this script
  # could guess. Checked first for exactly that reason.
  if [ -n "$refusal" ]; then
    echo "The server refused to start:" >&2
    echo >&2
    echo "  ${refusal}" >&2
    echo >&2
    echo "Re-run with a folder selection that avoids it." >&2
  else
    # Nothing in the log at all is itself the signal: a TCC-protected folder makes
    # the process block before it binds, writing neither output nor an error.
    echo "The usual cause is a folder protected by macOS privacy controls" >&2
    echo "(Documents, Desktop, Downloads). A background service blocks on those" >&2
    echo "at startup and logs nothing. Either:" >&2
    echo "  - grant Full Disk Access to $(command -v node)" >&2
    echo "    (System Settings > Privacy & Security > Full Disk Access), or" >&2
    echo "  - re-run without those folders." >&2
  fi

  echo >&2
  echo "Roots it was given: ${ROOTS_JOINED}" >&2
  echo "Logs:               $LOG_OUT" >&2
  echo "                    $LOG_ERR" >&2
  exit 1
fi

echo "VibeDocs is running at http://localhost:${PORT}"
for root in "${ROOTS[@]}"; do
  echo "  root:   $root"
done
echo "  logs:   $VIBEDOCS_HOME/vibedocs.log"
if [ "$ENABLE_RUNS" = "1" ]; then
  echo "  runs:   enabled — ingest token in $VIBEDOCS_HOME/runs-token"
fi
echo
echo "Stop it with:   ./scripts/install-macos.sh --uninstall"
echo "Change folders: re-run this script. The roots are in the plist, so a change"
echo "                needs the service restarted — which re-running does for you."
