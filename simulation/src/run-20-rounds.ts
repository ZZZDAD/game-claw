/**
 * 20-Round Texas Hold'em — Real Network via Cloudflare Tunnel
 *
 * Uses actual DealerNode (with chipProvider) + Cloudflare Tunnel.
 * Simulation ONLY does: connect bots + make decisions.
 */

import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import nacl from 'tweetnacl';
import tnaclUtil from 'tweetnacl-util';
import {
  generateIdentity, identityToPlayerInfo,
  DealerNode,
  type RoomConfig, type PlayerAction, type Identity, type PlayerInfo,
} from '@game-claw/core';
import { TexasHoldemPlugin } from '@game-claw/texas-holdem';

// === Config ===
const TOTAL_ROUNDS = 20;
const POINTS_URL = 'http://localhost:3100';
const SB = 5, BB = 10, BUY_IN = 200, COMMISSION = 5;
const DEALER_PORT = 9876;

// === Logging ===
const log: string[] = [];
const issues: string[] = [];
function md(s: string) { log.push(s); console.log(s.replace(/[#*`]/g, '')); }
function logAct(r: number, who: string, act: string, detail = '') {
  log.push(`| ${r} | ${who} | ${act} | ${detail} |`);
  console.log(`  [R${r}] ${who}: ${act} ${detail}`);
}

// === Points Server (read-only) ===
async function getBalance(id: string): Promise<number> {
  return ((await (await fetch(`${POINTS_URL}/balance/${id}`)).json()) as any).balance;
}
async function getLeaderboard(): Promise<{ playerId: string; points: number }[]> {
  return (await fetch(`${POINTS_URL}/leaderboard`)).json() as any;
}

// === Bot AI ===
function botDecide(actions: PlayerAction[], phase: string): PlayerAction {
  const types = actions.map(a => a.type);
  const r = Math.random();
  if (phase === 'preflop') {
    return actions.find(a => a.type === 'call') ?? actions.find(a => a.type === 'check') ?? actions[0];
  }
  if (r < 0.1 && types.includes('raise')) return actions.find(a => a.type === 'raise')!;
  if (types.includes('check')) return actions.find(a => a.type === 'check')!;
  if (types.includes('call')) return r < 0.7 ? actions.find(a => a.type === 'call')! : actions.find(a => a.type === 'fold')!;
  return actions[0];
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// === WebSocket Player Client ===
class WsPlayerClient {
  private ws!: WebSocket;
  private hand: { cardId: string; salt: string }[] = [];
  private dealerEncryptPubKey?: Uint8Array;

  constructor(private identity: Identity, private playerInfo: PlayerInfo, private npmVersion: string) {}

  async connect(url: string): Promise<{ accepted: boolean; reason?: string }> {
    this.hand = [];
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.on('error', reject);
      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({
          type: 'join-request',
          payload: { playerInfo: this.playerInfo, npmVersion: this.npmVersion },
          from: this.playerInfo.id,
        }));
      });
      this.ws.on('message', (raw: Buffer) => {
        const str = raw.toString();
        if (str === '__ping__') { this.ws.send('__pong__'); return; }
        if (str === '__pong__') return;
        const event = JSON.parse(str);
        if (event.type === 'join-response') resolve(event.payload);
        else if (event.type === 'game-start') this.handleGameStart(event.payload);
        else if (event.type === 'new-card') this.handleNewCard(event.payload);
      });
    });
  }

  private handleGameStart(payload: any) {
    this.dealerEncryptPubKey = new Uint8Array(payload.dealerEncryptPubKey);
    for (const cc of (payload.playerCommitments ?? [])) {
      const encrypted = tnaclUtil.decodeBase64(cc.encrypted);
      const nonce = tnaclUtil.decodeBase64(cc.nonce);
      const decrypted = nacl.box.open(encrypted, nonce, this.dealerEncryptPubKey, this.identity.encryptKeyPair.secretKey);
      if (decrypted) this.hand.push(JSON.parse(new TextDecoder().decode(decrypted)));
    }
  }

  private handleNewCard(payload: any) {
    const cc = payload.commitment;
    if (!cc?.encrypted) return;
    const encrypted = tnaclUtil.decodeBase64(cc.encrypted);
    const nonce = tnaclUtil.decodeBase64(cc.nonce);
    const decrypted = nacl.box.open(encrypted, nonce, this.dealerEncryptPubKey!, this.identity.encryptKeyPair.secretKey);
    if (decrypted) this.hand.push(JSON.parse(new TextDecoder().decode(decrypted)));
  }

  sendAction(action: PlayerAction) {
    this.ws.send(JSON.stringify({ type: 'action', payload: action, from: this.playerInfo.id }));
  }

  getHand() { return this.hand; }
  disconnect() { if (this.ws?.readyState === WebSocket.OPEN) this.ws.close(); }
}

// === Main ===
async function main() {
  md('# 20-Round Texas Hold\'em — Cloudflare Tunnel Simulation\n');
  md(`**Date**: ${new Date().toISOString()}`);
  md(`**Transport**: Cloudflare Tunnel`);
  md(`**Players**: 5 bots | **Blinds**: ${SB}/${BB} | **Buy-in**: ${BUY_IN} | **Commission**: ${COMMISSION}/player/round\n`);

  try { await fetch(`${POINTS_URL}/leaderboard`); md('✅ Points server connected'); }
  catch { md('❌ Points server not reachable'); process.exit(1); }

  const plugin = new TexasHoldemPlugin();
  const dealerIdentity = generateIdentity();
  const dealerPlayerId = identityToPlayerInfo(dealerIdentity).id;
  const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
  const players: { id: Identity; info: PlayerInfo; name: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const id = generateIdentity();
    players.push({ id, info: identityToPlayerInfo(id), name: names[i] });
  }
  const nameMap = new Map(players.map(p => [p.info.id, p.name]));
  nameMap.set(dealerPlayerId, 'Dealer');
  const getName = (id: string) => nameMap.get(id) ?? id.slice(0, 8);

  const dealerInitBal = await getBalance(dealerPlayerId);
  md(`- **Dealer**: ${dealerInitBal} points`);
  for (const p of players) md(`- **${p.name}**: ${await getBalance(p.info.id)} points`);
  const initialTotal = dealerInitBal + players.length * 1000;
  md(`\n**Initial total**: ${initialTotal} points\n`);

  const roomConfig: RoomConfig = {
    gameType: 'texas-holdem', chipProvider: { type: 'http', url: POINTS_URL },
    chipUnit: 'points', minBet: SB, maxBet: 1000, buyIn: BUY_IN, commission: COMMISSION,
    settings: { smallBlind: SB, bigBlind: BB },
  };

  // Start a temporary server on DEALER_PORT for tunnel probing
  const { createServer } = await import('node:http');
  const tempServer = createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise<void>(r => tempServer.listen(DEALER_PORT, '0.0.0.0', r));

  md('### Starting Cloudflare Tunnel...');
  const cfProc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${DEALER_PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let tunnelUrl = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Tunnel timeout')), 30000);
    const parse = (d: Buffer) => { const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m) { clearTimeout(t); resolve(m[0].replace('https://', 'wss://')); } };
    cfProc.stdout?.on('data', parse);
    cfProc.stderr?.on('data', parse);
  });
  md(`✅ Tunnel: \`${tunnelUrl}\`\n`);
  md('⏳ Waiting for tunnel...');
  await wait(20000);
  // Test tunnel with HTTP (temp server responds)
  for (let i = 1; i <= 10; i++) {
    try {
      const httpUrl = tunnelUrl.replace('wss://', 'https://');
      const res = await fetch(httpUrl, { signal: AbortSignal.timeout(5000) });
      md(`✅ Tunnel ready (HTTP ${res.status})\n`); break;
    } catch { if (i === 10) { md('❌ Tunnel failed'); process.exit(1); } await wait(5000); }
  }
  // Close temp server — DealerNode will use this port per round
  await new Promise<void>(r => tempServer.close(() => r()));
  await wait(500);

  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    md(`\n## Round ${round}\n`);
    const btnIdx = (round - 1) % 5;
    md(`**Button**: ${names[btnIdx]} | **SB**: ${names[(btnIdx+1)%5]} (${SB}) | **BB**: ${names[(btnIdx+2)%5]} (${BB})\n`);

    // Create fresh DealerNode — it starts WebSocket on DEALER_PORT
    // DealerNode uses chipProvider internally for all debit/credit
    const dealer = new DealerNode(plugin, dealerIdentity, '0.1.0', roomConfig);
    const localUrl = await dealer.createRoom(DEALER_PORT);
    await wait(500); // let server start

    // Players connect via tunnel → traffic goes through Cloudflare → hits DealerNode
    const clients: WsPlayerClient[] = [];
    let joinFailed = false;
    for (const p of players) {
      const client = new WsPlayerClient(p.id, p.info, '0.1.0');
      try {
        const jr = await client.connect(tunnelUrl);
        if (!jr.accepted) throw new Error(jr.reason ?? 'rejected');
        clients.push(client);
      } catch (err) {
        issues.push(`R${round}: ${p.name} join failed — ${(err as Error).message}`);
        md(`⚠️ ${issues.at(-1)}`);
        joinFailed = true; break;
      }
    }
    if (joinFailed) {
      for (const c of clients) c.disconnect();
      await dealer.stop(); await wait(500);
      continue;
    }
    md(`✅ All 5 players connected via tunnel`);

    // Start game — DealerNode handles blinds debit, card dealing, etc.
    await dealer.startGame({ buttonIndex: btnIdx });
    await wait(500);

    // Log hands
    md('\n| Player | Hole Cards |');
    md('|--------|-----------|');
    for (let i = 0; i < 5; i++) {
      md(`| ${players[i].name} | ${clients[i].getHand().map(c => c.cardId).join(', ')} |`);
    }
    md('');
    md('| Round | Player | Action | Detail |');
    md('|-------|--------|--------|--------|');

    // === Bot play loop ===
    const engine = dealer.getEngine();
    let actCount = 0;
    try {
      while (!engine.isOver() && actCount < 100) {
        const validActions = engine.getValidActions();
        if (validActions.length === 0) break;

        const pid = validActions[0].playerId;
        const pIdx = players.findIndex(p => p.info.id === pid);
        const phase = engine.getState().phase;
        const prevComm = engine.getState().communityCards.length;

        const action = botDecide(validActions, phase);
        let detail = '';
        if (action.type === 'raise') detail = `to ${(action.payload as any)?.amount}`;

        // Send through WebSocket → DealerNode validates → broadcasts → debit/credit
        clients[pIdx].sendAction(action);
        await wait(200);

        // Log community cards if changed
        const newComm = engine.getState().communityCards;
        if (newComm.length > prevComm) {
          const phase2 = newComm.length === 3 ? 'FLOP' : newComm.length === 4 ? 'TURN' : 'RIVER';
          logAct(round, '🃏', phase2, newComm.map(c => c.id).join(', '));
        }

        logAct(round, players[pIdx].name, action.type, detail);
        actCount++;
      }

      if (engine.isOver()) {
        const result = engine.getResult();
        md(`\n**Community**: ${engine.getState().communityCards.map(c => c.id).join(', ') || '(none)'}`);
        md(`**Winners**: ${result.winners.map(id => getName(id)).join(', ')}`);

        md('\n| Player | Net Change |');
        md('|--------|-----------|');
        for (const p of players) {
          const net = result.pointChanges[p.info.id] ?? 0;
          md(`| ${p.name} | ${net >= 0 ? '+' : ''}${net} |`);
        }
        md(`| Dealer (commission) | +${result.commission} |`);

        const reveals = engine.getAllReveals();
        const allC = engine.getCommitments();
        let ok = true;
        for (const r of reveals) {
          const m = allC.find(c => c.cardIndex === r.cardIndex);
          if (m && !engine.verifyReveal(r, m.commitment)) { ok = false; break; }
        }
        md(`\n**Crypto**: ${ok ? '✅' : '❌'}`);
        if (!ok) issues.push(`R${round}: Commitment failed`);
      } else {
        issues.push(`R${round}: Game incomplete`);
      }
    } catch (err) {
      issues.push(`R${round}: ${(err as Error).message}`);
      md(`\n⚠️ ${issues.at(-1)}`);
    }

    for (const c of clients) c.disconnect();
    await dealer.stop();
    await wait(1000); // let port free
  }

  // === Leaderboard + Zero-Sum ===
  md('\n---\n## Final Leaderboard\n');
  md('| Rank | Player | Points |');
  md('|------|--------|--------|');
  const lb = await getLeaderboard();
  lb.forEach((e, i) => md(`| ${i + 1} | ${getName(e.playerId)} | ${e.points} |`));

  md('\n---\n## Zero-Sum Verification\n');
  const dealerFinal = await getBalance(dealerPlayerId);
  let playerTotal = 0;
  md('| Account | Points |');
  md('|---------|--------|');
  md(`| Dealer | ${dealerFinal} |`);
  for (const p of players) {
    const bal = await getBalance(p.info.id);
    md(`| ${p.name} | ${bal} |`);
    playerTotal += bal;
  }
  const finalTotal = dealerFinal + playerTotal;
  md(`| **Total** | **${finalTotal}** |`);
  md(`| **Initial** | **${initialTotal}** |`);
  md(`| **Diff** | **${finalTotal - initialTotal}** |`);
  md(finalTotal === initialTotal ? '\n✅ **Zero-sum verified**' : `\n❌ **NOT zero-sum! Diff: ${finalTotal - initialTotal}**`);
  if (finalTotal !== initialTotal) issues.push(`Zero-sum failed`);

  md('\n---\n## Issues\n');
  if (issues.length > 0) issues.forEach(i => md(`- ${i}`));
  else md('✅ No issues found.');

  writeFileSync('/Users/regison/game-claw-platform/simulation/report.md', log.join('\n'));
  console.log('\n=== Report: simulation/report.md ===');
  cfProc.kill('SIGTERM');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
