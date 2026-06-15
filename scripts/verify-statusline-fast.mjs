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

assertCachedWrapperSurvivesScrubbedHome();

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-fast-fixture-'));
const transcript = path.join(fixtureDir, 'session.jsonl');

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
