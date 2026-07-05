# claude-statusline-config

Personal [ccstatusline](https://github.com/sirmalloc/ccstatusline) configuration and cache metrics scripts for Claude Code.

The default config is optimized for Claude Code on macOS/Linux: ccstatusline keeps the original 4-line visual layout, but the custom widgets use one Node renderer with an incremental shared cache instead of `bash`/`jq`/`awk` scripts. That avoids repeated shell startup and repeated full scans of the same live JSONL transcript.

Inspired by [nnaveenraju/claude-code-status-line](https://github.com/nnaveenraju/claude-code-status-line) — same JSONL metrics idea, but the default path now aggregates the expensive work once.

## Files

| File | Widget label | What it shows |
|------|-------------|---------------|
| `statusline-fast.mjs` | `Sonnet 4.6 1M` / `T8: ...` / cache metrics | Node renderer for model name, recent turns, and cache metrics |
| `statusline-cached.sh` | — | Claude Code `statusLine.command` wrapper with per-session cache keys |
| `ccstatusline-settings.json` | — | 4-line ccstatusline layout using `statusline-fast.mjs` |
| `ccstatusline-settings.windows.json` | — | Same layout with `%USERPROFILE%` paths so `cmd.exe`-spawned widgets work on Windows (see [Windows](#windows)) |
| `scripts/verify-settings.mjs` | — | Guardrail that fails if the default layout stops matching the original 4-line contract |
| `scripts/verify-statusline-fast.mjs` | — | Guardrail for renderer behavior, including AirClaude model label overrides |
| `claude-jsonl.sh` | — | Legacy helper: finds current project's session JSONL from stdin |
| `model-name.sh` | `Sonnet 4.6 1M` | Legacy model name widget |
| `cache-read.sh` | `ReadCache: 58.4M (94%)` | Legacy `cache_read_input_tokens` + hit rate widget |
| `cache-creation.sh` | `CacheCreate: 3.7M` | Legacy `cache_creation_input_tokens` widget |
| `cache-input.sh` | `Uncached: 534` | Legacy `input_tokens` widget |
| `cache-savings.sh` | `Saved≈$210.47 (84%)` | Legacy USD savings widget |
| `cache-roi.sh` | `ROI:17.4x` | Legacy `cache_read / cache_creation` ratio widget |
| `cache-recent.sh` | `T8: ●●●○●●●●  ■■│■│■■■│□│■■│■│■│■` | Legacy last 8 user turns + API call breakdown widget |
| `hooks/check-ccstatusline.cjs` | — | Optional Claude hook reminder when the global `ccstatusline` package is older than 14 days |

### Symbols

| Symbol | Meaning |
|--------|---------|
| ● | User turn: cache hit (>50% of tokens from cache) |
| ○ | User turn: cache miss |
| ◌ | User turn: no data (no assistant response yet) |
| ■ | API call: cache hit |
| □ | API call: cache miss |
| + | More than 10 API calls in this turn (truncated) |
| ⏳ | Turn in progress / awaiting response |
| … | Older turns' breakdown trimmed (newest preserved) |

## Layout

```
Line 1: Tokens In · Tokens Out · Tokens Total · Thinking Effort
Line 2: Model (fast) · Version · Git Branch · Git Worktree · Git Changes
Line 3: T8 Recent · Session Cost · Context Bar · Session Clock
Line 4: ReadCache · Saved · ROI · CacheCreate · Uncached
```

Theme: nord-aurora · Powerline enabled

**Widget order is intentional.** ccstatusline truncates from the right on narrow screens, so important widgets are placed on the left. On Line 3, T8 and Cost survive truncation; Context Bar and Session Clock get cut first. On Line 4, ReadCache/Saved/ROI are preserved; CacheCreate/Uncached are cut first.

## Design

- **One Node renderer for all custom metrics**: `statusline-fast.mjs` has separate modes for `model`, `recent`, `read`, `savings`, `roi`, `creation`, and `input`, preserving the original widget layout and colors.
- **Incremental repeat refreshes**: metrics are cached under the OS temp directory (`ccstatusline-fast/<sha1>.json`). Unchanged files are reused, append-only transcript growth reads only the new tail, and truncation rewrites force a clean rescan.
- **Bounded reads**: large JSONL tails are scanned in chunks instead of loading the whole transcript into memory at once.
- **Cache hygiene**: temp cache files older than 7 days are pruned, and the cache directory is capped at 200 JSON files.
- **Targeted JSONL scanning**: the fast path extracts only event type, model, and token usage fields instead of fully parsing large message/tool payloads.
- **No shell widget requirement on the default path**: the default settings use `node "$HOME/.claude/statusline-fast.mjs" ...`, so redraws do not pay `bash -> jq -> awk` startup costs.
- **Session-scoped via `transcript_path`**: reads the active session's JSONL path directly from ccstatusline stdin. It falls back to the matching project slug under `~/.claude/projects/` only when `transcript_path` is missing or stale.
- **Includes subagents**: aggregates token usage from the main session plus subagent JSONL files in known per-session `subagents/` folders.
- **Route-aware pricing override**: `AIRCLAUDE_STATUSLINE_INPUT_PRICE_PER_MILLION` can override the estimated input price for the current route. Without it, the renderer falls back to broad Anthropic-family defaults (Opus=$5, Sonnet/default=$3, Haiku=$1 per 1M input tokens).
- **Keyed wrapper cache**: `statusline-cached.sh` keys rendered statusline output by `transcript_path`/workspace, so one live session does not reuse another session's statusline cache. Empty cache entries are ignored, and if ccstatusline cannot run the wrapper falls back to the local `statusline-fast.mjs` renderer instead of returning a blank statusline.
- **Turn-level tracking**: groups API calls by user turn, so each dot represents an actual interaction rather than a single API call in a tool-use loop.
- **Dynamic width for recent turns**: the API-call breakdown trims oldest turns first so newest data is preserved.

## Performance Notes

The old 4-line config was fine while transcripts were small, but it does not scale on Windows. A real live transcript around 26 MB measured like this:

```
ccstatusline cold: ~28.6 s
ccstatusline warm: ~3.5 s
cache-recent.sh:   ~9.4 s
cache-read.sh:     ~8.3 s
model-name.sh:     ~6.9 s
```

The bottleneck is the combination of Windows process startup and repeated JSONL scans. Seven custom widgets means seven command launches, and the cache widgets repeatedly rediscover and rescan the same transcript.

`statusline-fast.mjs` changes the shape of the work:

- model rendering is a tiny JSON parse;
- the first metric refresh updates a shared incremental cache with targeted JSONL field extraction;
- repeat redraws reuse the temp cache, and transcript appends process only new JSONL lines;
- the original 4-line layout is preserved, including the separate metric colors on Line 4.

On the same Windows machine, a current ~30 MB transcript measured roughly:

```
model:         ~0.1-0.2 s
recent cold:   ~0.3 s
cache cached:  <0.1 s per metric
```

The previous README documented a rejected bash shared-cache prototype. That result was true for a 1.8 MB transcript because the cache machinery cost more than a single `jq` pass. With much larger live transcripts, the better fix is not a bash env cache per widget; it is one Node renderer with a shared incremental cache.

Headline rule: **measure before optimizing**. On Windows, intuition often points at `jq`, but command startup and repeated discovery dominate.

## Setup

### 1. Install scripts

```sh
mkdir -p ~/.claude
cp statusline-fast.mjs statusline-cached.sh ~/.claude/
chmod +x ~/.claude/statusline-fast.mjs ~/.claude/statusline-cached.sh
```

The legacy shell widgets are still kept in this repo for reference and non-default setups:

```sh
cp claude-jsonl.sh cache-*.sh model-name.sh ~/.claude/
chmod +x ~/.claude/claude-jsonl.sh ~/.claude/cache-*.sh ~/.claude/model-name.sh
```

### 2. ccstatusline settings

```sh
mkdir -p ~/.config/ccstatusline
cp ccstatusline-settings.json ~/.config/ccstatusline/settings.json
```

On Windows, use `ccstatusline-settings.windows.json` instead — see [Windows](#windows) for why.

### 3. Claude Code statusLine

Use the cache wrapper as the Claude Code `statusLine.command`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "/Users/YOU/.claude/statusline-cached.sh",
    "padding": 0
  }
}
```

Prefer a globally installed ccstatusline shim so status redraws do not invoke `npx` or touch the registry path:

```sh
npm install -g ccstatusline@latest
command -v ccstatusline
```

Or add widgets manually via the ccstatusline TUI:

```
node "$HOME/.claude/statusline-fast.mjs" model
node "$HOME/.claude/statusline-fast.mjs" recent
node "$HOME/.claude/statusline-fast.mjs" read
node "$HOME/.claude/statusline-fast.mjs" savings
node "$HOME/.claude/statusline-fast.mjs" roi
node "$HOME/.claude/statusline-fast.mjs" creation
node "$HOME/.claude/statusline-fast.mjs" input
```

Each custom-command widget sets a bounded timeout: `2000 ms` for model name and `3000 ms` for the JSONL-backed metrics. Current measurements are comfortably below that; if they time out, something else is likely starving the machine.

Before changing the default layout, run the guard:

```sh
node ./scripts/verify-settings.mjs
node ./scripts/verify-statusline-fast.mjs
bash ./scripts/verify-statusline-cached.sh
```

To inspect which transcript the custom metrics are reading:

```sh
printf '%s' "$CLAUDE_STATUSLINE_PAYLOAD" | node ~/.claude/statusline-fast.mjs source
```

### 4. Optional freshness reminder hook

Install the hook script:

```sh
mkdir -p ~/.claude/hooks
cp hooks/check-ccstatusline.cjs ~/.claude/hooks/check-ccstatusline.cjs
```

Then add it to a Claude Code `SessionStart` hook. Example:

```jsonc
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/check-ccstatusline.cjs\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

The hook is read-only. It checks `npm root -g`, finds the global `ccstatusline/package.json`, and emits an `additionalContext` reminder when the installed package timestamp is at least 14 days old.

## Windows

Claude Code runs `statusLine.command` through Git Bash on Windows (or PowerShell when Git Bash is absent) and pipes the JSON payload on stdin. Two Windows-specific details matter.

**Use the `%USERPROFILE%` settings variant.** ccstatusline launches each custom-command widget through the platform shell, which is `cmd.exe` on Windows (Node's `child_process` shell is `ComSpec`). `cmd.exe` does not expand the bash-style `$HOME`, so the default `ccstatusline-settings.json` renders every custom widget as `[Exit: 1]` — and it fails the same way even when ccstatusline itself is launched from Git Bash, because the child shell is still `cmd.exe`. Install `ccstatusline-settings.windows.json` instead. It is identical to the default layout but uses `%USERPROFILE%` (expanded by `cmd.exe`, no hard-coded username) with forward slashes (accepted by Node):

```powershell
mkdir "$env:USERPROFILE\.config\ccstatusline" -Force | Out-Null
copy ccstatusline-settings.windows.json "$env:USERPROFILE\.config\ccstatusline\settings.json"
```

**Quote the wrapper path in `statusLine.command`.** Git Bash word-splits an unquoted `~`/`$HOME` when the Windows home directory contains a space (e.g. `C:\Users\First Last`), so the bare `~/.claude/statusline-cached.sh` form breaks with `Is a directory`. Quote it, and invoke it through `bash` so the execute bit is irrelevant:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash \"$HOME/.claude/statusline-cached.sh\"",
    "padding": 0
  }
}
```

Git Bash supplies the POSIX tools the wrapper needs (`stat`, `date`, `mktemp`, `find`, `sed`). Node and the global `ccstatusline` must be on the `PATH` that Git Bash inherits — verify with:

```powershell
bash -lc 'command -v node ccstatusline'
```

## How savings are calculated

```
effective_cost = 0.1 × cache_read + 1.25 × cache_creation + 1.0 × input  (per-model price)
baseline_cost  = cache_read + cache_creation + input                        (per-model price)
saved_usd      ≈ baseline_cost − effective_cost
saved_pct      = (1 − effective_cost / baseline_cost) × 100
```

Set `AIRCLAUDE_STATUSLINE_INPUT_PRICE_PER_MILLION` to make the estimate use the current route's input price. Without that env var, the fallback pricing is:

| Model | Price |
|-------|-------|
| Opus 4.6 | $5.00 |
| Sonnet 4.6 | $3.00 |
| Haiku 4.5 | $1.00 |

## Requirements

- [ccstatusline](https://github.com/sirmalloc/ccstatusline) ≥ 2.2.9
- Node.js available from `cmd.exe`
- Legacy shell widgets only: `bash`, `jq`, `awk`, `sed`

For Windows, verify Node is reachable from the same shell ccstatusline uses:

```powershell
where.exe node
```

If you use the legacy shell widgets on Windows, install [Git for Windows](https://git-scm.com/download/win) and `jq`, then make sure `bash` is reachable from `cmd.exe`.

## Related

- [nnaveenraju/claude-code-status-line#1](https://github.com/nnaveenraju/claude-code-status-line/pull/1) — upstream PR with the original shell script split
- [sirmalloc/ccstatusline#305](https://github.com/sirmalloc/ccstatusline/issues/305) — Powerline caps TUI support for 4+ lines
- [sirmalloc/ccstatusline#308](https://github.com/sirmalloc/ccstatusline/issues/308) — Pass terminalWidth in custom command stdin JSON
