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

- **Project-scoped**: reads `workspace.current_dir` from ccstatusline stdin to find the correct project's JSONL, walking up parent directories when Claude runs from a repo subdirectory. It only falls back to the globally newest session when no parent project directory matches
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
- **Cache widgets re-scan JSONL each refresh**: each of the 5 cache widgets independently runs jq across the full session JSONL on every statusline refresh. Per-widget timeout is 5000 ms; under degenerate conditions (50 MB+ session JSONL, slow disk, high CPU contention) widgets can still time out. A bounded fix would parse JSONL once per refresh into a shared cache file and have widgets read pre-computed metrics, but that's a non-trivial refactor.

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

### 3. Powerline caps for 4+ lines

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
