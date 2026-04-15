#!/bin/bash
set -o pipefail
source ~/.claude/claude-jsonl.sh
[ -z "$JSONL" ] && exit 0
echo "$JSONL_ALL" | while IFS= read -r f; do
  jq -r 'select(.type == "assistant") | .message.usage | (.input_tokens // 0)' "$f" 2>/dev/null
done | awk '
{ sum += $1 }
END {
  if (sum >= 1000000) val = sprintf("%.1fM", sum/1000000)
  else if (sum >= 1000) val = sprintf("%.1fK", sum/1000)
  else val = sum
  printf "Uncached: %s\n", val
}'
