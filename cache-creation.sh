#!/bin/bash
JSONL=$(find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -not -path "*/subagents/*" | xargs ls -t 2>/dev/null | head -1)
[ -z "$JSONL" ] && exit 0
/usr/bin/jq -r 'select(.type == "assistant") | .message.usage | (.cache_creation_input_tokens // 0)' "$JSONL" 2>/dev/null | /usr/bin/awk '
{ sum += $1 }
END {
  if (sum >= 1000000) val = sprintf("%.1fM", sum/1000000)
  else if (sum >= 1000) val = sprintf("%.1fK", sum/1000)
  else val = sum
  printf "CC: %s\n", val
}'
