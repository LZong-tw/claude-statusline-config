#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const renderer = path.join(root, 'statusline-fast.mjs');

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function renderModel(payload, env = {}) {
  return spawnSync(process.execPath, [renderer, 'model'], {
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

if (process.exitCode) process.exit(process.exitCode);
console.log('statusline-fast guard ok');
