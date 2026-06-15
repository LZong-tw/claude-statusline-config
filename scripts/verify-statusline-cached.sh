#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/statusline-cached-fixture.XXXXXX")"
trap 'rm -rf "$fixture_dir"' EXIT

cat >"$fixture_dir/session.jsonl" <<'JSONL'
{"type":"user"}
{"type":"assistant","message":{"model":"example-model","usage":{"cache_read_input_tokens":1000000,"cache_creation_input_tokens":0,"input_tokens":0}}}
JSONL

payload="$(
  node - "$fixture_dir/session.jsonl" <<'NODE'
const transcript = process.argv[2];
process.stdout.write(JSON.stringify({
  transcript_path: transcript,
  cwd: process.cwd(),
  workspace: { current_dir: process.cwd() },
  model: { display_name: 'Claude Sonnet 4.6' },
}));
NODE
)"

cache_dir="$fixture_dir/cache"
mkdir "$cache_dir"
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
: >"$cache_dir/statusline.$cache_key.txt"

fakebin="$fixture_dir/bin"
mkdir "$fakebin" "$fixture_dir/home"
ln -s "$(command -v node)" "$fakebin/node"

output="$(
  printf '%s' "$payload" | env \
    PATH="$fakebin:/usr/bin:/bin" \
    HOME="$fixture_dir/home" \
    CLAUDE_STATUSLINE_CACHE_DIR="$cache_dir" \
    CLAUDE_STATUSLINE_TTL_SECONDS=999 \
    "$root/statusline-cached.sh"
)"

if [[ -z "$output" ]]; then
  echo "statusline-cached fallback must not return blank output" >&2
  exit 1
fi

if [[ "$output" != *"Sonnet 4.6"* ]]; then
  echo "statusline-cached fallback should include the model label" >&2
  printf '%s\n' "$output" >&2
  exit 1
fi

if [[ "$output" != *"ReadCache:"* ]]; then
  echo "statusline-cached fallback should include cache metrics" >&2
  printf '%s\n' "$output" >&2
  exit 1
fi

echo "statusline-cached guard ok"
