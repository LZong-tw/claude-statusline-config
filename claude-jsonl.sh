#!/bin/bash
# Shared helper: find current project's session JSONL(s) from ccstatusline stdin
# Usage: source claude-jsonl.sh
# Outputs: $JSONL (main session file), $JSONL_ALL (space-separated list including subagents)

set -o pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"

_stdin=$(cat)
_cwd=$(printf '%s\n' "$_stdin" | jq -r '.workspace.current_dir // ""' 2>/dev/null)
# Normalize Windows backslashes so the same logic works under Git Bash / MSYS.
# Gate on Windows-shaped paths (drive letter or UNC) so a legitimate Linux
# filename containing a literal backslash isn't silently corrupted.
case "$_cwd" in [A-Za-z]:*) _cwd=${_cwd//\\//} ;; esac

JSONL=""
JSONL_ALL=""

_project_dir_for() {
  local dir="$1"
  local prev=""
  local slug
  local candidate

  # Slug `:` as well as `/` so Windows drive paths (C:/foo) match Claude Code's
  # project dir naming convention (C--foo). The prev-guard stops the loop on
  # paths whose parent strip is idempotent (e.g. "C:" on Windows).
  while [ -n "$dir" ] && [ "$dir" != "$prev" ] && [ "$dir" != "/" ]; do
    slug=$(printf '%s' "$dir" | sed 's|[/:]|-|g')
    candidate="$HOME/.claude/projects/$slug"
    if [ -d "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    prev="$dir"
    dir=${dir%/*}
  done

  return 1
}

# mtime-sort find matches without BSD xargs `-r` and without losing NUL framing.
# - `find -print -quit` is a cheap non-empty probe that exits on first match.
# - Only when there's at least one match do we run the full `find -print0 |
#   xargs -0 ls -t` pipeline, which keeps NUL framing intact end-to-end.
# Capturing find output to a shell variable would strip NULs (command
# substitution) and re-splitting on newlines would be unsafe for filenames
# containing literal `\n`.
_jsonl_mtime_sorted() {
  [ -n "$(find "$@" -print -quit 2>/dev/null)" ] || return 0
  find "$@" -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null
}

if [ -n "$_cwd" ]; then
  _dir=$(_project_dir_for "$_cwd")
  if [ -d "$_dir" ]; then
    JSONL=$(_jsonl_mtime_sorted "$_dir" -maxdepth 1 -name "*.jsonl" | head -1)
  fi
fi

# Fallback: most recently modified across all projects
if [ -z "$JSONL" ]; then
  JSONL=$(_jsonl_mtime_sorted "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -not -path "*/subagents/*" | head -1)
fi

if [ -z "$JSONL" ]; then return 0 2>/dev/null || exit 0; fi

# Build JSONL_ALL: main session + its subagents
JSONL_ALL="$JSONL"
_session_dir="${JSONL%.jsonl}"
if [ -d "$_session_dir/subagents" ]; then
  _subs=$(_jsonl_mtime_sorted "$_session_dir/subagents" -name "*.jsonl")
  if [ -n "$_subs" ]; then
    JSONL_ALL="$JSONL"$'\n'"$_subs"
  fi
fi
