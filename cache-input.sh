#!/bin/bash
# Uncached widget for ccstatusline Custom Command
# Shows cumulative input_tokens (tokens not served from cache)
# Derived from statusline.sh in this repo

export PATH="/usr/bin:/usr/local/bin:$PATH"

JSONL=$(find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -not -path "*/subagents/*" | xargs ls -t 2>/dev/null | head -1)
[ -z "$JSONL" ] && exit 0
jq -r 'select(.type == "assistant") | .message.usage | (.input_tokens // 0)' "$JSONL" 2>/dev/null | awk '
{ sum += $1 }
END {
  if (sum >= 1000000) val = sprintf("%.1fM", sum/1000000)
  else if (sum >= 1000) val = sprintf("%.1fK", sum/1000)
  else val = sum
  printf "Uncached: %s\n", val
}'
