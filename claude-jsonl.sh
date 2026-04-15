#!/bin/bash
# Shared helper: find current project's session JSONL(s) from ccstatusline stdin
# Usage: source claude-jsonl.sh
# Outputs: $JSONL (main session file), $JSONL_ALL (space-separated list including subagents)

set -o pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"

_stdin=$(cat)
_cwd=$(printf '%s\n' "$_stdin" | jq -r '.workspace.current_dir // ""' 2>/dev/null)

JSONL=""
JSONL_ALL=""

if [ -n "$_cwd" ]; then
  _slug=$(printf '%s' "$_cwd" | sed 's|/|-|g')
  _dir="$HOME/.claude/projects/$_slug"
  if [ -d "$_dir" ]; then
    JSONL=$(find "$_dir" -maxdepth 1 -name "*.jsonl" -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
  fi
fi

# Fallback: most recently modified across all projects
if [ -z "$JSONL" ]; then
  JSONL=$(find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -not -path "*/subagents/*" -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
fi

if [ -z "$JSONL" ]; then return 0 2>/dev/null || exit 0; fi

# Build JSONL_ALL: main session + its subagents
JSONL_ALL="$JSONL"
_session_dir="${JSONL%.jsonl}"
if [ -d "$_session_dir/subagents" ]; then
  _subs=$(find "$_session_dir/subagents" -name "*.jsonl" -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null)
  if [ -n "$_subs" ]; then
    JSONL_ALL="$JSONL"$'\n'"$_subs"
  fi
fi
