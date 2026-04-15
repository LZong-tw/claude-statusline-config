# claude-statusline-config

Personal [ccstatusline](https://github.com/sirmalloc/ccstatusline) configuration and cache metrics scripts for Claude Code.

Inspired by [nnaveenraju/claude-code-status-line](https://github.com/nnaveenraju/claude-code-status-line) — same idea of reading session JSONL files, split into individual ccstatusline Custom Command widgets.

## Files

| File | Widget label | What it shows |
|------|-------------|---------------|
| `claude-jsonl.sh` | — | Shared helper: finds current project's session JSONL from stdin |
| `model-name.sh` | `Sonnet 4.6 1M` | Model name, trimmed |
| `cache-read.sh` | `RC: 58.4M (94%)` | `cache_read_input_tokens` + hit rate % |
| `cache-creation.sh` | `CC: 3.7M` | `cache_creation_input_tokens` |
| `cache-input.sh` | `UC: 534` | `input_tokens` (full-price, no cache) |
| `cache-savings.sh` | `S:$210.47 (84%)` | Actual USD saved + cost savings rate |
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

## Layout

```
Line 1: Tokens In · Tokens Out · Tokens Total · Thinking Effort
Line 2: Model (custom) · Version · Git Branch · Git Worktree · Git Changes
Line 3: Session Cost · Session Clock · Context % · T8 Recent
Line 4: RC · CC · UC · Saved · ROI
```

Theme: nord-aurora · Powerline enabled

## Design

- **Project-scoped**: reads `workspace.current_dir` from ccstatusline stdin to find the correct project's JSONL, not just the most recently modified file globally
- **Includes subagents**: aggregates token usage from the main session + all subagent JSONL files in the session's `subagents/` directory
- **Per-model pricing**: `cache-savings.sh` uses actual model prices (Opus=$5, Sonnet=$3, Haiku=$1 per 1M input) for accurate USD savings
- **Turn-level tracking**: `cache-recent.sh` groups API calls by user turn, so each dot represents an actual interaction rather than a single API call in a tool-use loop

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
~/.claude/model-name.sh
~/.claude/cache-read.sh
~/.claude/cache-creation.sh
~/.claude/cache-input.sh
~/.claude/cache-savings.sh
~/.claude/cache-roi.sh
~/.claude/cache-recent.sh
```

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

- [ccstatusline](https://github.com/sirmalloc/ccstatusline)
- `jq`
- `awk`, `sed` (pre-installed on macOS/Linux)

## Related

- [nnaveenraju/claude-code-status-line#1](https://github.com/nnaveenraju/claude-code-status-line/pull/1) — upstream PR with these scripts
- [sirmalloc/ccstatusline#305](https://github.com/sirmalloc/ccstatusline/issues/305) — Powerline caps TUI support for 4+ lines
