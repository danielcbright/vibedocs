#!/usr/bin/env bash
#
# Install VibeDocs as a macOS LaunchAgent that starts at login.
#
# Which folders get indexed is a question, not an assumption: this script asks,
# because the right answer is personal. A home directory typically holds
# ~/Library (thousands of directories of application state) and often
# employer-synced folders, and neither belongs in a documentation browser.
#
# Run without --folders, it opens a folder picker in your browser (`vibedocs
# pick-roots`), where any folder can be ticked, not just the top level of your home
# folder: ~/src/work rather than all of ~/src. The choice is written to
# ~/.vibedocs/roots.txt, one path per line, and the LaunchAgent names that file
# (VIBEDOCS_ROOTS_FILE). The Settings page inside VibeDocs edits the same file and
# restarts the service to apply it; re-running this script works too.
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
#   ./scripts/install-macos.sh --folders Development,src/work,/Volumes/Notes --yes
#
# Options:
#   --folders a,b,c   Folders to index: paths under $HOME (nested is fine) or absolute.
#   --port <n>        Port to serve on. Default 8080.
#   --runs            Enable the Agent Runs viewer and mint an ingest token.
#   --yes             Do not prompt; requires --folders.
#   --dry-run         Print the roots and the LaunchAgent plist; change nothing.
#   --uninstall       Unload and remove the LaunchAgent. Leaves your data alone.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.vibedocs.server"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
VIBEDOCS_HOME="$HOME/.vibedocs"
# Not "$VIBEDOCS_HOME/roots": that is the legacy symlink DIRECTORY below, which an
# upgrade may still have, holding whatever an operator put there by hand.
ROOTS_FILE="$VIBEDOCS_HOME/roots.txt"
# Only referenced to clean up after a previous install that staged symlinks here.
LEGACY_ROOTS_DIR="$VIBEDOCS_HOME/roots"
PORT=8080
FOLDERS=""
ASSUME_YES=0
ENABLE_RUNS=0
DRY_RUN=0

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
    --dry-run)   DRY_RUN=1; shift ;;
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

# Both the picker and the service run the compiled CLI and the built frontend.
BUILT=0
build() {
  [ "$BUILT" = "1" ] && return
  echo "Building…"
  ( cd "$REPO_DIR" && npm run build:cli >/dev/null && npm run build >/dev/null )
  BUILT=1
}

# ── Which folders? ───────────────────────────────────────────────────────────

ROOTS=()
if [ -z "$FOLDERS" ]; then
  if [ "$ASSUME_YES" = "1" ]; then
    echo "--yes requires --folders." >&2
    exit 2
  fi

  echo "VibeDocs indexes the folders you choose. Nothing else is scanned."
  echo
  build

  # The picker writes the roots file itself, starting from what it already holds.
  # A dry run hands it a scratch copy instead.
  PICK_FILE="$ROOTS_FILE"
  if [ "$DRY_RUN" = "1" ]; then
    PICK_FILE="$(mktemp -t vibedocs-roots)"
    trap 'rm -f "$PICK_FILE"' EXIT
    [ -f "$ROOTS_FILE" ] && cp "$ROOTS_FILE" "$PICK_FILE"
  fi
  # An install from before the roots file kept its roots in the plist. Start the
  # picker from those rather than from nothing, and take the seed back out if the
  # operator cancels, so a cancelled run really changes nothing.
  SEEDED=0
  if [ ! -s "$PICK_FILE" ] && [ -f "$PLIST" ]; then
    old_roots="$(plutil -extract EnvironmentVariables.VIBEDOCS_ROOTS raw -o - "$PLIST" 2>/dev/null || true)"
    if [ -n "$old_roots" ]; then
      mkdir -p "$(dirname "$PICK_FILE")"
      tr ':' '\n' <<< "$old_roots" > "$PICK_FILE"
      SEEDED=1
    fi
  fi
  # Non-zero is Ctrl-C (or a picker that could not start, which says why itself).
  if ! node "$REPO_DIR/dist-cli/cli/index.js" pick-roots --write "$PICK_FILE"; then
    [ "$SEEDED" = "1" ] && rm -f "$PICK_FILE"
    echo
    echo "Nothing selected — no changes made."
    exit 0
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    ROOTS+=("$line")
  done < "$PICK_FILE"

  echo
  echo "Indexing:"
  for root in "${ROOTS[@]}"; do echo "  ✓ $root"; done
else
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
    ROOTS+=("$target")
    echo "  ✓ $target"
  done

  if [ ${#ROOTS[@]} -eq 0 ]; then
    echo
    echo "None of those folders exist — nothing to install." >&2
    exit 1
  fi
fi

# One path per line, so a folder name containing a colon is fine here — unlike
# VIBEDOCS_ROOTS, which is colon-separated. The server rejects two roots sharing a
# basename, or one nested inside another, and says which — those rules are NOT
# restated here (the picker shows the server's own verdict before saving), or they
# would drift from the ones in the code. The health check below reprints whatever
# the server refuses on.
write_roots_file() {
  mkdir -p "$(dirname "$ROOTS_FILE")"
  {
    echo "# VibeDocs roots, one absolute path per line. Written by the installer and the"
    echo "# Settings page. After editing by hand, restart vibedocs."
    printf '%s\n' "${ROOTS[@]}"
  } > "$ROOTS_FILE.tmp"
  mv "$ROOTS_FILE.tmp" "$ROOTS_FILE"
}

# A path containing &, < or > would otherwise produce a plist that is not valid
# XML, and launchd's complaint about that names neither the file nor the character.
xml_escape() { printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }
ROOTS_FILE_XML="$(xml_escape "$ROOTS_FILE")"

# Tidy up after an install that staged symlinks here. Only links, and only if the
# directory is then empty, so anything an operator put there by hand survives.
if [ "$DRY_RUN" != "1" ] && [ -d "$LEGACY_ROOTS_DIR" ]; then
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
  if [ "$DRY_RUN" != "1" ] && [ ! -f "$TOKEN_FILE" ]; then
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

NODE_BIN="$(command -v node)"

# VIBEDOCS_ROOTS is deliberately absent: it wins over the roots file, which would
# leave the Settings page read-only. VIBEDOCS_SUPERVISED tells the server KeepAlive
# restarts it, so a saved change can exit to apply itself.
PLIST_BODY="$(cat <<PLIST_EOF
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
    <key>VIBEDOCS_ROOTS_FILE</key><string>${ROOTS_FILE_XML}</string>
    <key>VIBEDOCS_SETTINGS_ENABLED</key><string>true</string>
    <key>VIBEDOCS_SUPERVISED</key><string>true</string>
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
)"

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "Dry run — nothing was written. A real run would write:"
  echo
  echo "$ROOTS_FILE:"
  printf '  %s\n' "${ROOTS[@]}"
  echo
  echo "$PLIST:"
  echo "$PLIST_BODY"
  exit 0
fi

# Interactive runs already wrote it through the picker.
[ -z "$FOLDERS" ] || write_roots_file

mkdir -p "$HOME/Library/LaunchAgents" "$VIBEDOCS_HOME"
[ -f "$PLIST" ] && launchctl unload -w "$PLIST" 2>/dev/null || true
printf '%s\n' "$PLIST_BODY" > "$PLIST"

# Defense in depth: the plist names no secret, but it does describe how this
# service is wired, and there is no reason for it to be world-readable.
chmod 600 "$PLIST"

build

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
  echo "Roots file:  $ROOTS_FILE" >&2
  echo "Logs:        $LOG_OUT" >&2
  echo "             $LOG_ERR" >&2
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
echo "Change folders: Settings (the gear in the sidebar), which restarts the service"
echo "                for you, or re-run this script. Both edit $ROOTS_FILE"
