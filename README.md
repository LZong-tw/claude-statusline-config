# claude-statusline-config

Personal [ccstatusline](https://github.com/sirmalloc/ccstatusline) configuration and cache metrics scripts for Claude Code.

Inspired by [nnaveenraju/claude-code-status-line](https://github.com/nnaveenraju/claude-code-status-line) — same idea of reading session JSONL files, split into individual ccstatusline Custom Command widgets.

## Files

| File | Widget label | What it shows |
|------|-------------|---------------|
| `claude-jsonl.sh` | — | Shared helper: finds current project's session JSONL from stdin |
| `model-name.sh` | `Sonnet 4.6 1M` | Model name, trimmed |
| `cache-read.sh` | `ReadCache: 58.4M (94%)` | `cache_read_input_tokens` + hit rate % |
| `cache-creation.sh` | `CacheCreate: 3.7M` | `cache_creation_input_tokens` |
| `cache-input.sh` | `Uncached: 534` | `input_tokens` (full-price, no cache) |
| `cache-savings.sh` | `Saved:$210.47 (84%)` | Actual USD saved + cost savings rate |
| `cache-roi.sh` | `ROI:17.4x` | `cache_read / cache_creation` ratio |
| `cache-recent.sh` | `T8: ●●●○●●●●  ■■│■│■■■│□│■■│■│■│■` | Last 8 user turns + API call breakdown |

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
Line 2: Model (custom) · Version · Git Branch · Git Worktree · Git Changes
Line 3: T8 Recent · Session Cost · Context Bar · Session Clock
Line 4: ReadCache · Saved · ROI · CacheCreate · Uncached
```

Theme: nord-aurora · Powerline enabled

**Widget order is intentional.** ccstatusline truncates from the right on narrow screens, so important widgets are placed on the left. On Line 3, T8 and Cost survive truncation; Context Bar and Session Clock get cut first. On Line 4, ReadCache/Saved/ROI are preserved; CacheCreate/Uncached are cut first.

## Design

- **Session-scoped via `transcript_path`**: reads the active session's JSONL path directly from ccstatusline stdin's `transcript_path` field (provided by Claude Code 2.x). Falls back to walking parent directories of `workspace.current_dir` to locate the matching project slug under `~/.claude/projects/` only when `transcript_path` is missing or stale. The fast path is also more correct — it always points at THIS session, rather than picking "newest JSONL in the project dir" which would misattribute when multiple sessions share a cwd.
- **Includes subagents**: aggregates token usage from the main session + all subagent JSONL files in the session's `subagents/` directory
- **Per-model pricing**: `cache-savings.sh` uses actual model prices (Opus=$5, Sonnet=$3, Haiku=$1 per 1M input) for accurate USD savings
- **Turn-level tracking**: `cache-recent.sh` groups API calls by user turn, so each dot represents an actual interaction rather than a single API call in a tool-use loop. Consecutive user entries (e.g. image uploads) are merged into one turn
- **Dynamic width**: breakdown length adapts to terminal width, trimming oldest turns first so newest data is always visible
- **Pending indicator**: turns awaiting a response show ⏳ instead of being silently dropped

## Known Limitations

- **No adaptive labels**: `tput cols`, `stty size`, and `$COLUMNS` all return 80 inside ccstatusline custom command context (piped stdio). Full labels are always used; ccstatusline handles truncation on narrow terminals. Tracked at [sirmalloc/ccstatusline#308](https://github.com/sirmalloc/ccstatusline/issues/308) — once `terminalWidth` is exposed in the stdin JSON, scripts can switch between full/abbreviated labels.
- **Session identification**: when multiple Claude Code sessions exist in the same project directory, the scripts read the most recently modified JSONL. If two sessions run simultaneously in the same directory, the statusline may show data from the other session.
- **Pricing hardcoded**: `cache-savings.sh` has Anthropic pricing as of 2026-04-15. Update the script if pricing changes.
- **Not real-time on new sessions**: scripts read from session JSONL files, which are only written after each API call completes. When starting a new conversation, the statusline briefly shows the previous session's data until the first response in the new session arrives.
- **Cache widgets re-scan JSONL each refresh**: each of the 5 cache widgets independently runs `jq` across `$JSONL_ALL` on every statusline refresh. Per-widget timeout is 5000 ms; on the maintainer's 1.8 MB live JSONL with 9 subagent files, mean wall time is ~1.3 s per widget after optimization. Under degenerate conditions (50 MB+ JSONL, slow disk, high CPU contention) widgets can still time out. A bounded design would precompute aggregated metrics once per refresh into a shared cache file. **An implementation of that shared-cache approach was prototyped and rejected as a regression on Windows** — see _Performance notes_ below for why.

## Performance notes

These are written down so the next contributor doesn't waste a day re-discovering them. Numbers below were measured on Windows + Git Bash against a real session: 1.8 MB main JSONL + 9 subagent files. macOS/Linux is faster across the board; everything here is more pronounced on Windows because every process spawn costs 50–100 ms.

### What the bottleneck actually is

The instinct on first look is "5 cache widgets each scan a 2 MB JSONL with `jq` — that's the bottleneck." It isn't. A single `jq` pass over 2 MB takes ~80 ms. The real cost is **process spawns inside `claude-jsonl.sh`**: walking parent directories with `sed` per level, two `find` invocations per discovered directory, and (originally) a fork-per-file `jq` loop in each widget. Pre-optimization total per ccstatusline refresh was **~14.96 s**. After all of the changes below, **~8.65 s — 1.73× faster, with each widget comfortably under the 5000 ms timeout**.

### What worked

1. **Use `transcript_path` from stdin instead of cwd-walk discovery.** Claude Code passes the active session's JSONL path directly. Trusting it lets `claude-jsonl.sh` skip the find/walk-parents/sed pipeline entirely. Single-widget claude-jsonl.sh source dropped from ~1000 ms to ~300 ms.
2. **Single `jq` invocation across all `$JSONL_ALL` files.** Each cache widget previously did `while read f; do jq -r '...' "$f"; done`, spawning N `jq` processes for N files. Replaced with `printf '%s\n' "$JSONL_ALL" | tr '\n' '\0' | xargs -0 jq -r '...'` — one `jq` with all paths as args. Isolated jq aggregation on 10 files dropped from 1.99 s to 0.12 s (16×).
3. **Subagent enumeration via shell glob, not `find`.** Replacing `find subagents -name "*.jsonl" -print -quit` + `find ... -print0 | xargs -0 ls -t` with a `shopt -s nullglob` + `for f in subagents/*.jsonl` saved ~3 forks per widget refresh. Order within subagents doesn't matter to any consumer, so the mtime sort was wasted work.

### What was tried and didn't work

A **shared metrics cache file** (one `jq`+`awk` aggregation pass per refresh, written to `$TMPDIR`, sourced as bash env vars by widgets) was implemented and benchmarked. The premise — "each widget independently runs `jq` over JSONL, so cache the aggregation" — sounded right but turned out to be the wrong target on Windows:

- A single `jq` pass over a 2 MB JSONL is ~80 ms.
- The cache-hit machinery cost is `sha1sum` (~60 ms) + `stat × 2` (~70 ms) + `source` (~50 ms) = **~180 ms**.
- On Windows the cache is *more expensive than the work it skips*. Net regression: ~100 ms slower per widget; A/B over 10 runs went 3.77 s → 5.55 s.

The version that was committed (transcript_path + multi-file `jq` + glob subagents) is the right Windows fix and a no-op cost on macOS/Linux. If you ever want to push further, the next viable target is **caching the resolved `$JSONL`/`$JSONL_ALL` themselves** (so widgets 2–6 of one refresh skip the entire `claude-jsonl.sh` source), not caching aggregated metrics. Estimated additional saving ~1.5 s per refresh, but it was not pursued — diminishing returns after 1.73× and the cache-invalidation rules are non-trivial.

### How to reproduce a benchmark

```sh
# Build a frozen snapshot to avoid the live JSONL changing under your feet
cp ~/.claude/projects/<your-slug>/<session-id>.jsonl /tmp/snap.jsonl

# Then run all 7 widgets back to back via Node's execSync, the same way
# ccstatusline does. Measure total wall time for ~5 rounds and report mean.
```

Headline rule: **measure before optimizing**. The first attempt at speeding this up went after the wrong target precisely because intuition pointed at `jq`-on-JSONL, which on Windows turns out not to be the bottleneck.

## Setup

### 1. Scripts

```sh
cp claude-jsonl.sh cache-*.sh model-name.sh ~/.claude/
chmod +x ~/.claude/claude-jsonl.sh ~/.claude/cache-*.sh ~/.claude/model-name.sh
```

### 2. ccstatusline settings

```sh
cp ccstatusline-settings.json ~/.config/ccstatusline/settings.json
```

### 3. Claude Code statusLine

Keep Claude Code launching ccstatusline through `npx`, but prefer the local npm cache so status redraws do not block on a slow registry lookup:

```json
{
  "statusLine": {
    "type": "command",
    "command": "env npm_config_prefer_offline=true npm_config_fetch_timeout=1000 npm_config_fetch_retries=0 npx -y ccstatusline@latest",
    "padding": 0
  }
}
```

Or add widgets manually via the ccstatusline TUI — add a **Custom Command** for each:

```
bash -c "~/.claude/model-name.sh"
bash -c "~/.claude/cache-read.sh"
bash -c "~/.claude/cache-creation.sh"
bash -c "~/.claude/cache-input.sh"
bash -c "~/.claude/cache-savings.sh"
bash -c "~/.claude/cache-roi.sh"
bash -c "~/.claude/cache-recent.sh"
```

The `bash -c "…"` wrapper is required for cross-platform support: ccstatusline runs `commandPath` via Node's `execSync`, which on Windows uses `cmd.exe`. `cmd.exe` cannot execute `.sh` files or expand `~`. Wrapping the path in `bash -c` defers both to bash regardless of host shell, and is a no-op cost on macOS/Linux where `bash` is already in `PATH`.

Each custom-command widget also sets `"timeout": 5000`. ccstatusline's default per-widget timeout is 1000 ms, which is enough on macOS/Linux but not on Windows: process spawn there is ~10× slower, and the cache widgets fork bash → jq → awk against a multi-MB session JSONL. With the default the cache widgets would render as `[Timeout]`. 5000 ms is a comfortable ceiling — actual measured wall-time on Windows is ~1.0–1.1 s per widget.

### 4. Powerline caps for 4+ lines

ccstatusline's TUI only exposes caps settings for the first 3 lines. For Line 4, manually add a 4th entry to `startCaps` and `endCaps` in `~/.config/ccstatusline/settings.json` — the included settings file already handles this.

See [sirmalloc/ccstatusline#305](https://github.com/sirmalloc/ccstatusline/issues/305).

## How savings are calculated

```
effective_cost = 0.1 × cache_read + 1.25 × cache_creation + 1.0 × input  (per-model price)
baseline_cost  = cache_read + cache_creation + input                        (per-model price)
saved_usd      = baseline_cost − effective_cost
saved_pct      = (1 − effective_cost / baseline_cost) × 100
```

Pricing as of 2026-04-15, per 1M input tokens:

| Model | Price |
|-------|-------|
| Opus 4.6 | $5.00 |
| Sonnet 4.6 | $3.00 |
| Haiku 4.5 | $1.00 |

## Requirements

- [ccstatusline](https://github.com/sirmalloc/ccstatusline) ≥ 2.2.9 (earlier versions don't recognize the `xhigh` thinking effort and silently display "medium")
- `bash`, `jq`, `awk`, `sed`
  - macOS/Linux: pre-installed except possibly `jq` (`brew install jq` or `apt install jq`)
  - Windows: install [Git for Windows](https://git-scm.com/download/win) and `jq` (`scoop install jq` / `choco install jq`). After install, verify `bash` is reachable from `cmd.exe`:

    ```powershell
    where.exe bash
    ```

    If the output is empty, the Git for Windows installer was run with the default "Use Git Bash only" PATH option, which only puts `Git\cmd` on PATH (not `bash`). Pick one of:

    1. **Re-run the Git for Windows installer** and select "Git from the command line and also from 3rd-party software" in the PATH step.
    2. **Add `C:\Program Files\Git\bin` to `PATH`** manually (just `bin`, not `usr\bin` — the latter shadows several Windows builtins).
    3. **Hardcode the absolute path** in `commandPath` entries of `~/.config/ccstatusline/settings.json`, e.g. `"C:/Program Files/Git/bin/bash.exe" -c "~/.claude/cache-read.sh"`. This breaks portability of the settings file but avoids touching `PATH`.

## Related

- [nnaveenraju/claude-code-status-line#1](https://github.com/nnaveenraju/claude-code-status-line/pull/1) — upstream PR with these scripts
- [sirmalloc/ccstatusline#305](https://github.com/sirmalloc/ccstatusline/issues/305) — Powerline caps TUI support for 4+ lines
- [sirmalloc/ccstatusline#308](https://github.com/sirmalloc/ccstatusline/issues/308) — Pass terminalWidth in custom command stdin JSON
