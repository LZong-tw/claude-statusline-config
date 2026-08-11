#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const renderer = path.join(root, 'statusline-fast.mjs');
const cachedWrapper = path.join(root, 'statusline-cached.sh');

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function renderModel(payload, env = {}) {
  return render('model', payload, env);
}

function render(mode, payload, env = {}) {
  return spawnSync(process.execPath, [renderer, mode], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function assertModel(label, payload, env, expected) {
  const result = renderModel(payload, env);
  if (result.status !== 0) {
    fail(`${label}: renderer exited with ${result.status}\n${result.stderr}`);
    return;
  }

  const actual = result.stdout.trim();
  if (actual !== expected) {
    fail(`${label}: expected "${expected}", got "${actual}"`);
  }
}

function assertMetric(label, mode, payload, env, expected) {
  const result = render(mode, payload, env);
  if (result.status !== 0) {
    fail(`${label}: renderer exited with ${result.status}\n${result.stderr}`);
    return;
  }

  const actual = result.stdout.trim();
  if (actual !== expected) {
    fail(`${label}: expected "${expected}", got "${actual}"`);
  }
}

function assertCachedWrapperSurvivesScrubbedHome() {
  const fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-home-'));
  const fixtureClaudeDir = path.join(fixtureHome, '.claude');
  const fixtureBin = path.join(fixtureHome, 'fake-ccstatusline.sh');
  const fixtureWrapper = path.join(fixtureClaudeDir, 'statusline-cached.sh');

  try {
    fs.mkdirSync(fixtureClaudeDir, { recursive: true });
    fs.copyFileSync(cachedWrapper, fixtureWrapper);
    fs.chmodSync(fixtureWrapper, 0o755);
    fs.writeFileSync(
      fixtureBin,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        '[[ -n "${HOME:-}" ]]',
        'cat >/dev/null',
        'printf "ok:%s\\n" "$HOME"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    const result = spawnSync(fixtureWrapper, {
      input: JSON.stringify({ cwd: root }),
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        CCSTATUSLINE_BIN: fixtureBin,
      },
    });

    if (result.status !== 0) {
      fail(`cached wrapper without HOME exited with ${result.status}\n${result.stderr}`);
      return;
    }

    const actual = result.stdout.trim();
    const expected = `ok:${fs.realpathSync(fixtureHome)}`;
    if (actual !== expected) {
      fail(`cached wrapper without HOME: expected "${expected}", got "${actual}"`);
    }
  } finally {
    fs.rmSync(fixtureHome, { recursive: true, force: true });
  }
}

assertModel(
  'AirClaude statusline label overrides Claude payload model name',
  { model: { display_name: 'Claude Fable 5' } },
  { AIRCLAUDE_STATUSLINE_LABEL: 'airclaude auto deepseek-v3.2' },
  'airclaude auto deepseek-v3.2',
);

assertModel(
  'Claude payload model name remains the fallback',
  { model: { display_name: 'Claude Sonnet 4.6 (1M context)' } },
  { AIRCLAUDE_STATUSLINE_LABEL: '' },
  'Sonnet 4.6 1M',
);

assertModel(
  'CCR compatibility model IDs render their decoded AirClaude route model',
  { model: { id: 'claude-ccr-h6169726b69742d70726f76696465722d7765622d6c6974656c6c6d2d616e7468726f7069632f636c617564652d6f7075732d35[1m]' } },
  { AIRCLAUDE_STATUSLINE_LABEL: '', CLAUDE_STATUSLINE_CACHE_DIR: '/tmp/.claude/cache/airclaude/oneportal-lowcost/web' },
  'airclaude web claude-opus-5',
);

assertModel(
  'CCR compatibility model IDs preserve the decoded Sonnet model too',
  { model: { id: 'claude-ccr-h6f6e65706f7274616c2d616e7468726f7069632f636c617564652d736f6e6e65742d35[1m]' } },
  { AIRCLAUDE_STATUSLINE_LABEL: '', CLAUDE_STATUSLINE_CACHE_DIR: '/tmp/.claude/cache/airclaude/oneportal-lowcost/plain' },
  'airclaude plain claude-sonnet-5',
);

assertCachedWrapperSurvivesScrubbedHome();

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-fast-fixture-'));
const transcript = path.join(fixtureDir, 'session.jsonl');
const enrichTranscript = path.join(fixtureDir, 'enrich-session.jsonl');
const modelTranscript = path.join(fixtureDir, 'model-session.jsonl');

try {
  fs.writeFileSync(
    transcript,
    [
      JSON.stringify({ type: 'user' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'example-cheap-model',
          usage: {
            cache_read_input_tokens: 1_000_000,
            cache_creation_input_tokens: 0,
            input_tokens: 0,
          },
        },
      }),
      '',
    ].join('\n'),
  );

  fs.writeFileSync(
    enrichTranscript,
    [
      JSON.stringify({ type: 'user' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'Kimi-K3',
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            cache_read_input_tokens: 900,
            cache_creation_input_tokens: 0,
          },
        },
      }),
      '',
    ].join('\n'),
  );

  fs.writeFileSync(
    modelTranscript,
    `${JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-opus-5', usage: { input_tokens: 1 } },
    })}\n`,
  );

  assertModel(
    'latest main transcript model wins after Claude Code /model changes',
    { transcript_path: modelTranscript, model: { display_name: 'Claude Sonnet 5' } },
    { AIRCLAUDE_STATUSLINE_LABEL: 'airclaude web claude-sonnet-5', CLAUDE_STATUSLINE_CACHE_DIR: '/tmp/.claude/cache/airclaude/oneportal-lowcost/web' },
    'airclaude web claude-opus-5',
  );

  const enriched = render('enrich', { transcript_path: enrichTranscript }, {
    AIRCLAUDE_STATUSLINE_CONTEXT_WINDOW: '1000000',
    AIRCLAUDE_STATUSLINE_PRICE_MAP_JSON: JSON.stringify({
      'Kimi-K3': { input: 3, inputCacheHit: 0.3, output: 15 },
    }),
  });
  if (enriched.status !== 0) {
    fail(`statusline payload enrichment exited with ${enriched.status}\n${enriched.stderr}`);
  } else {
    const payload = JSON.parse(enriched.stdout);
    if (payload.context_window?.context_window_size !== 1_000_000) {
      fail(`statusline payload enrichment: expected 1M context window, got ${JSON.stringify(payload.context_window)}`);
    }
    if (payload.context_window?.current_usage?.input_tokens !== 100
      || payload.context_window?.current_usage?.cache_read_input_tokens !== 900
      || payload.context_window?.current_usage?.output_tokens !== 10) {
      fail(`statusline payload enrichment: missing current Kimi usage ${JSON.stringify(payload.context_window)}`);
    }
    if (payload.cost?.total_cost_usd !== 0.00072) {
      fail(`statusline payload enrichment: expected Kimi cost 0.00072, got ${JSON.stringify(payload.cost)}`);
    }
  }

  assertMetric(
    'statusline pricing can be overridden by route metadata',
    'savings',
    { transcript_path: transcript },
    { AIRCLAUDE_STATUSLINE_INPUT_PRICE_PER_MILLION: '0.28' },
    'Saved≈$0.25 (90%)',
  );

  assertMetric(
    'statusline source mode reports the resolved transcript',
    'source',
    { transcript_path: transcript },
    {},
    `Source:${transcript} files:1`,
  );
} finally {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
}

if (process.exitCode) process.exit(process.exitCode);
console.log('statusline-fast guard ok');
