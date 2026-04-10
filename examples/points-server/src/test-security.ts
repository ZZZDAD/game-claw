/**
 * Security test suite for the Points Server.
 * Tests all attack vectors to verify they are properly blocked.
 *
 * Run: pnpm test
 */

const BASE = 'http://127.0.0.1:3100';
let SECRET = '';
let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✔ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

async function req(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  // Read secret from .env
  const { readFileSync, existsSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = join(__dirname, '..', '.env');

  if (!existsSync(envPath)) {
    console.error('❌ No .env file. Run: pnpm run generate-secret');
    process.exit(1);
  }

  const envContent = readFileSync(envPath, 'utf-8');
  const match = envContent.match(/DEALER_SECRET=(\S+)/);
  if (!match) {
    console.error('❌ DEALER_SECRET not found in .env');
    process.exit(1);
  }
  SECRET = match[1];

  console.log('\n🔐 Points Server Security Tests\n');
  console.log('Make sure the server is running: pnpm start\n');

  // Check server is up
  try {
    await fetch(`${BASE}/health`);
  } catch {
    console.error('❌ Server not reachable at', BASE);
    process.exit(1);
  }

  // =========================================================
  console.log('1. Authentication Tests');
  // =========================================================

  {
    const r = await req('GET', '/balance/aabbccdd');
    assert(r.status === 401, 'GET /balance without token → 401');
  }

  {
    const r = await req('POST', '/debit', { gameId: 'g1', playerId: 'aabbccdd', amount: 10, reason: 'test' });
    assert(r.status === 401, 'POST /debit without token → 401');
  }

  {
    const r = await req('POST', '/credit', { gameId: 'g1', playerId: 'aabbccdd', amount: 10, reason: 'test' }, 'wrong-token');
    assert(r.status === 401, 'POST /credit with wrong token → 401');
  }

  {
    const r = await req('POST', '/settle', { gameId: 'g1', settlements: [] }, 'Bearer-faketoken');
    assert(r.status === 401, 'POST /settle with malformed auth → 401');
  }

  {
    const r = await req('GET', '/balance/aabbccdd', undefined, SECRET);
    assert(r.status === 200, 'GET /balance with correct token → 200');
  }

  // =========================================================
  console.log('\n2. Input Validation Tests');
  // =========================================================

  {
    const r = await req('GET', '/balance/INVALID_ID_UPPERCASE!', undefined, SECRET);
    assert(r.status === 400, 'playerId with uppercase/special chars → 400');
  }

  {
    const r = await req('POST', '/debit', { gameId: 'g1', playerId: 'aabbccdd', amount: -50, reason: 'hack' }, SECRET);
    assert(r.status === 400, 'Negative debit amount → 400');
  }

  {
    const r = await req('POST', '/debit', { gameId: 'g1', playerId: 'aabbccdd', amount: 0, reason: 'hack' }, SECRET);
    assert(r.status === 400, 'Zero debit amount → 400');
  }

  {
    const r = await req('POST', '/debit', { gameId: 'g1', playerId: 'aabbccdd', amount: 1.5, reason: 'hack' }, SECRET);
    assert(r.status === 400, 'Non-integer amount → 400');
  }

  {
    const r = await req('POST', '/debit', { gameId: 'g1', playerId: 'aabbccdd', amount: 9999999999, reason: 'hack' }, SECRET);
    assert(r.status === 400, 'Amount > 1 billion → 400');
  }

  {
    const r = await req('POST', '/credit', { gameId: '', playerId: 'aabbccdd', amount: 10, reason: 'test' }, SECRET);
    assert(r.status === 400, 'Empty gameId → 400');
  }

  {
    const r = await req('POST', '/credit', { gameId: 'g1', playerId: 'aabbccdd', amount: 10, reason: '' }, SECRET);
    assert(r.status === 400, 'Empty reason → 400');
  }

  {
    const r = await req('POST', '/debit', { gameId: 'g1', playerId: 'aabbccdd', amount: NaN, reason: 'hack' }, SECRET);
    assert(r.status === 400, 'NaN amount → 400');
  }

  // =========================================================
  console.log('\n3. Attack Simulation Tests');
  // =========================================================

  // 3a. Try to credit without auth (free money attack)
  {
    const r = await req('POST', '/credit', { gameId: 'g1', playerId: 'aabbccdd', amount: 999999, reason: 'free money' });
    assert(r.status === 401, 'Credit without auth (free money attack) → blocked');
  }

  // 3b. Try to manipulate another player's balance
  {
    const r = await req('POST', '/debit', { gameId: 'g1', playerId: 'aabbccdd', amount: 500, reason: 'steal' }, 'stolen-token');
    assert(r.status === 401, 'Debit with stolen token → blocked');
  }

  // 3c. Path traversal / SQL injection in playerId
  {
    const r = await req('GET', '/balance/../../../etc/passwd', undefined, SECRET);
    assert(r.status === 400 || r.status === 404, 'Path traversal in playerId → blocked (400 or 404)');
  }

  {
    // URL-encoded path traversal
    const r = await req('GET', '/balance/..%2F..%2Fetc%2Fpasswd', undefined, SECRET);
    assert(r.status === 400, 'URL-encoded path traversal → 400');
  }

  {
    const r = await req('POST', '/debit', { gameId: 'g1', playerId: "'; DROP TABLE--", amount: 10, reason: 'sql' }, SECRET);
    assert(r.status === 400, 'SQL injection in playerId → 400');
  }

  // 3d. Large payload attack
  {
    const bigPayload = { gameId: 'g1', playerId: 'aabbccdd', amount: 10, reason: 'x'.repeat(1000) };
    const r = await req('POST', '/debit', bigPayload, SECRET);
    assert(r.status === 400, 'Oversized reason (1000 chars) → 400');
  }

  // 3e. Settle with too many entries
  {
    const bigSettle = { gameId: 'g1', settlements: Array.from({ length: 200 }, (_, i) => ({ playerId: 'aa', amount: 1 })) };
    const r = await req('POST', '/settle', bigSettle, SECRET);
    assert(r.status === 400, 'Settle with 200 entries (limit 100) → 400');
  }

  // =========================================================
  console.log('\n4. Functional Tests (with auth)');
  // =========================================================

  // Use a unique test player per run to avoid stale state
  const testPlayer = 'aabb' + Date.now().toString(16).padEnd(12, '0');

  {
    const r = await req('GET', `/balance/${testPlayer}`, undefined, SECRET);
    assert(r.status === 200 && r.data.balance === 1000, 'New player gets 1000 initial points');
  }

  {
    const r = await req('POST', '/debit', { gameId: 'g1', playerId: testPlayer, amount: 100, reason: 'bet' }, SECRET);
    assert(r.status === 200 && r.data.success === true && r.data.balance === 900, 'Debit 100 → balance 900');
  }

  {
    const r = await req('POST', '/credit', { gameId: 'g1', playerId: testPlayer, amount: 250, reason: 'win' }, SECRET);
    assert(r.status === 200 && r.data.success === true && r.data.balance === 1150, 'Credit 250 → balance 1150');
  }

  {
    const r = await req('POST', '/debit', { gameId: 'g1', playerId: testPlayer, amount: 9999, reason: 'bet' }, SECRET);
    assert(r.data.success === false && r.data.reason === 'insufficient_balance', 'Debit > balance → insufficient_balance');
  }

  {
    const r = await req('GET', `/history/${testPlayer}`, undefined, SECRET);
    assert(r.status === 200 && Array.isArray(r.data) && r.data.length >= 2, 'History has audit entries');
  }

  {
    const r = await req('GET', '/leaderboard');
    assert(r.status === 200 && Array.isArray(r.data), 'Leaderboard is public and accessible');
  }

  {
    const r = await req('GET', '/health');
    assert(r.status === 200 && r.data.status === 'ok', 'Health check returns ok');
  }

  // =========================================================
  console.log('\n5. 404 and Unknown Routes');
  // =========================================================

  {
    const r = await req('GET', '/admin');
    assert(r.status === 404, 'Unknown public route → 404');
  }

  {
    // DELETE is not a recognized method for any route → falls through to 404 handler
    const r = await fetch(`${BASE}/something`, { method: 'DELETE' }).then(async r => ({ status: r.status, data: await r.json() }));
    assert(r.status === 404, 'DELETE method → 404');
  }

  // =========================================================
  console.log('\n═══════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
