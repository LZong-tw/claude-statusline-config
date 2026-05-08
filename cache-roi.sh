#!/bin/bash
set -o pipefail
source ~/.claude/claude-jsonl.sh
[ -z "$JSONL" ] && exit 0
printf '%s\n' "$JSONL_ALL" | tr '\n' '\0' | xargs -0 jq -r 'select(.type == "assistant") | .message.usage | [(.cache_read_input_tokens // 0), (.cache_creation_input_tokens // 0)] | @tsv' 2>/dev/null | awk '
{ read += $1; creation += $2 }
END {
  if (creation > 0) roi = read / creation
  else roi = 0
  printf "ROI:%.1fx\n", roi
}'
