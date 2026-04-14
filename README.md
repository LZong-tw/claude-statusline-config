# claude-statusline-config

Personal [ccstatusline](https://github.com/sirmalloc/ccstatusline) configuration and cache metrics scripts for Claude Code.

## What's in here

| File | Purpose |
|------|---------|
| `cache-read.sh` | ReadCache widget — cumulative `cache_read_input_tokens` + hit rate % |
| `cache-creation.sh` | CacheCreate widget — cumulative `cache_creation_input_tokens` |
| `cache-input.sh` | Uncached widget — cumulative `input_tokens` (full-price, no cache) |
| `ccstatusline-settings.json` | ccstatusline layout config (4-line Powerline with nord-aurora theme) |

## Layout

```
Line 1: Model · Git Branch · Git Worktree · Git Changes
Line 2: Tokens In · Tokens Out · Tokens Total · Thinking Effort
Line 3: ReadCache (hit%) · CacheCreate · Uncached · Version
Line 4: Session Cost · Session Clock · Context Bar
```

## Setup

### Scripts

```sh
cp cache-*.sh ~/.claude/
chmod +x ~/.claude/cache-*.sh
```

In ccstatusline TUI, add three **Custom Command** widgets:

```
~/.claude/cache-read.sh
~/.claude/cache-creation.sh
~/.claude/cache-input.sh
```

### Settings

```sh
cp ccstatusline-settings.json ~/.config/ccstatusline/settings.json
```

## Requirements

- [ccstatusline](https://github.com/sirmalloc/ccstatusline)
- `jq`

## Credits

Cache metrics approach derived from [nnaveenraju/claude-code-status-line](https://github.com/nnaveenraju/claude-code-status-line). See [PR #1](https://github.com/nnaveenraju/claude-code-status-line/pull/1) for the upstream contribution.

## Related

- [sirmalloc/ccstatusline#305](https://github.com/sirmalloc/ccstatusline/issues/305) — TUI should support Powerline caps for 4+ lines
