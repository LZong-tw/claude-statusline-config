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
  turn_ncalls[n] = (call_count > 10 ? 10 : call_count) + (call_count > 10 ? 1 : 0)
  turn_read = turn_create = turn_input = 0
  call_dots = ""; call_count = 0
}
$1 == "U" {
  # Only start a new turn if previous was an assistant response (or first turn)
  # Consecutive user entries (e.g. image uploads) merge into one turn
  if (saw_assistant || !in_turn) { flush(); in_turn = 1 }
  saw_assistant = 0
}
$1 == "A" && in_turn {
  saw_assistant = 1
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

  # Dynamic max based on terminal width
  # "T8: ●●●●●●●●  " = ~20 chars, each square ~2 cols, separators ~1 col
  # ccstatusline uses ~40% of terminal for this widget
  cmd = "tput cols 2>/dev/null"
  cmd | getline cols
  close(cmd)
  cols = (cols + 0 > 0) ? cols + 0 : 80
  max_squares = int(cols * 0.15)
  if (max_squares < 8) max_squares = 8
  if (max_squares > 30) max_squares = 30

  # Count symbols (include ⏳ for empty turns)
  total_sq = 0
  for (i = start; i <= n; i++) total_sq += (turn_ncalls[i] > 0 ? turn_ncalls[i] : 1)
  trim_start = start
  while (total_sq > max_squares && trim_start < n) {
    total_sq -= (turn_ncalls[trim_start] > 0 ? turn_ncalls[trim_start] : 1)
    trim_start++
  }

  # Build turn dots (always all 8)
  turn_dots = ""
  for (i = start; i <= n; i++) {
    if (turn_hit[i] == -1) turn_dots = turn_dots "◌"
    else turn_dots = turn_dots (turn_hit[i] ? "●" : "○")
  }

  # Build API breakdown (trim oldest if >30 chars)
  api_parts = ""
  if (trim_start > start) api_parts = "…"
  for (i = trim_start; i <= n; i++) {
    if (length(api_parts) > 0 && api_parts != "…") api_parts = api_parts "│"
    if (api_parts == "…") api_parts = api_parts "│"
    api_parts = api_parts (turn_calls[i] == "" ? "\342\217\263" : turn_calls[i])
  }
  printf "T8: %s  %s\n", turn_dots, api_parts
}'
