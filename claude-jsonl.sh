#!/bin/bash
# Shared helper: find current project's session JSONL(s) from ccstatusline stdin
# Usage: source claude-jsonl.sh
# Outputs: $JSONL (main session file), $JSONL_ALL (space-separated list including subagents)

set -o pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"

_stdin=$(cat)
_cwd=$(printf '%s\n' "$_stdin" | jq -r '.workspace.current_dir // ""' 2>/dev/null)
# Normalize Windows backslashes so the same logic works under Git Bash / MSYS
_cwd=${_cwd//\\//}

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

# Pick the newest file from a newline-separated list. The explicit empty check
# avoids BSD-xargs-without-`-r` fallthrough where `xargs ls -t` with no input
# runs `ls -t` against cwd. Portable to GNU and all BSD xargs.
# Newline-separated is safe here: session jsonl files are UUID-named.
_newest_from_lines() {
  local found="$1"
  [ -z "$found" ] && return 0
  printf '%s\n' "$found" | tr '\n' '\0' | xargs -0 ls -t 2>/dev/null | head -1
}

if [ -n "$_cwd" ]; then
  _dir=$(_project_dir_for "$_cwd")
  if [ -d "$_dir" ]; then
    _found=$(find "$_dir" -maxdepth 1 -name "*.jsonl" 2>/dev/null)
    JSONL=$(_newest_from_lines "$_found")
  fi
fi

# Fallback: most recently modified across all projects
if [ -z "$JSONL" ]; then
  _found=$(find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -not -path "*/subagents/*" 2>/dev/null)
  JSONL=$(_newest_from_lines "$_found")
fi

if [ -z "$JSONL" ]; then return 0 2>/dev/null || exit 0; fi

# Build JSONL_ALL: main session + its subagents
JSONL_ALL="$JSONL"
_session_dir="${JSONL%.jsonl}"
if [ -d "$_session_dir/subagents" ]; then
  _found=$(find "$_session_dir/subagents" -name "*.jsonl" 2>/dev/null)
  if [ -n "$_found" ]; then
    _subs=$(printf '%s\n' "$_found" | tr '\n' '\0' | xargs -0 ls -t 2>/dev/null)
    if [ -n "$_subs" ]; then
      JSONL_ALL="$JSONL"$'\n'"$_subs"
    fi
  fi
fi
