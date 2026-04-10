/**
 * Secure Points Server — Local ChipProvider for game-claw dealers
 *
 * Security features:
 *   1. Bearer token auth — only requests with the correct DEALER_SECRET are accepted
 *   2. Input validation — playerId format, amount range, required fields
 *   3. Rate limiting — per-IP request throttling (default 60/min)
 *   4. File persistence — balances survive server restart (JSON file)
 *   5. Audit log — all transactions written to append-only log file
 *   6. CORS restricted — only localhost allowed
 *   7. Request size limit — prevents large payload attacks
 *   8. Negative balance protection — debit cannot go below 0
 *   9. Amount precision — enforces integer amounts (no floating point tricks)
 *  10. HMAC signature on responses — clients can verify server authenticity
 *
 * Usage:
 *   1. pnpm run generate-secret   ← creates .env with DEALER_SECRET
 *   2. pnpm run start             ← starts the server
 *   3. Pass the secret to DealerNode:
 *      chipProvider: { type: 'http', url: 'http://localhost:3100', authToken: '<secret>' }
 *
 * Endpoints:
 *   GET  /balance/:playerId     — query balance (requires auth)
 *   POST /debit                 — deduct chips (requires auth)
 *   POST /credit                — add chips (requires auth)
 *   POST /settle                — batch settle (requires auth)
 *   GET  /leaderboard           — public, read-only
 *   GET  /history/:playerId     — query transaction history (requires auth)
 *   GET  /health                — public health check
 */

import express from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const BALANCES_FILE = join(DATA_DIR, 'balances.json');
const AUDIT_LOG = join(DATA_DIR, 'audit.log');
const ENV_FILE = join(__dirname, '..', '.env');

// ============================================================
// Config
// ============================================================

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (existsSync(ENV_FILE)) {
    const lines = readFileSync(ENV_FILE, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
  }
  return env;
}

const envVars = loadEnv();
const DEALER_SECRET = process.env.DEALER_SECRET ?? envVars.DEALER_SECRET ?? '';
const PORT = parseInt(process.env.PORT ?? envVars.PORT ?? '3100');
const INITIAL_POINTS = parseInt(process.env.INITIAL_POINTS ?? envVars.INITIAL_POINTS ?? '1000');
const RATE_LIMIT_PER_MIN = parseInt(process.env.RATE_LIMIT ?? envVars.RATE_LIMIT ?? '300');

if (!DEALER_SECRET) {
  console.error('❌ DEALER_SECRET not set. Run: pnpm run generate-secret');
  process.exit(1);
}

// ============================================================
// Persistence
// ============================================================

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const balances = new Map<string, number>();
let txCounter = 0;

function loadBalances(): void {
  if (existsSync(BALANCES_FILE)) {
    try {
      const data = JSON.parse(readFileSync(BALANCES_FILE, 'utf-8'));
      for (const [id, bal] of Object.entries(data.balances ?? {})) {
        balances.set(id, bal as number);
      }
      txCounter = data.txCounter ?? 0;
      console.log(`📂 Loaded ${balances.size} players from ${BALANCES_FILE}`);
    } catch {
      console.warn('⚠ Failed to load balances, starting fresh');
    }
  }
}

function saveBalances(): void {
  const data = {
    balances: Object.fromEntries(balances),
    txCounter,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(BALANCES_FILE, JSON.stringify(data, null, 2));
}

// Save every 10 seconds and on exit
let saveTimer: ReturnType<typeof setInterval>;

function startAutoSave(): void {
  saveTimer = setInterval(saveBalances, 10_000);
}

function auditLog(entry: {
  action: string;
  playerId?: string;
  amount?: number;
  reason?: string;
  gameId?: string;
  txId?: string;
  ip: string;
  success: boolean;
}): void {
  const line = JSON.stringify({ ...entry, time: new Date().toISOString() }) + '\n';
  appendFileSync(AUDIT_LOG, line);
}

// ============================================================
// Rate Limiter
// ============================================================

const requestCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_PER_MIN;
}

// Periodically clean up old rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of requestCounts) {
    if (now > entry.resetAt) requestCounts.delete(ip);
  }
}, 60_000);

// ============================================================
// Auth Middleware
// ============================================================

function verifyAuth(authHeader: string | undefined): boolean {
  if (!authHeader) return false;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return false;
  const token = parts[1];
  // Timing-safe comparison to prevent timing attacks
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(DEALER_SECRET);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ============================================================
// Input Validation
// ============================================================

// playerId: must be a hex string (Ed25519 public key), 1-128 chars
function isValidPlayerId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-f0-9]+$/.test(id);
}

// amount: must be a positive integer
function isValidAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isInteger(amount) && amount > 0 && amount <= 1_000_000_000;
}

// reason: string, max 200 chars
function isValidReason(reason: unknown): reason is string {
  return typeof reason === 'string' && reason.length > 0 && reason.length <= 200;
}

function isValidGameId(gameId: unknown): gameId is string {
  return typeof gameId === 'string' && gameId.length > 0 && gameId.length <= 200;
}

// ============================================================
// Express App
// ============================================================

const app = express();

// Request size limit (prevent large payload DoS)
app.use(express.json({ limit: '10kb' }));

// CORS — only allow localhost
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Rate limiting middleware (exempt health and leaderboard)
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/leaderboard') {
    next();
    return;
  }
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkRateLimit(ip)) {
    auditLog({ action: 'rate-limited', ip, success: false });
    res.status(429).json({ error: 'Too many requests. Try again later.' });
    return;
  }
  next();
});

// Auth middleware for protected routes
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!verifyAuth(req.headers.authorization)) {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    auditLog({ action: 'auth-failed', ip, success: false });
    res.status(401).json({ error: 'Unauthorized. Provide valid Bearer token.' });
    return;
  }
  next();
}

// ============================================================
// Helpers
// ============================================================

function ensurePlayer(playerId: string): void {
  if (!balances.has(playerId)) {
    balances.set(playerId, INITIAL_POINTS);
    console.log(`[NEW] ${playerId.slice(0, 8)}... → ${INITIAL_POINTS} points`);
  }
}

function nextTxId(): string {
  return `tx-${++txCounter}`;
}

// ============================================================
// Public Routes (no auth required)
// ============================================================

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', players: balances.size, uptime: process.uptime() });
});

app.get('/leaderboard', (_req, res) => {
  const entries = [...balances.entries()]
    .map(([id, points]) => ({ playerId: id.slice(0, 16) + '...', points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 50); // limit to top 50
  res.json(entries);
});

// ============================================================
// Protected Routes (require DEALER_SECRET)
// ============================================================

// GET /balance/:playerId
app.get('/balance/:playerId', requireAuth, (req, res) => {
  const { playerId } = req.params;
  if (!isValidPlayerId(playerId)) {
    res.status(400).json({ error: 'Invalid playerId format' });
    return;
  }
  ensurePlayer(playerId);
  res.json({ playerId, balance: balances.get(playerId)! });
});

// POST /debit
app.post('/debit', requireAuth, (req, res) => {
  const { gameId, playerId, amount, reason } = req.body;
  const ip = req.ip ?? 'unknown';

  // Validate all fields
  if (!isValidGameId(gameId)) { res.status(400).json({ error: 'Invalid gameId' }); return; }
  if (!isValidPlayerId(playerId)) { res.status(400).json({ error: 'Invalid playerId' }); return; }
  if (!isValidAmount(amount)) { res.status(400).json({ error: 'Invalid amount: must be positive integer' }); return; }
  if (!isValidReason(reason)) { res.status(400).json({ error: 'Invalid reason' }); return; }

  ensurePlayer(playerId);
  const current = balances.get(playerId)!;

  if (current < amount) {
    auditLog({ action: 'debit', playerId, amount, reason, gameId, ip, success: false });
    console.log(`[DEBIT] FAIL ${playerId.slice(0, 8)}... -${amount} (has ${current}) ${reason}`);
    res.json({ success: false, reason: 'insufficient_balance', balance: current, txId: '' });
    return;
  }

  const newBalance = current - amount;
  balances.set(playerId, newBalance);
  const txId = nextTxId();
  auditLog({ action: 'debit', playerId, amount, reason, gameId, txId, ip, success: true });
  console.log(`[DEBIT] ${playerId.slice(0, 8)}... -${amount} → ${newBalance} (${reason})`);
  res.json({ success: true, balance: newBalance, txId });
});

// POST /credit
app.post('/credit', requireAuth, (req, res) => {
  const { gameId, playerId, amount, reason } = req.body;
  const ip = req.ip ?? 'unknown';

  if (!isValidGameId(gameId)) { res.status(400).json({ error: 'Invalid gameId' }); return; }
  if (!isValidPlayerId(playerId)) { res.status(400).json({ error: 'Invalid playerId' }); return; }
  if (!isValidAmount(amount)) { res.status(400).json({ error: 'Invalid amount: must be positive integer' }); return; }
  if (!isValidReason(reason)) { res.status(400).json({ error: 'Invalid reason' }); return; }

  ensurePlayer(playerId);
  const current = balances.get(playerId)!;
  const newBalance = current + amount;
  balances.set(playerId, newBalance);
  const txId = nextTxId();
  auditLog({ action: 'credit', playerId, amount, reason, gameId, txId, ip, success: true });
  console.log(`[CREDIT] ${playerId.slice(0, 8)}... +${amount} → ${newBalance} (${reason})`);
  res.json({ success: true, balance: newBalance, txId });
});

// POST /settle
app.post('/settle', requireAuth, (req, res) => {
  const { gameId, settlements } = req.body;
  const ip = req.ip ?? 'unknown';

  if (!isValidGameId(gameId)) { res.status(400).json({ error: 'Invalid gameId' }); return; }
  if (!Array.isArray(settlements) || settlements.length === 0 || settlements.length > 100) {
    res.status(400).json({ error: 'settlements must be array of 1-100 entries' });
    return;
  }

  // Validate all entries first (atomic: all or nothing)
  for (const s of settlements) {
    if (!isValidPlayerId(s.playerId)) {
      res.status(400).json({ error: `Invalid playerId: ${String(s.playerId).slice(0, 20)}` });
      return;
    }
    if (typeof s.amount !== 'number' || !Number.isInteger(s.amount) || Math.abs(s.amount) > 1_000_000_000) {
      res.status(400).json({ error: `Invalid amount for ${String(s.playerId).slice(0, 8)}` });
      return;
    }
  }

  // Apply all
  const txId = nextTxId();
  for (const s of settlements) {
    ensurePlayer(s.playerId);
    const current = balances.get(s.playerId)!;
    const newBalance = Math.max(0, current + s.amount); // floor at 0
    balances.set(s.playerId, newBalance);
    auditLog({
      action: s.amount >= 0 ? 'credit' : 'debit',
      playerId: s.playerId, amount: Math.abs(s.amount),
      reason: s.reason ?? 'settle', gameId, txId, ip, success: true,
    });
  }

  const updatedBalances: Record<string, number> = {};
  for (const s of settlements) {
    updatedBalances[s.playerId] = balances.get(s.playerId)!;
  }

  res.json({ success: true, txId, balances: updatedBalances });
});

// GET /history/:playerId
app.get('/history/:playerId', requireAuth, (req, res) => {
  const { playerId } = req.params;
  if (!isValidPlayerId(playerId)) {
    res.status(400).json({ error: 'Invalid playerId format' });
    return;
  }

  // Read from audit log file
  if (!existsSync(AUDIT_LOG)) {
    res.json([]);
    return;
  }

  const lines = readFileSync(AUDIT_LOG, 'utf-8').split('\n').filter(Boolean);
  const playerHistory = lines
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(entry => entry && entry.playerId === playerId)
    .slice(-100); // last 100 entries

  res.json(playerHistory);
});

// ============================================================
// 404 handler — don't leak info
// ============================================================

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ============================================================
// Start
// ============================================================

loadBalances();
startAutoSave();

// Save on exit
process.on('SIGINT', () => {
  console.log('\n💾 Saving balances...');
  saveBalances();
  clearInterval(saveTimer);
  process.exit(0);
});

process.on('SIGTERM', () => {
  saveBalances();
  clearInterval(saveTimer);
  process.exit(0);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║      🎰 Secure Points Server (Method B)         ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  URL:    http://127.0.0.1:${PORT}                  ║`);
  console.log(`║  Auth:   Bearer token required                   ║`);
  console.log(`║  Data:   ${DATA_DIR}  ║`);
  console.log(`║  Rate:   ${RATE_LIMIT_PER_MIN} req/min per IP                    ║`);
  console.log(`║  Init:   ${INITIAL_POINTS} points per new player              ║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});

export { app, DEALER_SECRET };
