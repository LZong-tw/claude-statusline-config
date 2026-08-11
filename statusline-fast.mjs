#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CACHE_VERSION = 8;
const MEM_CACHE_VERSION = 2;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_FILES = 200;
const READ_CHUNK_BYTES = 1024 * 1024;
const USER_EVENT_RE = /"type"\s*:\s*"user"/;
const ASSISTANT_EVENT_RE = /"type"\s*:\s*"assistant"/;
const MODEL_RE = /"model"\s*:\s*"([^"]*)"/;
const CACHE_READ_RE = /"cache_read_input_tokens"\s*:\s*(\d+)/;
const CACHE_CREATION_RE = /"cache_creation_input_tokens"\s*:\s*(\d+)/;
const INPUT_RE = /"input_tokens"\s*:\s*(\d+)/;
const OUTPUT_RE = /"output_tokens"\s*:\s*(\d+)/;
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
        .map(([model, value]) => [String(model).toLowerCase(), normalizePricing(value)])
        .filter(([, pricing]) => pricing !== null);
    } catch {
      // Ignore malformed optional pricing metadata.
    }
  }
  return [];
}

function normalizePricing(value, known = true) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? { input: value, known } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const input = Number(value.input ?? value.inputCacheMiss);
  if (!Number.isFinite(input) || input <= 0) return null;

  const pricing = { input, known };
  for (const key of ['inputCacheHit', 'inputCacheMiss', 'output']) {
    const number = Number(value[key]);
    if (Number.isFinite(number) && number > 0) pricing[key] = number;
  }
  return pricing;
}

function pricingForModel(model) {
  if (ENV_PRICE_OVERRIDE !== null) return normalizePricing(ENV_PRICE_OVERRIDE);

  const lower = String(model || '').toLowerCase();
  for (const [needle, pricing] of ENV_PRICE_MAP) {
    if (needle && lower.includes(needle)) return pricing;
  }

  if (lower.includes('opus')) return normalizePricing(5, false);
  if (lower.includes('haiku')) return normalizePricing(1, false);
  return normalizePricing(3, false);
}

function priceForModel(model) {
  return pricingForModel(model).input;
}

function emptyTotals() {
  return { read: 0, creation: 0, input: 0, baseline: 0, effective: 0, cost: 0, costKnown: true };
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
  const output = Number(usage.output_tokens || 0);
  const price = priceForModel(event.message?.model);

  totals.read += read;
  totals.creation += creation;
  totals.input += input;
  totals.baseline += ((read + creation + input) * price) / 1_000_000;
  totals.effective += ((0.1 * read + 1.25 * creation + input) * price) / 1_000_000;

  const pricing = pricingForModel(event.message?.model);
  const cost = pricing.known && Number.isFinite(pricing.output)
    ? (input * pricing.input
      + read * (pricing.inputCacheHit ?? pricing.input)
      + creation * (pricing.inputCacheMiss ?? pricing.input)
      + output * pricing.output) / 1_000_000
    : null;
  if (cost === null) totals.costKnown = false;
  else if (totals.costKnown) totals.cost += cost;
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
        output_tokens: numberFromLine(line, OUTPUT_RE),
      },
    },
    isSidechain: /"isSidechain"\s*:\s*true/.test(line),
    isApiErrorMessage: /"isApiErrorMessage"\s*:\s*true/.test(line),
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
  let latestUsage = trackTurns && incremental ? previous.latestUsage ?? null : null;

  const consumed = parseFileTail(file, offset, stat.size, (event) => {
    consumeAssistantUsage(event, totals);
    if (trackTurns) consumeMainTurn(event, turnState);
    if (trackTurns && event.type === 'assistant' && !event.isSidechain && !event.isApiErrorMessage) {
      latestUsage = event.message;
    }
  });

  return {
    file,
    mtimeMs: stat.mtimeMs,
    offset: offset + consumed,
    size: stat.size,
    totals,
    ...(trackTurns ? { turnState, latestUsage } : {}),
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

const MEM_CACHE_FILE = path.join(os.tmpdir(), 'ccstatusline-fast-memcache.json');

function readMemCache(transcript) {
  try {
    const stat = fs.statSync(MEM_CACHE_FILE);
    if (Date.now() - stat.mtimeMs < 2000) {
      const data = JSON.parse(fs.readFileSync(MEM_CACHE_FILE, 'utf8'));
      if (data.version === MEM_CACHE_VERSION
        && data.priceCacheKey === PRICE_CACHE_KEY
        && data.transcript === transcript) {
        return data.result;
      }
    }
  } catch {}
  return null;
}

function writeMemCache(transcript, result) {
  try {
    fs.writeFileSync(MEM_CACHE_FILE, JSON.stringify({
      version: MEM_CACHE_VERSION,
      priceCacheKey: PRICE_CACHE_KEY,
      transcript,
      result,
    }));
  } catch {}
}

function computeMetrics(transcript) {
  const cached = readMemCache(transcript);
  if (cached) return cached;

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
    totals.cost += fileTotals.cost;
    totals.costKnown = totals.costKnown && fileTotals.costKnown !== false;
  }

  const turnState = nextFiles[transcript]?.turnState;
  const mainState = nextFiles[transcript];
  writeCache(transcript, { files: nextFiles });
  const result = {
    totals,
    turnState,
    mainTotals: normalizeTotals(mainState?.totals),
    latestUsage: mainState?.latestUsage ?? null,
  };
  writeMemCache(transcript, result);
  return result;
}

function positiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

function enrichPayload(payload, transcript) {
  const metrics = computeMetrics(transcript);
  const usage = metrics.latestUsage?.usage;
  if (!usage || typeof usage !== 'object') return payload;

  const next = { ...payload };
  const existingContext = payload.context_window && typeof payload.context_window === 'object'
    ? payload.context_window
    : {};
  const contextWindowSize = positiveNumber(
    existingContext.context_window_size ?? process.env.AIRCLAUDE_STATUSLINE_CONTEXT_WINDOW,
  );
  const currentUsage = {
    input_tokens: positiveNumber(usage.input_tokens) ?? 0,
    output_tokens: positiveNumber(usage.output_tokens) ?? 0,
    cache_creation_input_tokens: positiveNumber(usage.cache_creation_input_tokens) ?? 0,
    cache_read_input_tokens: positiveNumber(usage.cache_read_input_tokens) ?? 0,
  };
  const currentUsageTotal = Object.values(currentUsage).reduce((sum, value) => sum + value, 0);
  const existingUsage = existingContext.current_usage;
  const existingUsageTotal = typeof existingUsage === 'number'
    ? existingUsage
    : existingUsage && typeof existingUsage === 'object'
      ? Object.values(existingUsage).reduce((sum, value) => sum + (positiveNumber(value) ?? 0), 0)
      : 0;

  if (contextWindowSize !== null && currentUsageTotal > 0 && existingUsageTotal === 0) {
    next.context_window = {
      ...existingContext,
      context_window_size: contextWindowSize,
      current_usage: currentUsage,
    };
  }

  const existingCost = payload.cost && typeof payload.cost === 'object' ? payload.cost : {};
  if (metrics.mainTotals.costKnown && !Number.isFinite(Number(existingCost.total_cost_usd))) {
    next.cost = { ...existingCost, total_cost_usd: metrics.mainTotals.cost };
  }
  return next;
}

function payloadModelId(payload) {
  const model = payload?.model;
  if (typeof model === 'string') return model;
  return model?.id
    || model?.model
    || model?.name
    || model?.display_name
    || model?.displayName
    || '';
}

function decodeCcrCompatibilityModel(model) {
  const match = String(model || '').trim().match(/^claude-ccr-h([0-9a-f]+)(?:\[1m\])?$/i);
  if (!match || match[1].length % 2 !== 0) return '';
  const decoded = Buffer.from(match[1], 'hex').toString('utf8');
  return /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(decoded) ? decoded : '';
}

function airclaudeModeFromCacheDir() {
  const cacheDir = String(process.env.CLAUDE_STATUSLINE_CACHE_DIR || '');
  const match = cacheDir.match(/[\\/]+airclaude[\\/]+[^\\/]+[\\/]+([^\\/]+)$/);
  return match?.[1] || '';
}

function formatModel(payload) {
  const payloadId = payloadModelId(payload);
  const compatibilityModel = decodeCcrCompatibilityModel(payloadId);
  const cachedMode = airclaudeModeFromCacheDir();
  let name = process.env.AIRCLAUDE_STATUSLINE_LABEL
    || (compatibilityModel && cachedMode
      ? `airclaude ${cachedMode} ${compatibilityModel.slice(compatibilityModel.lastIndexOf('/') + 1)}`
      : '')
    || payload.model?.display_name
    || payload.model?.displayName
    || payloadId
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

if (mode === 'enrich') {
  process.stdout.write(`${JSON.stringify(enrichPayload(payload, transcript))}\n`);
  process.exit(0);
}

if (mode === 'source') {
  const files = [transcript, ...subagentFilesFor(transcript)];
  process.stdout.write(`Source:${transcript} files:${files.length}\n`);
  process.exit(0);
}

const { totals, turnState } = computeMetrics(transcript);
process.stdout.write(`${formatMetric(mode, totals, turnState)}\n`);
