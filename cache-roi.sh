#!/bin/bash
# CacheROI widget for ccstatusline Custom Command
# Shows cache_read / cache_creation ratio (how many times writes paid back)

export PATH="/usr/bin:/usr/local/bin:$PATH"

JSONL=$(find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -not -path "*/subagents/*" | xargs ls -t 2>/dev/null | head -1)
[ -z "$JSONL" ] && exit 0
jq -r 'select(.type == "assistant") | .message.usage | [(.cache_read_input_tokens // 0), (.cache_creation_input_tokens // 0)] | @tsv' "$JSONL" 2>/dev/null | awk '
{ read += $1; creation += $2 }
END {
  if (creation > 0) roi = read / creation
  else roi = 0
  printf "ROI: %.1fx\n", roi
}'
