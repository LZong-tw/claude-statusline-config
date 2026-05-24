'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REMIND_AFTER_DAYS = 14;

async function main() {
  process.stdin.resume();

  let pkgDir;
  try {
    const root = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: true,
    }).trim();
    pkgDir = path.join(root, 'ccstatusline');
  } catch {
    return;
  }

  const pkgJson = path.join(pkgDir, 'package.json');
  try {
    const stat = fs.statSync(pkgJson);
    const ageDays = Math.floor((Date.now() - stat.mtimeMs) / 86400000);
    if (ageDays >= REMIND_AFTER_DAYS) {
      process.stdout.write(JSON.stringify({
        additionalContext:
          `[reminder] ccstatusline was installed ${ageDays} days ago. ` +
          `Update: npm i -g ccstatusline@latest`,
      }));
    }
  } catch {
    // Not installed or cannot stat; no reminder needed.
  }
}

main();
