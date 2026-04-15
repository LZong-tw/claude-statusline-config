#!/bin/bash
# Recent cache hits widget for ccstatusline Custom Command
# Shows last 5 requests as dots: ● = cache hit (read > 50%), ○ = miss

export PATH="/usr/bin:/usr/local/bin:$PATH"

JSONL=$(find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -not -path "*/subagents/*" | xargs ls -t 2>/dev/null | head -1)
[ -z "$JSONL" ] && exit 0
jq -r 'select(.type == "assistant") | .message.usage | [(.cache_read_input_tokens // 0), (.cache_creation_input_tokens // 0), (.input_tokens // 0)] | @tsv' "$JSONL" 2>/dev/null | tail -5 | awk '
{
  total = $1 + $2 + $3
  if (total > 0 && ($1 / total) > 0.5) dots = dots "●"
  else dots = dots "○"
}
END { printf "L5: %s\n", dots }'
