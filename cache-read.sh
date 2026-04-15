#!/bin/bash
JSONL=$(find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -not -path "*/subagents/*" | xargs ls -t 2>/dev/null | head -1)
[ -z "$JSONL" ] && exit 0
/usr/bin/jq -r 'select(.type == "assistant") | .message.usage | [(.cache_read_input_tokens // 0), (.cache_creation_input_tokens // 0), (.input_tokens // 0)] | @tsv' "$JSONL" 2>/dev/null | /usr/bin/awk '
{ read += $1; creation += $2; input += $3 }
END {
  total = read + creation + input
  if (total > 0) rate = read * 100 / total; else rate = 0
  if (read >= 1000000) val = sprintf("%.1fM", read/1000000)
  else if (read >= 1000) val = sprintf("%.1fK", read/1000)
  else val = read
  printf "RC: %s (%.0f%%)\n", val, rate
}'
