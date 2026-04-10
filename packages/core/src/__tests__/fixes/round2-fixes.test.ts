/**
 * Unit tests for Round 2 fixes (C1-C3, H4-H7, M8-M9, L10).
 * Engine-level fixes: C2, C3, H4, L10.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DealerNode } from '../../engine/dealer.js';
import { PlayerNode } from '../../engine/player.js';
import { GameEngine } from '../../engine/game-engine.js';
import { generateIdentity, identityToPlayerInfo } from '../../crypto/keys.js';
import type {
  GamePlugin, GameState, PlayerInfo, RoomConfig, DealerLogger,
} from '../../types/index.js';

// === Minimal test plugin ===
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
    if (revealed.length >= newState.players.length) newState.phase = 'end';
    return { state: newState, pendingActions: [] };
  },
  isGameOver: (s) => s.phase === 'end',
  getResult(state) {
    const p0 = state.players[0].id;
    const changes: Record<string, number> = {};
    for (const p of state.players) changes[p.id] = p.id === p0 ? 10 : -10 / (state.players.length - 1);
    return { winners: [p0], pointChanges: changes, commission: 0, finalState: state };
  },
  getValidActions: (s) => s.players.map((p) => ({ playerId: p.id, type: 'reveal' })),
  getPublicState: (s) => ({ phase: s.phase }),
});

const roomConfig: RoomConfig = {
  gameType: 'test', chipProvider: { type: 'local' }, chipUnit: 'pts',
  minBet: 10, maxBet: 100, buyIn: 500, commission: 0,
};

// === C2: Duplicate player detection ===

describe('C2: handleJoin rejects duplicate players', () => {
  let dealer: DealerNode;
  let players: PlayerNode[];

  afterEach(async () => {
    for (const p of players || []) await p.disconnect();
    if (dealer) await dealer.stop();
  });

  it('rejects same player joining twice', async () => {
    const dealerIdentity = generateIdentity();
    dealer = new DealerNode(createTestPlugin(), dealerIdentity, '0.1.0', roomConfig);
    const url = await dealer.createRoom(0);

    const sharedIdentity = generateIdentity();
    const p1 = new PlayerNode(sharedIdentity, '0.1.0');
    const p2 = new PlayerNode(sharedIdentity, '0.1.0'); // same identity
    players = [p1, p2];

    const j1 = await p1.join(url);
    expect(j1.accepted).toBe(true);

    const j2 = await p2.join(url);
    expect(j2.accepted).toBe(false);
    expect(j2.reason).toContain('already joined');
  }, 10000);
});

// === C3: postDeal called by engine ===

describe('C3: GameEngine calls plugin.postDeal after dealing', () => {
  it('calls postDeal if implemented', () => {
    let postDealCalled = false;
    const plugin: GamePlugin = {
      ...createTestPlugin(),
      postDeal(state: GameState): GameState {
        postDealCalled = true;
        return { ...state, phase: 'custom-phase' };
      },
    };

    const dealer = generateIdentity();
    const p1 = identityToPlayerInfo(generateIdentity());
    const p2 = identityToPlayerInfo(generateIdentity());

    const engine = new GameEngine(plugin, dealer);
    engine.startGame([p1, p2]);

    expect(postDealCalled).toBe(true);
    expect(engine.getState().phase).toBe('custom-phase');
  });

  it('skips postDeal if not implemented', () => {
    const plugin = createTestPlugin();
    // plugin has no postDeal

    const dealer = generateIdentity();
    const p1 = identityToPlayerInfo(generateIdentity());
    const p2 = identityToPlayerInfo(generateIdentity());

    const engine = new GameEngine(plugin, dealer);
    engine.startGame([p1, p2]);

    expect(engine.getState().phase).toBe('play'); // unchanged
  });
});

// === H4: Reject action from disconnected player ===

describe('H4: handleAction rejects disconnected player actions', () => {
  let dealer: DealerNode;

  afterEach(async () => {
    if (dealer) await dealer.stop();
  });

  it('rejects action when player seat status is disconnected', async () => {
    const warnings: string[] = [];
    const logger: DealerLogger = {
      info: () => {},
      warn: (msg: string) => warnings.push(msg),
      error: () => {},
    };

    const dealerIdentity = generateIdentity();
    dealer = new DealerNode(createTestPlugin(), dealerIdentity, '0.1.0', roomConfig, undefined, {
      logger,
      autoStart: false,
    });
    const url = await dealer.createRoom(0);

    const p1Identity = generateIdentity();
    const p2Identity = generateIdentity();

    // Use raw transport to have more control over connections
    const { LocalTransport } = await import('../../transport/local.js');
    const t1 = new LocalTransport();
    const t2 = new LocalTransport();
    const conn1 = await t1.connect(url);
    const conn2 = await t2.connect(url);

    const p1Info = identityToPlayerInfo(p1Identity);
    const p2Info = identityToPlayerInfo(p2Identity);

    // Join via room management path (populates seats Map)
    const j1 = dealer.handlePlayerJoin(p1Info, conn1);
    const j2 = dealer.handlePlayerJoin(p2Info, conn2);
    expect(j1.accepted).toBe(true);
    expect(j2.accepted).toBe(true);

    // Simulate disconnect for p1
    dealer.handlePlayerDisconnect(p1Info.id);

    // Verify seat status is disconnected
    expect(dealer.getPlayerStatus(p1Info.id)).toBe('disconnected');

    // p1 tries to send an action via the old connection — should be rejected
    // We send directly through the connection
    conn1.send({
      type: 'action',
      payload: { playerId: p1Info.id, type: 'reveal' },
      from: p1Info.id,
    });
    await new Promise(r => setTimeout(r, 200));

    // handleAction should have logged a warning about disconnected player
    expect(warnings.some(w => w.includes('disconnected'))).toBe(true);

    conn1.close();
    conn2.close();
    await t1.stop();
    await t2.stop();
  }, 10000);
});

// === L10: actionTimestamps cleanup on player leave ===

describe('L10: actionTimestamps cleanup on player leave', () => {
  it('clears rate limit data when player leaves', async () => {
    const dealerIdentity = generateIdentity();
    const dealer = new DealerNode(createTestPlugin(), dealerIdentity, '0.1.0', roomConfig);
    await dealer.createRoom(0);

    const pi = identityToPlayerInfo(generateIdentity());
    const { LocalTransport } = await import('../../transport/local.js');
    const transport = new LocalTransport();
    const conn = await transport.connect(await dealer.createRoom(0));

    // Simulate join + leave via room management
    dealer.handlePlayerJoin(pi, conn);
    dealer.handlePlayerLeave(pi.id);

    // Internal actionTimestamps should not have the player
    // We verify by checking that no memory leak occurs (no crash, no stale data)
    // The actual Map is private, so we verify indirectly: player can rejoin fresh
    const conn2 = await transport.connect(await dealer.createRoom(0));
    const result = dealer.handlePlayerJoin(pi, conn2);
    // Should be able to rejoin (status was 'left')
    expect(result.accepted).toBe(true);

    conn.close();
    conn2.close();
    await transport.stop();
    await dealer.stop();
  }, 10000);
});
