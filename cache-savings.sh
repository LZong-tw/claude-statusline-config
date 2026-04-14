#!/bin/bash
# Saved widget for ccstatusline Custom Command
# Shows USD saved and savings rate combined: Saved: $XX.XX (XX%)
# Pricing per 1M input: opus=$5, sonnet=$3, haiku=$1
# Weights: cache_read=0.1x, cache_creation=1.25x, input=1.0x

export PATH="/usr/bin:/usr/local/bin:$PATH"

JSONL=$(find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -not -path "*/subagents/*" | xargs ls -t 2>/dev/null | head -1)
[ -z "$JSONL" ] && exit 0
jq -r 'select(.type == "assistant") | [.message.model, (.message.usage.cache_read_input_tokens // 0), (.message.usage.cache_creation_input_tokens // 0), (.message.usage.input_tokens // 0)] | @tsv' "$JSONL" 2>/dev/null | awk '
{
  model = $1; read = $2; creation = $3; input = $4
  if (model ~ /opus/)       price = 5.0
  else if (model ~ /sonnet/) price = 3.0
  else if (model ~ /haiku/)  price = 1.0
  else                        price = 3.0

  baseline  += (read + creation + input) * price / 1000000
  effective += (0.1 * read + 1.25 * creation + 1.0 * input) * price / 1000000
}
END {
  saved = baseline - effective
  if (baseline > 0) pct = (1 - effective / baseline) * 100
  else pct = 0
  printf "Saved: $%.2f (%.0f%%)\n", saved, pct
}'
