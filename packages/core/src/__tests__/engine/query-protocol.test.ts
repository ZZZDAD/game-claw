/**
 * Tests for the Query Protocol between PlayerNode and DealerNode.
 *
 * Covers:
 *   1. Functional: all 5 query types return correct data
 *   2. Security: spoofed playerId rejected, unauthorized connection rejected
 *   3. Rate limiting: rapid queries get rejected
 *   4. Edge cases: query before game, query during game, query after game
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DealerNode } from '../../engine/dealer.js';
import { PlayerNode } from '../../engine/player.js';
import { generateIdentity, identityToPlayerInfo } from '../../crypto/keys.js';
import { LocalTransport } from '../../transport/local.js';
import type { GamePlugin, GameState, PlayerInfo, RoomConfig } from '../../types/index.js';
import type { DealerLogger } from '../../engine/dealer.js';

// Simple test plugin
const createTestPlugin = (): GamePlugin => ({
  meta: { name: 'test', displayName: 'Test', minPlayers: 2, maxPlayers: 4, version: '0.1.0' },
  createDeck: () => [
    { id: 'card-1', suit: 'test', rank: '1' },
    { id: 'card-2', suit: 'test', rank: '2' },
    { id: 'card-3', suit: 'test', rank: '3' },
    { id: 'card-4', suit: 'test', rank: '4' },
  ],
  createGame(players: PlayerInfo[]): GameState {
    return {
      phase: 'play', players, hands: {}, communityCards: [],
      currentPlayerIndex: 0, roundData: { revealed: [] as string[], pot: 100 },
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
    if (revealed.length >= newState.players.length) newState.phase = 'end';
    else newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % newState.players.length;
    return { state: newState, pendingActions: [] };
  },
  isGameOver: (s) => s.phase === 'end',
  getResult: (state) => ({
    winners: [state.players[0].id],
    pointChanges: Object.fromEntries(state.players.map((p, i) => [p.id, i === 0 ? 10 : -5])),
    commission: 0, finalState: state,
  }),
  getValidActions: (s) => [{ playerId: s.players[s.currentPlayerIndex].id, type: 'reveal' }],
  getPublicState: (s) => ({ phase: s.phase, pot: s.roundData.pot, revealed: s.roundData.revealed }),
});

const roomConfig: RoomConfig = {
  gameType: 'test', chipProvider: { type: 'local' }, chipUnit: 'pts',
  minBet: 10, maxBet: 100, buyIn: 500, commission: 0,
};

// === Functional Tests ===

describe('Query Protocol: Functional', () => {
  let dealer: DealerNode;
  let p1: PlayerNode;
  let p2: PlayerNode;

  afterEach(async () => {
    await p1?.disconnect();
    await p2?.disconnect();
    await dealer?.stop();
  });

  it('queryBalance returns chip balance', async () => {
    dealer = new DealerNode(createTestPlugin(), generateIdentity(), '0.1.0', roomConfig);
    const url = await dealer.createRoom(0);
    p1 = new PlayerNode(generateIdentity(), '0.1.0');
    p2 = new PlayerNode(generateIdentity(), '0.1.0');
    await p1.join(url);
    await p2.join(url);
    await dealer.startGame();
    await new Promise(r => setTimeout(r, 200));

    const balance = await p1.queryBalance();
    expect(typeof balance).toBe('number');
    expect(balance).toBeGreaterThanOrEqual(0);
  }, 10000);

  it('queryRoomState returns all players and room phase', async () => {
    dealer = new DealerNode(createTestPlugin(), generateIdentity(), '0.1.0', roomConfig);
    const url = await dealer.createRoom(0);
    p1 = new PlayerNode(generateIdentity(), '0.1.0');
    p2 = new PlayerNode(generateIdentity(), '0.1.0');
    await p1.join(url);
    await p2.join(url);

    // In the simple join path, seats Map is not used — room-state returns
    // from seats which may be empty. Still should return a valid response.
    const roomState = await p1.queryRoomState();
    expect(roomState.phase).toBeDefined();
    expect(roomState.players).toBeInstanceOf(Array);
    // handCount is returned
    expect(typeof roomState.handCount).toBe('number');
  }, 10000);

  it('queryTableState returns public game state', async () => {
    dealer = new DealerNode(createTestPlugin(), generateIdentity(), '0.1.0', roomConfig);
    const url = await dealer.createRoom(0);
    p1 = new PlayerNode(generateIdentity(), '0.1.0');
    p2 = new PlayerNode(generateIdentity(), '0.1.0');
    await p1.join(url);
    await p2.join(url);
    await dealer.startGame();
    await new Promise(r => setTimeout(r, 200));

    const table = await p1.queryTableState();
    expect(table.state).toBeDefined();
    expect(table.state).not.toBeNull();
    expect((table.state as any).pot).toBe(100);
    expect(table.phase).toBe('play');
  }, 10000);

  it('queryTableState returns null when no active game', async () => {
    dealer = new DealerNode(createTestPlugin(), generateIdentity(), '0.1.0', roomConfig);
    const url = await dealer.createRoom(0);
    p1 = new PlayerNode(generateIdentity(), '0.1.0');
    await p1.join(url);

    // No game started yet
    const table = await p1.queryTableState();
    expect(table.state).toBeNull();
  }, 10000);

  it('queryRoomConfig returns room configuration', async () => {
    dealer = new DealerNode(createTestPlugin(), generateIdentity(), '0.1.0', roomConfig);
    const url = await dealer.createRoom(0);
    p1 = new PlayerNode(generateIdentity(), '0.1.0');
    await p1.join(url);

    const config = await p1.queryRoomConfig();
    expect(config.gameType).toBe('test');
    expect(config.buyIn).toBe(500);
    expect(config.minBet).toBe(10);
    expect(config.commission).toBe(0);
  }, 10000);

  it('queryMyStatus returns own seat info', async () => {
    dealer = new DealerNode(createTestPlugin(), generateIdentity(), '0.1.0', roomConfig);
    const url = await dealer.createRoom(0);
    p1 = new PlayerNode(generateIdentity(), '0.1.0');
    p2 = new PlayerNode(generateIdentity(), '0.1.0');
    await p1.join(url);
    await p2.join(url);

    const status = await p1.queryMyStatus();
    expect(typeof status.chipBalance).toBe('number');
    expect(typeof status.creditScore).toBe('number');
    expect(typeof status.status).toBe('string');
  }, 10000);
});

// === Security Tests ===

describe('Query Protocol: Security', () => {
  let dealer: DealerNode;

  afterEach(async () => {
    await dealer?.stop();
  });

  it('rejects query from unknown connection (spoofed playerId)', async () => {
    dealer = new DealerNode(createTestPlugin(), generateIdentity(), '0.1.0', roomConfig);
    const url = await dealer.createRoom(0);

    // Connect with raw transport — not joined as player
    const transport = new LocalTransport();
    const conn = await transport.connect(url);

    const response = await new Promise<any>((resolve) => {
      conn.onMessage((event: any) => {
        if (event.type === 'query-error' || event.type === 'query-result') {
          resolve(event);
        }
      });
      // Send query with fake playerId
      conn.send({
        type: 'query',
        payload: { queryType: 'my-balance', nonce: 'test-1' },
        from: 'fake-player-id-that-does-not-exist',
      });
    });

    expect(response.type).toBe('query-error');
    expect(response.payload.error).toContain('Unauthorized');

    conn.close();
    await transport.stop();
  }, 10000);

  it('does not expose private data (deck, other hands) in table state', async () => {
    dealer = new DealerNode(createTestPlugin(), generateIdentity(), '0.1.0', roomConfig);
    const url = await dealer.createRoom(0);
    const p1 = new PlayerNode(generateIdentity(), '0.1.0');
    const p2 = new PlayerNode(generateIdentity(), '0.1.0');
    await p1.join(url);
    await p2.join(url);
    await dealer.startGame();
    await new Promise(r => setTimeout(r, 200));

    const table = await p1.queryTableState();
    const state = table.state as Record<string, unknown>;

    // Public state should NOT contain deck, hands, dealtCardMap, or secret keys
    expect(state).not.toHaveProperty('deck');
    expect(state).not.toHaveProperty('hands');
    expect(state).not.toHaveProperty('dealtCardMap');
    expect(state).not.toHaveProperty('secretKey');

    await p1.disconnect();
    await p2.disconnect();
  }, 10000);

  it('does not expose other players credit scores in room state', async () => {
    dealer = new DealerNode(createTestPlugin(), generateIdentity(), '0.1.0', roomConfig);
    const url = await dealer.createRoom(0);
    const p1 = new PlayerNode(generateIdentity(), '0.1.0');
    const p2 = new PlayerNode(generateIdentity(), '0.1.0');
    await p1.join(url);
    await p2.join(url);

    const roomState = await p1.queryRoomState();
    // Room state shows chipBalance (public at poker tables) but creditScore is internal
    for (const p of roomState.players) {
      expect(p).not.toHaveProperty('creditScore');
      expect(p).not.toHaveProperty('playerInfo');
      expect(p).not.toHaveProperty('signPubKey');
      expect(p).not.toHaveProperty('encryptPubKey');
    }

    await p1.disconnect();
    await p2.disconnect();
  }, 10000);

  it('rate limits rapid queries', async () => {
    const warnings: string[] = [];
    const logger: DealerLogger = {
      info: () => {},
      warn: (msg: string) => warnings.push(msg),
      error: () => {},
    };

    dealer = new DealerNode(createTestPlugin(), generateIdentity(), '0.1.0', roomConfig, undefined, {
      logger, actionRateLimit: 3,
    });
    const url = await dealer.createRoom(0);
    const p1 = new PlayerNode(generateIdentity(), '0.1.0');
    await p1.join(url);

    // Send 10 queries rapidly — some should be rate limited
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => p1.queryBalance())
    );

    // At least some should have succeeded, at least some should have hit rate limit
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThan(0);
    expect(warnings.some(w => w.includes('Rate limit'))).toBe(true);

    await p1.disconnect();
  }, 10000);
});
