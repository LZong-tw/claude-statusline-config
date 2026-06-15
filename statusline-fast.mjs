#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CACHE_VERSION = 7;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_FILES = 200;
const READ_CHUNK_BYTES = 1024 * 1024;
const USER_EVENT_RE = /"type"\s*:\s*"user"/;
const ASSISTANT_EVENT_RE = /"type"\s*:\s*"assistant"/;
const MODEL_RE = /"model"\s*:\s*"([^"]*)"/;
const CACHE_READ_RE = /"cache_read_input_tokens"\s*:\s*(\d+)/;
const CACHE_CREATION_RE = /"cache_creation_input_tokens"\s*:\s*(\d+)/;
const INPUT_RE = /"input_tokens"\s*:\s*(\d+)/;
const ENV_PRICE_OVERRIDE = readPositiveNumberEnv([
  'AIRCLAUDE_STATUSLINE_INPUT_PRICE_PER_MILLION',
  'CLAUDE_STATUSLINE_INPUT_PRICE_PER_MILLION',
]);
const ENV_PRICE_MAP = readPriceMapEnv([
  'AIRCLAUDE_STATUSLINE_PRICE_MAP_JSON',
  'CLAUDE_STATUSLINE_PRICE_MAP_JSON',
]);
const PRICE_CACHE_KEY = JSON.stringify({
  override: ENV_PRICE_OVERRIDE,
  map: ENV_PRICE_MAP,
});

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', () => resolve(raw));
  });
}

function parseJson(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function normalizeMaybeMsysPath(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  if (process.platform === 'win32') {
    const msys = value.match(/^\/([a-zA-Z])\/(.*)$/);
    if (msys) return `${msys[1].toUpperCase()}:\\${msys[2].replace(/\//g, '\\')}`;
  }
  return value;
}

function projectSlug(cwd) {
  return cwd.replace(/[/:\\]+/g, '-').replace(/^-+|-+$/g, '');
}

function newestJsonl(dir, recursive = false) {
  if (!fs.existsSync(dir)) return '';
  const entries = [];
  const visit = (current, depth) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive && depth < 2 && entry.name !== 'subagents') visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      try {
        entries.push({ file: full, mtimeMs: fs.statSync(full).mtimeMs });
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  };
  visit(dir, 0);
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries[0]?.file || '';
}

function resolveTranscript(payload) {
  const direct = normalizeMaybeMsysPath(payload.transcript_path || payload.transcriptPath || '');
  if (direct && fs.existsSync(direct)) return direct;

  const cwd = normalizeMaybeMsysPath(payload.workspace?.current_dir || payload.cwd || '');
  if (cwd) {
    const projectDir = path.join(os.homedir(), '.claude', 'projects', projectSlug(cwd));
    const found = newestJsonl(projectDir);
    if (found) return found;
  }

  return newestJsonl(path.join(os.homedir(), '.claude', 'projects'), true);
}

function subagentFilesFor(transcript) {
  const dir = path.dirname(transcript);
  const sessionId = path.basename(transcript, '.jsonl');
  const candidates = [
    path.join(dir, sessionId, 'subagents'),
    path.join(transcript.replace(/\.jsonl$/i, ''), 'subagents'),
  ];

  const files = [];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path.join(candidate, entry.name));
      }
    }
  }
  return files;
}

function cachePathFor(transcript) {
  const hash = crypto.createHash('sha1').update(transcript).digest('hex');
  return path.join(cacheDir(), `${hash}.json`);
}

function cacheDir() {
  return path.join(os.tmpdir(), 'ccstatusline-fast');
}

function pruneCacheDir() {
  const dir = cacheDir();
  if (!fs.existsSync(dir)) return;

  try {
    const now = Date.now();
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => {
        const file = path.join(dir, entry.name);
        const stat = fs.statSync(file);
        return { file, mtimeMs: stat.mtimeMs };
      });

    for (const entry of entries) {
      if (now - entry.mtimeMs > CACHE_MAX_AGE_MS) fs.rmSync(entry.file, { force: true });
    }

    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of entries.slice(CACHE_MAX_FILES)) {
      fs.rmSync(entry.file, { force: true });
    }
  } catch {
    // Cache pruning is opportunistic.
  }
}

function readCache(transcript) {
  try {
    const cache = JSON.parse(fs.readFileSync(cachePathFor(transcript), 'utf8'));
    return cache.version === CACHE_VERSION && cache.priceCacheKey === PRICE_CACHE_KEY ? cache : null;
  } catch {
    return null;
  }
}

function writeCache(transcript, cache) {
  try {
    const file = cachePathFor(transcript);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    pruneCacheDir();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, priceCacheKey: PRICE_CACHE_KEY, ...cache }));
    fs.renameSync(tmp, file);
  } catch {
    // Cache is best-effort; statusline output should never fail because of it.
  }
}

function compactNumber(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function readPositiveNumberEnv(names) {
  for (const name of names) {
    const value = Number(process.env[name]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function readPriceMapEnv(names) {
  for (const name of names) {
    const raw = process.env[name];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      return Object.entries(parsed)
        .map(([model, price]) => [String(model).toLowerCase(), Number(price)])
        .filter(([, price]) => Number.isFinite(price) && price > 0);
    } catch {
      // Ignore malformed optional pricing metadata.
    }
  }
  return [];
}

function priceForModel(model) {
  if (ENV_PRICE_OVERRIDE !== null) return ENV_PRICE_OVERRIDE;

  const lower = String(model || '').toLowerCase();
  for (const [needle, price] of ENV_PRICE_MAP) {
    if (needle && lower.includes(needle)) return price;
  }

  if (lower.includes('opus')) return 5;
  if (lower.includes('haiku')) return 1;
  return 3;
}

function emptyTotals() {
  return { read: 0, creation: 0, input: 0, baseline: 0, effective: 0 };
}

function emptyTurnState() {
  return {
    callCount: 0,
    callDots: '',
    inTurn: false,
    sawAssistant: false,
    turnCreation: 0,
    turnInput: 0,
    turnRead: 0,
    turns: [],
  };
}

function normalizeTotals(value) {
  return { ...emptyTotals(), ...(value || {}) };
}

function normalizeTurnState(value) {
  return { ...emptyTurnState(), ...(value || {}), turns: Array.isArray(value?.turns) ? value.turns : [] };
}

function isCacheHit(read, creation, input) {
  const total = read + creation + input;
  return total > 0 && read / total > 0.5;
}

function trimTurns(state) {
  if (state.turns.length > 8) state.turns = state.turns.slice(-8);
}

function flushTurn(state) {
  if (!state.inTurn) return;
  const total = state.turnRead + state.turnCreation + state.turnInput;
  state.turns.push({
    hit: total > 0 ? isCacheHit(state.turnRead, state.turnCreation, state.turnInput) : null,
    calls: state.callDots + (state.callCount > 10 ? '+' : ''),
  });
  trimTurns(state);
  state.turnRead = 0;
  state.turnCreation = 0;
  state.turnInput = 0;
  state.callDots = '';
  state.callCount = 0;
  state.inTurn = false;
}

function consumeMainTurn(event, state) {
  if (event.type === 'user') {
    if (state.sawAssistant || !state.inTurn) flushTurn(state);
    state.inTurn = true;
    state.sawAssistant = false;
    return;
  }

  if (event.type !== 'assistant' || !state.inTurn) return;
  const usage = event.message?.usage || {};
  const read = Number(usage.cache_read_input_tokens || 0);
  const creation = Number(usage.cache_creation_input_tokens || 0);
  const input = Number(usage.input_tokens || 0);
  state.sawAssistant = true;
  state.turnRead += read;
  state.turnCreation += creation;
  state.turnInput += input;
  state.callCount += 1;
  if (state.callCount <= 10) {
    state.callDots += isCacheHit(read, creation, input) ? '■' : '□';
  }
}

function consumeAssistantUsage(event, totals) {
  if (event.type !== 'assistant') return;
  const usage = event.message?.usage || {};
  const read = Number(usage.cache_read_input_tokens || 0);
  const creation = Number(usage.cache_creation_input_tokens || 0);
  const input = Number(usage.input_tokens || 0);
  const price = priceForModel(event.message?.model);

  totals.read += read;
  totals.creation += creation;
  totals.input += input;
  totals.baseline += ((read + creation + input) * price) / 1_000_000;
  totals.effective += ((0.1 * read + 1.25 * creation + input) * price) / 1_000_000;
}

function numberFromLine(line, pattern) {
  const match = line.match(pattern);
  return match ? Number(match[1]) : 0;
}

function stringFromLine(line, pattern) {
  const match = line.match(pattern);
  return match ? match[1] : '';
}

function eventTypeFromLine(line) {
  let userIndex = line.lastIndexOf('"type":"user"');
  let assistantIndex = line.lastIndexOf('"type":"assistant"');

  if (userIndex === -1 && USER_EVENT_RE.test(line)) userIndex = line.search(USER_EVENT_RE);
  if (assistantIndex === -1 && ASSISTANT_EVENT_RE.test(line)) assistantIndex = line.search(ASSISTANT_EVENT_RE);

  if (assistantIndex > userIndex) return 'assistant';
  if (userIndex > assistantIndex) return 'user';
  return '';
}

function eventFromLine(line) {
  const type = eventTypeFromLine(line);
  if (type === 'user') return { type };
  if (type !== 'assistant') return null;

  return {
    type,
    message: {
      model: stringFromLine(line, MODEL_RE),
      usage: {
        cache_read_input_tokens: numberFromLine(line, CACHE_READ_RE),
        cache_creation_input_tokens: numberFromLine(line, CACHE_CREATION_RE),
        input_tokens: numberFromLine(line, INPUT_RE),
      },
    },
  };
}

function parseJsonlBuffer(buffer, onEvent) {
  const lastNewline = buffer.lastIndexOf(10);
  if (lastNewline === -1) return 0;

  const content = buffer.subarray(0, lastNewline + 1).toString('utf8');
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    const event = eventFromLine(line);
    if (event) onEvent(event);
  }
  return lastNewline + 1;
}

function parseFileTail(file, offset, size, onEvent) {
  const length = size - offset;
  if (length <= 0) return 0;

  const fd = fs.openSync(file, 'r');
  const scratch = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, length));
  let consumed = 0;
  let pending = Buffer.alloc(0);
  let position = offset;

  try {
    while (position < size) {
      const bytesToRead = Math.min(scratch.length, size - position);
      const bytesRead = fs.readSync(fd, scratch, 0, bytesToRead, position);
      if (bytesRead <= 0) break;

      position += bytesRead;
      const chunk = scratch.subarray(0, bytesRead);
      const combined = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
      const lastNewline = combined.lastIndexOf(10);
      if (lastNewline === -1) {
        pending = Buffer.from(combined);
        continue;
      }

      parseJsonlBuffer(combined.subarray(0, lastNewline + 1), onEvent);
      pending = Buffer.from(combined.subarray(lastNewline + 1));
      consumed = position - offset - pending.length;
    }
  } finally {
    fs.closeSync(fd);
  }

  return consumed;
}

function shouldReuseFileState(previous, stat) {
  return previous?.size === stat.size && previous?.mtimeMs === stat.mtimeMs;
}

function canAppendToFileState(previous, stat) {
  return previous
    && Number.isFinite(previous.offset)
    && previous.offset <= stat.size
    && previous.size <= stat.size;
}

function updateFileState(file, previous, trackTurns) {
  const stat = fs.statSync(file);
  if (shouldReuseFileState(previous, stat)) return previous;

  const incremental = canAppendToFileState(previous, stat);
  const offset = incremental ? previous.offset : 0;
  const totals = incremental ? normalizeTotals(previous.totals) : emptyTotals();
  const turnState = trackTurns
    ? incremental ? normalizeTurnState(previous.turnState) : emptyTurnState()
    : null;

  const consumed = parseFileTail(file, offset, stat.size, (event) => {
    consumeAssistantUsage(event, totals);
    if (trackTurns) consumeMainTurn(event, turnState);
  });

  return {
    file,
    mtimeMs: stat.mtimeMs,
    offset: offset + consumed,
    size: stat.size,
    totals,
    ...(trackTurns ? { turnState } : {}),
  };
}

function displayTurns(turnState) {
  const copy = normalizeTurnState(JSON.parse(JSON.stringify(turnState || emptyTurnState())));
  flushTurn(copy);
  return copy.turns;
}

function buildRecent(turnState) {
  const visible = displayTurns(turnState);
  const dots = visible.map((turn) => {
    if (turn.hit === null) return '◌';
    return turn.hit ? '●' : '○';
  }).join('');

  let breakdown = visible.map((turn) => turn.calls || '⏳');
  let symbols = breakdown.reduce((sum, value) => sum + [...value].length, 0);
  while (symbols > 24 && breakdown.length > 1) {
    const removed = breakdown.shift();
    symbols -= [...removed].length;
    breakdown[0] = `…│${breakdown[0]}`;
  }

  return `T8:${dots} ${breakdown.join('│')}`;
}

function cacheStats(totals) {
  const totalTokens = totals.read + totals.creation + totals.input;
  const readRate = totalTokens > 0 ? (totals.read * 100) / totalTokens : 0;
  const saved = totals.baseline - totals.effective;
  const savedPct = totals.baseline > 0 ? (1 - totals.effective / totals.baseline) * 100 : 0;
  const roi = totals.creation > 0 ? totals.read / totals.creation : 0;

  return { readRate, roi, saved, savedPct };
}

function formatMetric(mode, totals, turnState) {
  const { readRate, roi, saved, savedPct } = cacheStats(totals);

  switch (mode) {
    case 'recent':
      return buildRecent(turnState);
    case 'read':
      return `ReadCache:${compactNumber(totals.read)} (${Math.round(readRate)}%)`;
    case 'savings':
      return `Saved≈$${saved.toFixed(2)} (${Math.round(savedPct)}%)`;
    case 'roi':
      return `ROI:${roi.toFixed(1)}x`;
    case 'creation':
      return `CacheCreate:${compactNumber(totals.creation)}`;
    case 'input':
      return `Uncached:${compactNumber(totals.input)}`;
    default:
      return buildRecent(turnState);
  }
}

function computeMetrics(transcript) {
  const files = [transcript, ...subagentFilesFor(transcript)];
  const previous = readCache(transcript);
  const previousFiles = previous?.files || {};
  const nextFiles = {};

  files.forEach((file, index) => {
    nextFiles[file] = updateFileState(file, previousFiles[file], index === 0);
  });

  const totals = emptyTotals();
  for (const state of Object.values(nextFiles)) {
    const fileTotals = normalizeTotals(state.totals);
    totals.read += fileTotals.read;
    totals.creation += fileTotals.creation;
    totals.input += fileTotals.input;
    totals.baseline += fileTotals.baseline;
    totals.effective += fileTotals.effective;
  }

  const turnState = nextFiles[transcript]?.turnState;
  writeCache(transcript, { files: nextFiles });
  return { totals, turnState };
}

function formatModel(payload) {
  let name = process.env.AIRCLAUDE_STATUSLINE_LABEL
    || payload.model?.display_name
    || payload.model?.displayName
    || payload.model
    || '';
  if (typeof name !== 'string') return '';
  name = name.replace(/^Claude\s+/, '');
  name = name.replace(/ \((\d+[KM]) context\)/, ' $1');
  name = name.replace(/ \([^)]*context\)/, '');
  return name;
}

const raw = await readStdin();
const payload = parseJson(raw);
const mode = process.argv[2] || 'recent';

if (mode === 'model') {
  const model = formatModel(payload);
  if (model) process.stdout.write(`${model}\n`);
  process.exit(0);
}

const transcript = resolveTranscript(payload);
if (!transcript) process.exit(0);

if (mode === 'source') {
  const files = [transcript, ...subagentFilesFor(transcript)];
  process.stdout.write(`Source:${transcript} files:${files.length}\n`);
  process.exit(0);
}

const { totals, turnState } = computeMetrics(transcript);
process.stdout.write(`${formatMetric(mode, totals, turnState)}\n`);
