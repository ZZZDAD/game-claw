/**
 * Points Server — ChipProvider Protocol (Method B: real-time debit/credit)
 *
 * Endpoints:
 *   GET  /balance/:playerId
 *   POST /debit       ← deduct chips when betting
 *   POST /credit      ← add chips when winning
 *   POST /settle      ← batch settle (convenience)
 *   GET  /leaderboard
 *   GET  /history/:playerId
 *
 * Rules:
 *   - New player: gets 1000 points
 *   - Existing player (even with 0 points): keeps current points
 */

import express from 'express';

const app = express();
app.use(express.json());

// In-memory storage
const balances = new Map<string, number>();
const history: { playerId: string; amount: number; reason: string; gameId: string; time: string }[] = [];
let txCounter = 0;

function ensurePlayer(playerId: string): void {
  if (!balances.has(playerId)) {
    balances.set(playerId, 1000);
    console.log(`[NEW] ${playerId.slice(0, 8)}... → 1000 points`);
  }
}

function nextTxId(): string {
  return `tx-${++txCounter}`;
}

// === GET /balance/:playerId ===
app.get('/balance/:playerId', (req, res) => {
  const { playerId } = req.params;
  ensurePlayer(playerId);
  res.json({ playerId, balance: balances.get(playerId)! });
});

// === POST /debit — deduct chips immediately ===
app.post('/debit', (req, res) => {
  const { gameId, playerId, amount, reason } = req.body;
  ensurePlayer(playerId);

  const current = balances.get(playerId)!;
  if (current < amount) {
    console.log(`[DEBIT] FAIL ${playerId.slice(0, 8)}... -${amount} (has ${current}) ${reason}`);
    res.json({ success: false, reason: 'insufficient_balance', balance: current, txId: '' });
    return;
  }

  const newBalance = current - amount;
  balances.set(playerId, newBalance);
  const txId = nextTxId();
  history.push({ playerId, amount: -amount, reason, gameId, time: new Date().toISOString() });
  console.log(`[DEBIT] ${playerId.slice(0, 8)}... -${amount} → ${newBalance} (${reason})`);
  res.json({ success: true, balance: newBalance, txId });
});

// === POST /credit — add chips immediately ===
app.post('/credit', (req, res) => {
  const { gameId, playerId, amount, reason } = req.body;
  ensurePlayer(playerId);

  const current = balances.get(playerId)!;
  const newBalance = current + amount;
  balances.set(playerId, newBalance);
  const txId = nextTxId();
  history.push({ playerId, amount, reason, gameId, time: new Date().toISOString() });
  console.log(`[CREDIT] ${playerId.slice(0, 8)}... +${amount} → ${newBalance} (${reason})`);
  res.json({ success: true, balance: newBalance, txId });
});

// === POST /settle — batch settle (multiple debit/credits) ===
app.post('/settle', (req, res) => {
  const { gameId, settlements } = req.body;
  console.log(`[SETTLE] gameId=${gameId}`);

  for (const s of settlements) {
    ensurePlayer(s.playerId);
    const current = balances.get(s.playerId)!;
    balances.set(s.playerId, current + s.amount);
    history.push({ playerId: s.playerId, amount: s.amount, reason: s.reason ?? 'settle', gameId, time: new Date().toISOString() });
    console.log(`  ${s.playerId.slice(0, 8)}... ${s.amount >= 0 ? '+' : ''}${s.amount} → ${current + s.amount}`);
  }

  const updatedBalances: Record<string, number> = {};
  for (const s of settlements) {
    updatedBalances[s.playerId] = balances.get(s.playerId)!;
  }

  res.json({ success: true, txId: nextTxId(), balances: updatedBalances });
});

// === GET /leaderboard ===
app.get('/leaderboard', (_req, res) => {
  const entries = [...balances.entries()]
    .map(([id, points]) => ({ playerId: id, points }))
    .sort((a, b) => b.points - a.points);
  res.json(entries);
});

// === GET /history/:playerId ===
app.get('/history/:playerId', (req, res) => {
  const playerHistory = history.filter(h => h.playerId === req.params.playerId);
  res.json(playerHistory);
});

// === Start server ===
const PORT = parseInt(process.env.PORT ?? '3100');
app.listen(PORT, () => {
  console.log(`\n=== Points Server (Method B) on http://localhost:${PORT} ===\n`);
});
