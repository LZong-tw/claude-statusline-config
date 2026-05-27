#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const settingsPath = path.join(root, 'ccstatusline-settings.json');
const fastScriptPath = path.join(root, 'statusline-fast.mjs');

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function commandPath(widget) {
  return typeof widget?.commandPath === 'string' ? widget.commandPath : '';
}

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

if (!fs.existsSync(fastScriptPath)) {
  fail('statusline-fast.mjs is missing');
}

if (!Array.isArray(settings.lines) || settings.lines.length !== 4) {
  fail('ccstatusline-settings.json must keep the original 4-line layout');
}

const [line1, line2, line3, line4] = settings.lines || [];
const expectedLine1 = ['tokens-input', 'tokens-output', 'tokens-total', 'thinking-effort'];
const expectedLine2 = ['model', 'version', 'git-branch', 'git-worktree', 'git-changes'];
const expectedLine3 = ['recent', 'session-cost', 'context-bar', 'session-clock'];
const expectedLine4 = ['read', 'savings', 'roi', 'creation', 'input'];

function assertTypes(line, expected, label) {
  const actual = line.map((widget) => {
    if (widget.type !== 'custom-command') return widget.type;
    const command = commandPath(widget);
    return expected.find((mode) => command.endsWith(` ${mode}`)) || 'custom-command';
  });

  if (actual.join('|') !== expected.join('|')) {
    fail(`${label} changed: expected ${expected.join(', ')}, got ${actual.join(', ')}`);
  }
}

assertTypes(line1, expectedLine1, 'Line 1');
assertTypes(line2, expectedLine2, 'Line 2');
assertTypes(line3, expectedLine3, 'Line 3');
assertTypes(line4, expectedLine4, 'Line 4');

const customCommands = settings.lines.flat()
  .filter((widget) => widget.type === 'custom-command')
  .map(commandPath);

for (const command of customCommands) {
  if (!command.includes('statusline-fast.mjs')) {
    fail(`custom command must use statusline-fast.mjs: ${command}`);
  }
  if (command.includes('bash -c')) {
    fail(`default Windows config must not use bash -c: ${command}`);
  }
}

if (settings.powerline?.startCaps?.length !== 4 || settings.powerline?.endCaps?.length !== 4) {
  fail('Powerline startCaps/endCaps must have 4 entries for the 4-line layout');
}

if (process.exitCode) process.exit(process.exitCode);
console.log('ccstatusline settings guard ok');
