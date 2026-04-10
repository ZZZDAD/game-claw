import { describe, it, expect, afterEach } from 'vitest';
import { DealerNode } from '../../engine/dealer.js';
import { PlayerNode } from '../../engine/player.js';
import { generateIdentity } from '../../crypto/keys.js';
import type { GamePlugin, GameState, DealPlan, PlayerAction, GameResult, PlayerInfo, RoomConfig } from '../../types/index.js';

const roomConfig: RoomConfig = {
  gameType: 'test', chipProvider: { type: 'local' }, chipUnit: 'pts',
  minBet: 10, maxBet: 100, buyIn: 500, commission: 2,
};

const testPlugin: GamePlugin = {
  meta: { name: 'test', displayName: 'Test', minPlayers: 2, maxPlayers: 2, version: '0.1.0' },
  createDeck: () => [
    { id: 'card-1', suit: 'test', rank: '1' },
    { id: 'card-2', suit: 'test', rank: '2' },
  ],
  createGame(players: PlayerInfo[]): GameState {
    return {
      phase: 'play', players, hands: {}, communityCards: [],
      currentPlayerIndex: 0, roundData: { revealed: [] as string[] },
      deck: [], dealtCardMap: new Map(),
    };
  },
  getDealPlan: (state) => [{
    phase: 'deal',
    deals: state.players.map((p) => ({ target: p.id, count: 1, faceUp: false })),
  }],
  validateAction: (_s, a) => a.type === 'reveal',
  applyAction(state, action) {
    const newState = structuredClone(state);
    const revealed = newState.roundData.revealed as string[];
    revealed.push(action.playerId);
    newState.roundData.revealed = revealed;
    if (revealed.length === 2) newState.phase = 'end';
    return { state: newState, pendingActions: [] };
  },
  isGameOver: (s) => s.phase === 'end',
  getResult(state) {
    const p0 = state.players[0].id, p1 = state.players[1].id;
    const r0 = parseInt(state.hands[p0]?.[0]?.rank ?? '0');
    const r1 = parseInt(state.hands[p1]?.[0]?.rank ?? '0');
    const winner = r0 > r1 ? p0 : p1, loser = winner === p0 ? p1 : p0;
    return { winners: [winner], pointChanges: { [winner]: 10, [loser]: -10 }, commission: 0, finalState: state };
  },
  getValidActions: (s) => s.players.map((p) => ({ playerId: p.id, type: 'reveal' })),
  getPublicState: (s) => ({ phase: s.phase, revealed: s.roundData.revealed }),
};

describe('Dealer + Player network', () => {
  let dealer: DealerNode;
  let players: PlayerNode[];

  afterEach(async () => {
    for (const p of players || []) await p.disconnect();
    if (dealer) await dealer.stop();
  });

  it('runs a full networked game', async () => {
    const dealerIdentity = generateIdentity();
    dealer = new DealerNode(testPlugin, dealerIdentity, '0.1.0', roomConfig);
    const roomUrl = await dealer.createRoom(0);

    const p1Identity = generateIdentity();
    const p2Identity = generateIdentity();

    const p1 = new PlayerNode(p1Identity, '0.1.0');
    const p2 = new PlayerNode(p2Identity, '0.1.0');
    players = [p1, p2];

    const j1 = await p1.join(roomUrl);
    expect(j1.accepted).toBe(true);
    const j2 = await p2.join(roomUrl);
    expect(j2.accepted).toBe(true);

    await dealer.startGame();
    await new Promise((r) => setTimeout(r, 200));

    // Each player should have 1 card
    expect(p1.getHand()).toHaveLength(1);
    expect(p2.getHand()).toHaveLength(1);

    // Both reveal
    await p1.sendAction({ playerId: p1.getPlayerId(), type: 'reveal' });
    await new Promise((r) => setTimeout(r, 100));
    await p2.sendAction({ playerId: p2.getPlayerId(), type: 'reveal' });
    await new Promise((r) => setTimeout(r, 200));

    expect(dealer.isGameOver()).toBe(true);
  }, 10000);

  it('rejects player with wrong version', async () => {
    const dealerIdentity = generateIdentity();
    dealer = new DealerNode(testPlugin, dealerIdentity, '0.1.0', roomConfig);
    const roomUrl = await dealer.createRoom(0);

    const p1 = new PlayerNode(generateIdentity(), '0.2.0'); // wrong version
    players = [p1];

    const j1 = await p1.join(roomUrl);
    expect(j1.accepted).toBe(false);
    expect(j1.reason).toContain('Version mismatch');
  }, 5000);
});
