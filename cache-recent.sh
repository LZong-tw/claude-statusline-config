#!/bin/bash
# Recent cache hits widget for ccstatusline Custom Command
# Two modes combined:
# - User turns (circles): ● hit ○ miss — last 5 turns
# - API calls (squares):  ■ hit □ miss — all calls in last 5 turns, separated by │
# Output: T5: ●●●○●  ■■│■│■■■│□│■■

export PATH="/usr/bin:/usr/local/bin:$PATH"

JSONL=$(find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -not -path "*/subagents/*" | xargs ls -t 2>/dev/null | head -1)
[ -z "$JSONL" ] && exit 0

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
function flush(    total) {
  if (!in_turn || (turn_read + turn_create + turn_input) == 0) return
  n++
  turn_hit[n]  = is_hit(turn_read, turn_create, turn_input)
  turn_calls[n] = call_dots
  turn_read = turn_create = turn_input = 0
  call_dots = ""
}
$1 == "U" { flush(); in_turn = 1 }
$1 == "A" && in_turn {
  read = $2+0; create = $3+0; input = $4+0
  turn_read += read; turn_create += create; turn_input += input
  call_dots = call_dots (is_hit(read, create, input) ? "■" : "□")
}
END {
  flush()
  start = (n > 5) ? n - 4 : 1
  turn_dots = ""
  api_parts  = ""
  for (i = start; i <= n; i++) {
    turn_dots = turn_dots (turn_hit[i] ? "●" : "○")
    api_parts = api_parts (i > start ? "│" : "") turn_calls[i]
  }
  printf "T5: %s  %s\n", turn_dots, api_parts
}'
