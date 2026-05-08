#!/bin/bash
# NOTE: terminal width detection unavailable in ccstatusline custom command context
# (tput/stty/COLUMNS all return 80 due to piped stdio). Full labels always used.
# See: https://github.com/sirmalloc/ccstatusline/issues/XXX
set -o pipefail
source ~/.claude/claude-jsonl.sh
[ -z "$JSONL" ] && exit 0
printf '%s\n' "$JSONL_ALL" | tr '\n' '\0' | xargs -0 jq -r 'select(.type == "assistant") | .message.usage | [(.cache_read_input_tokens // 0), (.cache_creation_input_tokens // 0), (.input_tokens // 0)] | @tsv' 2>/dev/null | awk '
{ read += $1; creation += $2; input += $3 }
END {
  total = read + creation + input
  if (total > 0) rate = read * 100 / total; else rate = 0
  if (read >= 1000000) val = sprintf("%.1fM", read/1000000)
  else if (read >= 1000) val = sprintf("%.1fK", read/1000)
  else val = read
  printf "ReadCache: %s (%.0f%%)\n", val, rate
}'
