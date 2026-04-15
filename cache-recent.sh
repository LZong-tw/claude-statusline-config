#!/bin/bash
# T8: last 8 user turns (●/○) + per-turn API call breakdown (■/□, max 10 per turn, + if truncated)
set -o pipefail
source ~/.claude/claude-jsonl.sh
[ -z "$JSONL" ] && exit 0

# Only main session for turn tracking (subagent turns are separate conversations)
jq -r '
  if .type == "user" then "U\t0\t0\t0"
  elif .type == "assistant" then
    ["A",
     (.message.usage.cache_read_input_tokens // 0),
     (.message.usage.cache_creation_input_tokens // 0),
     (.message.usage.input_tokens // 0)
    ] | @tsv
  else empty
  end
' "$JSONL" 2>/dev/null | awk '
function is_hit(read, create, input,    total) {
  total = read + create + input
  return (total > 0 && (read / total) > 0.5)
}
function flush() {
  if (!in_turn) return
  n++
  total = turn_read + turn_create + turn_input
  if (total > 0) turn_hit[n] = is_hit(turn_read, turn_create, turn_input)
  else turn_hit[n] = -1
  turn_calls[n] = call_dots (call_count > 10 ? "+" : "")
  turn_read = turn_create = turn_input = 0
  call_dots = ""; call_count = 0
}
$1 == "U" { flush(); in_turn = 1 }
$1 == "A" && in_turn {
  read = $2+0; create = $3+0; input = $4+0
  turn_read += read; turn_create += create; turn_input += input
  call_count++
  if (call_count <= 10) {
    call_dots = call_dots (is_hit(read, create, input) ? "■" : "□")
  }
}
END {
  flush()
  start = (n > 8) ? n - 7 : 1
  turn_dots = ""; api_parts = ""
  for (i = start; i <= n; i++) {
    if (turn_hit[i] == -1) turn_dots = turn_dots "◌"
    else turn_dots = turn_dots (turn_hit[i] ? "●" : "○")
    api_parts = api_parts (i > start ? "│" : "") turn_calls[i]
  }
  printf "T8: %s  %s\n", turn_dots, api_parts
}'
