#!/usr/bin/env bash
set -euo pipefail

cache_dir="${CLAUDE_STATUSLINE_CACHE_DIR:-$HOME/.claude/cache/statusline}"
ttl_seconds="${CLAUDE_STATUSLINE_TTL_SECONDS:-5}"

payload="$(cat)"
mkdir -p "$cache_dir"

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
tmp_file="$cache_file.$$"

now="$(date +%s)"
if [[ -f "$cache_file" ]]; then
  modified="$(stat -f %m "$cache_file" 2>/dev/null || stat -c %Y "$cache_file" 2>/dev/null || echo 0)"
  if [[ "$modified" =~ ^[0-9]+$ ]] && (( now - modified < ttl_seconds )); then
    cat "$cache_file"
    exit 0
  fi
fi

run_ccstatusline() {
  if [[ -n "${CCSTATUSLINE_BIN:-}" ]]; then
    printf '%s' "$payload" | "$CCSTATUSLINE_BIN"
    return
  fi

  if command -v ccstatusline >/dev/null 2>&1; then
    printf '%s' "$payload" | ccstatusline
    return
  fi

  local npx_cache_bin=""
  npx_cache_bin="$(find "${NPM_CONFIG_CACHE:-$HOME/.npm}/_npx" -path '*/node_modules/.bin/ccstatusline' -print -quit 2>/dev/null || true)"
  if [[ -n "$npx_cache_bin" && -x "$npx_cache_bin" ]]; then
    printf '%s' "$payload" | "$npx_cache_bin"
    return
  fi

  if command -v npx >/dev/null 2>&1; then
    printf '%s' "$payload" | env \
      npm_config_prefer_offline=true \
      npm_config_offline=true \
      npm_config_fetch_timeout=1000 \
      npm_config_fetch_retries=0 \
      npx -y ccstatusline@latest
    return
  fi

  return 127
}

if run_ccstatusline >"$tmp_file" 2>/dev/null && [[ -s "$tmp_file" ]]; then
  mv "$tmp_file" "$cache_file"
  cat "$cache_file"
  exit 0
fi

rm -f "$tmp_file"
if [[ "${CLAUDE_STATUSLINE_STALE_ON_ERROR:-}" == "1" && -f "$cache_file" ]]; then
  cat "$cache_file"
fi
