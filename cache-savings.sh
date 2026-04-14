#!/bin/bash
# CacheSaved widget for ccstatusline Custom Command
# Shows cost savings rate: 1 - effective_cost / baseline_cost
# Pricing: cache_read=0.1x, cache_creation=1.25x, input=1.0x

export PATH="/usr/bin:/usr/local/bin:$PATH"

JSONL=$(find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -not -path "*/subagents/*" | xargs ls -t 2>/dev/null | head -1)
[ -z "$JSONL" ] && exit 0
jq -r 'select(.type == "assistant") | .message.usage | [(.cache_read_input_tokens // 0), (.cache_creation_input_tokens // 0), (.input_tokens // 0)] | @tsv' "$JSONL" 2>/dev/null | awk '
{ read += $1; creation += $2; input += $3 }
END {
  baseline = read + creation + input
  if (baseline > 0) {
    effective = 0.1 * read + 1.25 * creation + 1.0 * input
    savings = (1 - effective / baseline) * 100
  } else {
    savings = 0
  }
  printf "Saved: %.0f%%\n", savings
}'
