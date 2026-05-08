#!/bin/bash
set -o pipefail
source ~/.claude/claude-jsonl.sh
[ -z "$JSONL" ] && exit 0
printf '%s\n' "$JSONL_ALL" | tr '\n' '\0' | xargs -0 jq -r 'select(.type == "assistant") | .message.usage | (.cache_creation_input_tokens // 0)' 2>/dev/null | awk '
{ sum += $1 }
END {
  if (sum >= 1000000) val = sprintf("%.1fM", sum/1000000)
  else if (sum >= 1000) val = sprintf("%.1fK", sum/1000)
  else val = sum
  printf "CacheCreate: %s\n", val
}'
