# claude-statusline-config

Personal [ccstatusline](https://github.com/sirmalloc/ccstatusline) configuration and cache metrics scripts for Claude Code.

Inspired by [nnaveenraju/claude-code-status-line](https://github.com/nnaveenraju/claude-code-status-line) — same idea of reading session JSONL files, split into individual ccstatusline Custom Command widgets.

## Files

| File | Widget label | What it shows |
|------|-------------|---------------|
| `cache-read.sh` | `ReadCache: 18.9M (91%)` | `cache_read_input_tokens` + hit rate % |
| `cache-creation.sh` | `CacheCreate: 2.0M` | `cache_creation_input_tokens` |
| `cache-input.sh` | `Uncached: 234` | `input_tokens` (full-price, no cache) |
| `cache-savings.sh` | `Saved: $159.87 (85%)` | Actual USD saved + cost savings rate |
| `cache-roi.sh` | `ROI: 17.4x` | `cache_read / cache_creation` ratio |
| `cache-recent.sh` | `L5: ●●●●○` | Last 5 requests: ● = cache hit, ○ = miss |
| `ccstatusline-settings.json` | — | ccstatusline 4-line Powerline layout |

## Layout

```
Line 1: Tokens In · Tokens Out · Tokens Total · Thinking Effort
Line 2: Model · Version · Git Branch · Git Worktree · Git Changes
Line 3: Session Cost · Session Clock · Context Bar · L5 Recent
Line 4: ReadCache · CacheCreate · Uncached · Saved · ROI
```

Theme: nord-aurora · Powerline enabled

## Setup

### 1. Scripts

```sh
cp cache-*.sh ~/.claude/
chmod +x ~/.claude/cache-*.sh
```

### 2. ccstatusline settings

```sh
cp ccstatusline-settings.json ~/.config/ccstatusline/settings.json
```

Or add the 5 cache widgets manually via the ccstatusline TUI — add a **Custom Command** widget for each:

```
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

Pricing per 1M input tokens: Opus 4.6 = $5 · Sonnet 4.6 = $3 · Haiku 4.5 = $1

## Requirements

- [ccstatusline](https://github.com/sirmalloc/ccstatusline)
- `jq`
- `awk`, `bc` (pre-installed on macOS/Linux)

## Related

- [nnaveenraju/claude-code-status-line#1](https://github.com/nnaveenraju/claude-code-status-line/pull/1) — upstream PR with these scripts
- [sirmalloc/ccstatusline#305](https://github.com/sirmalloc/ccstatusline/issues/305) — Powerline caps TUI support for 4+ lines
