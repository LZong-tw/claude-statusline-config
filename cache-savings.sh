#!/bin/bash
# Pricing as of 2026-04-15:
# cache_read=0.1x, cache_creation=1.25x (5min TTL), input=1.0x
# Per 1M input: opus=$5, sonnet=$3, haiku=$1
set -o pipefail
source ~/.claude/claude-jsonl.sh
[ -z "$JSONL" ] && exit 0
echo "$JSONL_ALL" | while IFS= read -r f; do
  jq -r 'select(.type == "assistant") | [.message.model, (.message.usage.cache_read_input_tokens // 0), (.message.usage.cache_creation_input_tokens // 0), (.message.usage.input_tokens // 0)] | @tsv' "$f" 2>/dev/null
done | awk -F '\t' '
{
  model = $1; read = $2+0; creation = $3+0; input = $4+0
  if (model ~ /opus/)        price = 5.0
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
  printf "Saved:$%.2f (%.0f%%)\n", saved, pct
}'
