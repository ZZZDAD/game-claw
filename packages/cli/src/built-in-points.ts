/**
 * Built-in points server that runs in-process.
 * Started automatically when the dealer CLI has no --chips-url.
 *
 * Features:
 *   - Bearer token auth (auto-generated)
 *   - Input validation
 *   - File persistence (balances.json in cwd)
 *   - All the same endpoints as examples/points-server
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BALANCES_FILE = 'game-claw-balances.json';

export async function startBuiltInPointsServer(defaultBalance: number): Promise<{
  url: string;
  token: string;
  stop: () => Promise<void>;
}> {
  const token = randomBytes(32).toString('hex');
  const balances = new Map<string, number>();
  let txCounter = 0;

  // Load persisted balances
  if (existsSync(BALANCES_FILE)) {
    try {
      const data = JSON.parse(readFileSync(BALANCES_FILE, 'utf-8'));
      for (const [id, bal] of Object.entries(data.balances ?? {})) {
        balances.set(id, bal as number);
      }
      txCounter = data.txCounter ?? 0;
    } catch {}
  }

  function save() {
    writeFileSync(BALANCES_FILE, JSON.stringify({
      balances: Object.fromEntries(balances),
      txCounter,
      savedAt: new Date().toISOString(),
    }, null, 2));
  }

  const saveTimer = setInterval(save, 10_000);

  function ensure(id: string) {
    if (!balances.has(id)) balances.set(id, defaultBalance);
  }

  function nextTx() { return `tx-${++txCounter}`; }

  function isValidId(id: unknown): id is string {
    return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-f0-9]+$/.test(id);
  }

  function json(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  function readBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: string) => { body += chunk; if (body.length > 10240) reject(new Error('too large')); });
      req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('invalid json')); } });
    });
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? '';
    const method = req.method ?? '';

    // Auth check (skip health)
    if (url !== '/health') {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${token}`) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }
    }

    try {
      // GET /health
      if (method === 'GET' && url === '/health') {
        json(res, 200, { status: 'ok', players: balances.size });
        return;
      }

      // GET /balance/:id
      if (method === 'GET' && url.startsWith('/balance/')) {
        const id = url.slice('/balance/'.length);
        if (!isValidId(id)) { json(res, 400, { error: 'Invalid playerId' }); return; }
        ensure(id);
        json(res, 200, { playerId: id, balance: balances.get(id)! });
        return;
      }

      // POST /debit
      if (method === 'POST' && url === '/debit') {
        const { gameId, playerId, amount, reason } = await readBody(req);
        if (!isValidId(playerId) || typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
          json(res, 400, { error: 'Invalid input' }); return;
        }
        ensure(playerId);
        const current = balances.get(playerId)!;
        if (current < amount) {
          json(res, 200, { success: false, reason: 'insufficient_balance', balance: current, txId: '' });
          return;
        }
        const newBal = current - amount;
        balances.set(playerId, newBal);
        json(res, 200, { success: true, balance: newBal, txId: nextTx() });
        return;
      }

      // POST /credit
      if (method === 'POST' && url === '/credit') {
        const { gameId, playerId, amount, reason } = await readBody(req);
        if (!isValidId(playerId) || typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
          json(res, 400, { error: 'Invalid input' }); return;
        }
        ensure(playerId);
        const newBal = balances.get(playerId)! + amount;
        balances.set(playerId, newBal);
        json(res, 200, { success: true, balance: newBal, txId: nextTx() });
        return;
      }

      // POST /settle
      if (method === 'POST' && url === '/settle') {
        const { gameId, settlements } = await readBody(req);
        if (!Array.isArray(settlements)) { json(res, 400, { error: 'Invalid input' }); return; }
        for (const s of settlements) {
          ensure(s.playerId);
          balances.set(s.playerId, Math.max(0, balances.get(s.playerId)! + s.amount));
        }
        const result: Record<string, number> = {};
        for (const s of settlements) result[s.playerId] = balances.get(s.playerId)!;
        json(res, 200, { success: true, txId: nextTx(), balances: result });
        return;
      }

      json(res, 404, { error: 'Not found' });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        token,
        stop: async () => {
          clearInterval(saveTimer);
          save();
          return new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}
