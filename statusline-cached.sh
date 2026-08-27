#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ -z "${HOME:-}" ]]; then
  if [[ "${script_dir##*/}" == ".claude" ]]; then
    HOME="$(dirname -- "$script_dir")"
  else
    HOME="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
  fi
  export HOME
fi

cache_dir="${CLAUDE_STATUSLINE_CACHE_DIR:-$HOME/.claude/cache/statusline}"
ttl_seconds="${CLAUDE_STATUSLINE_TTL_SECONDS:-5}"
fast_renderer="${CLAUDE_STATUSLINE_FAST_RENDERER:-$script_dir/statusline-fast.mjs}"

payload="$(cat)"
statusline_payload="$payload"
if [[ -f "$fast_renderer" ]] && command -v node >/dev/null 2>&1; then
  enriched_payload="$(printf '%s' "$payload" | node "$fast_renderer" enrich 2>/dev/null || true)"
  if [[ -n "$enriched_payload" ]] && printf '%s' "$enriched_payload" | node -e 'JSON.parse(require("node:fs").readFileSync(0, "utf8"))' >/dev/null 2>&1; then
    statusline_payload="$enriched_payload"
  fi
fi
mkdir -p "$cache_dir" 2>/dev/null || true

cache_key="$(
  STATUSLINE_PAYLOAD="$payload" node - <<'NODE'
const crypto = require('node:crypto');
let payload = {};
try {
  payload = JSON.parse(process.env.STATUSLINE_PAYLOAD || '{}');
} catch {}
const identity = payload.transcript_path
  || payload.transcriptPath
  || payload.workspace?.current_dir
  || payload.cwd
  || 'global';
process.stdout.write(crypto.createHash('sha1').update(String(identity)).digest('hex'));
NODE
)"

cache_file="$cache_dir/statusline.$cache_key.txt"

now="$(date +%s)"
if [[ -f "$cache_file" && -s "$cache_file" ]]; then
  modified="$(stat -f %m "$cache_file" 2>/dev/null || stat -c %Y "$cache_file" 2>/dev/null || echo 0)"
  if [[ "$modified" =~ ^[0-9]+$ ]] && (( now - modified < ttl_seconds )); then
    cat "$cache_file"
    exit 0
  fi
fi

run_ccstatusline() {
  if [[ -n "${CCSTATUSLINE_BIN:-}" ]]; then
    printf '%s' "$statusline_payload" | "$CCSTATUSLINE_BIN"
    return
  fi

  if command -v ccstatusline >/dev/null 2>&1; then
    printf '%s' "$statusline_payload" | ccstatusline
    return
  fi

  local npx_cache_bin=""
  npx_cache_bin="$(find "${NPM_CONFIG_CACHE:-$HOME/.npm}/_npx" -path '*/node_modules/.bin/ccstatusline' -print -quit 2>/dev/null || true)"
  if [[ -n "$npx_cache_bin" && -x "$npx_cache_bin" ]]; then
    printf '%s' "$statusline_payload" | "$npx_cache_bin"
    return
  fi

  if command -v npx >/dev/null 2>&1; then
    printf '%s' "$statusline_payload" | env \
      npm_config_prefer_offline=true \
      npm_config_offline=true \
      npm_config_fetch_timeout=1000 \
      npm_config_fetch_retries=0 \
      npx -y ccstatusline@latest
    return
  fi

  return 127
}

render_fast() {
  local mode="$1"
  if [[ -f "$fast_renderer" ]] && command -v node >/dev/null 2>&1; then
    printf '%s' "$payload" | node "$fast_renderer" "$mode" 2>/dev/null || true
  fi
}

render_builtin_fallback() {
  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  STATUSLINE_PAYLOAD="$payload" node - <<'NODE'
const data = (() => {
  try {
    return JSON.parse(process.env.STATUSLINE_PAYLOAD || '{}');
  } catch {
    return {};
  }
})();

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const format = (value) => {
  const number = finite(value);
  if (number === null) return '';
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(number));
};

const context = data.context_window && typeof data.context_window === 'object'
  ? data.context_window
  : {};
const usage = context.current_usage && typeof context.current_usage === 'object'
  ? context.current_usage
  : {};
const input = finite(context.total_input_tokens) ?? finite(usage.input_tokens);
const output = finite(context.total_output_tokens) ?? finite(usage.output_tokens);
const total = input !== null && output !== null ? input + output : null;
const parts = [];
if (input !== null) parts.push(`In: ${format(input)}`);
if (output !== null) parts.push(`Out: ${format(output)}`);
if (total !== null) parts.push(`Total: ${format(total)}`);

const cost = finite(data.cost?.total_cost_usd);
if (cost !== null) parts.push(`Cost: $${cost.toFixed(2)}`);

const windowSize = finite(context.context_window_size);
let used = null;
if (Object.keys(usage).length > 0) {
  used = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
    .map((key) => finite(usage[key]) ?? 0)
    .reduce((sum, value) => sum + value, 0);
} else if (windowSize !== null && finite(context.used_percentage) !== null) {
  used = windowSize * finite(context.used_percentage) / 100;
}
if (windowSize !== null && used !== null) {
  const percentage = windowSize > 0 ? Math.round(used / windowSize * 100) : 0;
  parts.push(`Context: ${format(used)}/${format(windowSize)} (${percentage}%)`);
}

if (parts.length > 0) process.stdout.write(`${parts.join(' | ')}\n`);
NODE
}

render_fallback() {
  local model recent builtin read savings roi creation input
  model="$(render_fast model)"
  recent="$(render_fast recent)"
  builtin="$(render_builtin_fallback)"
  read="$(render_fast read)"
  savings="$(render_fast savings)"
  roi="$(render_fast roi)"
  creation="$(render_fast creation)"
  input="$(render_fast input)"

  {
    [[ -n "$model" ]] && printf '%s\n' "$model"
    [[ -n "$recent" ]] && printf '%s\n' "$recent"
    [[ -n "$builtin" ]] && printf '%s\n' "$builtin"
    printf '%s\n' "$read $savings $roi $creation $input" | sed 's/[[:space:]]*$//'
  } | sed '/^$/d'
}

tmp_file="$(mktemp "${TMPDIR:-/tmp}/statusline-cached.XXXXXX")"

if run_ccstatusline >"$tmp_file" 2>/dev/null && [[ -s "$tmp_file" ]]; then
  if mkdir -p "$cache_dir" 2>/dev/null && mv "$tmp_file" "$cache_file" 2>/dev/null; then
    cat "$cache_file"
  else
    cat "$tmp_file"
    rm -f "$tmp_file"
  fi
  exit 0
fi

rm -f "$tmp_file"
fallback="$(render_fallback)"
if [[ -n "$fallback" ]]; then
  printf '%s\n' "$fallback"
  exit 0
fi

if [[ "${CLAUDE_STATUSLINE_STALE_ON_ERROR:-}" == "1" && -f "$cache_file" && -s "$cache_file" ]]; then
  cat "$cache_file"
fi
