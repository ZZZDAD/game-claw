import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DealerNode } from '../../engine/dealer.js';
import { generateIdentity, identityToPlayerInfo } from '../../crypto/keys.js';
import type {
  GamePlugin, GameState, DealPlan, PlayerAction, GameResult, PlayerInfo, RoomConfig,
} from '../../types/index.js';

// Simple 2-player test plugin: each player reveals, game ends when both reveal
function createTestPlugin(): GamePlugin {
  return {
    meta: { name: 'test', displayName: 'Test', minPlayers: 2, maxPlayers: 4, version: '0.1.0' },
    createDeck: () => [
      { id: 'card-1', suit: 'test', rank: '1' },
      { id: 'card-2', suit: 'test', rank: '2' },
      { id: 'card-3', suit: 'test', rank: '3' },
      { id: 'card-4', suit: 'test', rank: '4' },
    ],
    createGame(players: PlayerInfo[]): GameState {
      return {
        phase: 'play',
        players,
        hands: {},
        communityCards: [],
        currentPlayerIndex: 0,
        roundData: { revealed: [] as string[] },
        deck: [],
        dealtCardMap: new Map(),
      };
    },
    getDealPlan(state: GameState): DealPlan[] {
      return [{
        phase: 'deal',
        deals: state.players.map((p) => ({ target: p.id, count: 1, faceUp: false })),
      }];
    },
    validateAction(_state, action) {
      return action.type === 'reveal';
    },
    applyAction(state, action) {
      const newState = structuredClone(state);
      const revealed = newState.roundData.revealed as string[];
      revealed.push(action.playerId);
      newState.roundData.revealed = revealed;
      if (revealed.length >= newState.players.length) newState.phase = 'end';
      else newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % newState.players.length;
      return { state: newState, pendingActions: [] };
    },
    isGameOver: (s) => s.phase === 'end',
    getResult(state) {
      const pointChanges: Record<string, number> = {};
      for (const p of state.players) {
        pointChanges[p.id] = p.id === state.players[0].id ? 10 : -10;
      }
      return { winners: [state.players[0].id], pointChanges, commission: 0, finalState: state };
    },
    getValidActions: (s) => s.players.map((p) => ({ playerId: p.id, type: 'reveal' })),
    getAutoAction(_state, playerId) {
      return { playerId, type: 'reveal' };
    },
    getPublicState: (s) => ({ phase: s.phase, revealed: s.roundData.revealed }),
  };
}

function createRoomConfig(): RoomConfig {
  return {
    gameType: 'test',
    chipProvider: { type: 'local' },
    chipUnit: 'chips',
    minBet: 1,
    maxBet: 100,
    buyIn: 1000,
    commission: 0,
  };
}

function createMockConnection(): { conn: any; sent: any[]; triggerClose: () => void } {
  const sent: any[] = [];
  const closeHandlers: (() => void)[] = [];
  const conn = {
    send: vi.fn((event: any) => sent.push(event)),
    onMessage: vi.fn(),
    onClose: vi.fn((handler: () => void) => closeHandlers.push(handler)),
    close: vi.fn(),
    isAlive: true,
  };
  // Simulate connection drop -- fires all onClose handlers
  const triggerClose = () => {
    conn.isAlive = false;
    closeHandlers.forEach((h) => h());
  };
  return { conn, sent, triggerClose };
}

describe('DealerNode (room management)', () => {
  let plugin: GamePlugin;
  let identity: ReturnType<typeof generateIdentity>;
  let roomConfig: RoomConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    plugin = createTestPlugin();
    identity = generateIdentity();
    roomConfig = createRoomConfig();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createDealer(overrides: Record<string, unknown> = {}) {
    return new DealerNode(plugin, identity, '1.0.0', roomConfig, undefined, {
      actionTimeout: 30000,
      betweenHandsDelay: 10000,
      autoStart: false,
      ...overrides,
    });
  }

  function createPlayer() {
    const id = generateIdentity();
    const info = identityToPlayerInfo(id);
    const { conn, sent, triggerClose } = createMockConnection();
    return { identity: id, info, conn, sent, triggerClose };
  }

  // --- Room phase transitions ---

  it('transitions idle -> waiting on createRoom', async () => {
    const dealer = createDealer();
    expect(dealer.getPhase()).toBe('idle');
    await dealer.createRoom(0);
    expect(dealer.getPhase()).toBe('waiting');
    await dealer.stop();
  });

  it('transitions waiting -> playing -> settling -> between-hands', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const phases: string[] = [];
    dealer.onPhaseChange((p) => phases.push(p));

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    await dealer.startNextHand();
    expect(dealer.getPhase()).toBe('playing');

    // Both players act
    const engine = dealer.getEngine();
    const state = engine.getState();
    dealer.submitAction({ playerId: state.players[0].id, type: 'reveal' });
    dealer.submitAction({ playerId: state.players[1].id, type: 'reveal' });

    // After game over, phase should be between-hands
    expect(dealer.getPhase()).toBe('between-hands');
    expect(phases).toContain('playing');
    expect(phases).toContain('settling');
    expect(phases).toContain('between-hands');

    await dealer.stop();
  });

  // --- Player join during waiting ---

  it('allows player join during waiting phase', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const result = dealer.handlePlayerJoin(p1.info, p1.conn);
    expect(result.accepted).toBe(true);
    expect(dealer.getPlayerStatus(p1.info.id)).toBe('seated');

    await dealer.stop();
  });

  it('rejects player join during playing phase', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);
    await dealer.startNextHand();

    const p3 = createPlayer();
    const result = dealer.handlePlayerJoin(p3.info, p3.conn);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('playing');

    await dealer.stop();
  });

  // --- Player disconnect -> timeout -> auto-action ---

  it('auto-acts on timeout when player disconnects', async () => {
    const dealer = createDealer({ actionTimeout: 100 });
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    await dealer.startNextHand();
    const engine = dealer.getEngine();
    const state = engine.getState();
    const currentPlayerId = state.players[state.currentPlayerIndex].id;

    // Simulate WebSocket connection drop
    const currentPlayer = currentPlayerId === p1.info.id ? p1 : p2;
    currentPlayer.triggerClose();
    expect(dealer.getPlayerStatus(currentPlayerId)).toBe('disconnected');

    // Advance timer to trigger timeout
    vi.advanceTimersByTime(150);

    // The auto-action should have been applied (getAutoAction returns 'reveal')
    const newState = engine.getState();
    const revealed = newState.roundData.revealed as string[];
    expect(revealed).toContain(currentPlayerId);

    await dealer.stop();
  });

  // --- Player reconnect ---

  it('reconnects a disconnected player', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    await dealer.startNextHand();
    // Simulate connection drop
    p1.triggerClose();
    expect(dealer.getPlayerStatus(p1.info.id)).toBe('disconnected');

    const { conn: newConn } = createMockConnection();
    const result = dealer.handlePlayerReconnect(p1.info.id, newConn);
    expect(result.accepted).toBe(true);
    expect(dealer.getPlayerStatus(p1.info.id)).toBe('playing');

    await dealer.stop();
  });

  it('forces leave when reconnect timeout expires', async () => {
    const dealer = createDealer({ actionTimeout: 5000, reconnectTimeout: 200 });
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    // Disconnect p1 via connection drop
    p1.triggerClose();
    expect(dealer.getPlayerStatus(p1.info.id)).toBe('disconnected');

    // Advance past reconnect timeout
    vi.advanceTimersByTime(300);

    // Should be forced to 'left' with credit penalty
    expect(dealer.getPlayerStatus(p1.info.id)).toBe('left');
    const seat = dealer.getSeatInfo(p1.info.id);
    expect(seat!.creditScore).toBeLessThan(100); // penalized

    await dealer.stop();
  });

  it('auto-detects disconnect when WebSocket closes (via onClose)', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    expect(dealer.getPlayerStatus(p1.info.id)).toBe('seated');

    // Track disconnect event
    let disconnectedId = '';
    dealer.onPlayerDisconnect((id) => { disconnectedId = id; });

    // Simulate WebSocket close
    p1.triggerClose();

    expect(dealer.getPlayerStatus(p1.info.id)).toBe('disconnected');
    expect(disconnectedId).toBe(p1.info.id);

    await dealer.stop();
  });

  it('rejects reconnect for non-disconnected player', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);

    const { conn: newConn } = createMockConnection();
    const result = dealer.handlePlayerReconnect(p1.info.id, newConn);
    expect(result.accepted).toBe(false);

    await dealer.stop();
  });

  // --- Player sit-out ---

  it('sit-out player is skipped in next hand', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    const p3 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);
    dealer.handlePlayerJoin(p3.info, p3.conn);

    // p3 sits out
    dealer.handlePlayerSitOut(p3.info.id);
    expect(dealer.getPlayerStatus(p3.info.id)).toBe('sit-out');

    await dealer.startNextHand();

    // p3 should NOT be in the current game
    const engine = dealer.getEngine();
    const state = engine.getState();
    const playerIds = state.players.map((p) => p.id);
    expect(playerIds).not.toContain(p3.info.id);
    expect(playerIds).toContain(p1.info.id);
    expect(playerIds).toContain(p2.info.id);

    // p3 is still sit-out
    expect(dealer.getPlayerStatus(p3.info.id)).toBe('sit-out');

    await dealer.stop();
  });

  it('sit-in player resumes for next hand', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    dealer.handlePlayerSitOut(p2.info.id);
    expect(dealer.getPlayerStatus(p2.info.id)).toBe('sit-out');

    dealer.handlePlayerSitIn(p2.info.id);
    expect(dealer.getPlayerStatus(p2.info.id)).toBe('seated');

    await dealer.stop();
  });

  // --- Multi-hand loop ---

  it('plays 3 hands consecutively', async () => {
    const dealer = createDealer({ betweenHandsDelay: 50 });
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    let completedHands = 0;
    dealer.onHandComplete_cb(() => { completedHands++; });

    for (let hand = 0; hand < 3; hand++) {
      await dealer.startNextHand();
      expect(dealer.getPhase()).toBe('playing');

      const engine = dealer.getEngine();
      const state = engine.getState();
      // Both players reveal
      dealer.submitAction({ playerId: state.players[0].id, type: 'reveal' });
      dealer.submitAction({ playerId: state.players[1].id, type: 'reveal' });

      expect(dealer.getPhase()).toBe('between-hands');

      // Skip the between-hands delay for next iteration
      dealer.skipBetweenHandsDelay();
    }

    expect(completedHands).toBe(3);
    expect(dealer.getHandCount()).toBe(3);

    await dealer.stop();
  });

  // --- Player leave between hands ---

  it('handles player leaving between hands', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    const p3 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);
    dealer.handlePlayerJoin(p3.info, p3.conn);

    // Play first hand
    await dealer.startNextHand();
    const engine = dealer.getEngine();
    const state = engine.getState();
    for (const p of state.players) {
      dealer.submitAction({ playerId: p.id, type: 'reveal' });
    }
    expect(dealer.getPhase()).toBe('between-hands');

    // p3 leaves
    dealer.handlePlayerLeave(p3.info.id);
    expect(dealer.getPlayerStatus(p3.info.id)).toBe('left');

    // Can still play with p1 and p2
    dealer.skipBetweenHandsDelay();
    await dealer.startNextHand();
    const newState = dealer.getEngine().getState();
    expect(newState.players).toHaveLength(2);

    await dealer.stop();
  });

  // --- Credit score changes ---

  it('increases credit score on successful action', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    const initialScore = dealer.getSeatInfo(p1.info.id)!.creditScore;

    await dealer.startNextHand();
    const engine = dealer.getEngine();
    const state = engine.getState();

    // First player acts
    const firstPlayerId = state.players[0].id;
    dealer.submitAction({ playerId: firstPlayerId, type: 'reveal' });

    const newScore = dealer.getSeatInfo(firstPlayerId)!.creditScore;
    expect(newScore).toBe(initialScore + 1);

    await dealer.stop();
  });

  it('decreases credit score when player flees during play', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    const p3 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);
    dealer.handlePlayerJoin(p3.info, p3.conn);

    const initialScore = dealer.getSeatInfo(p3.info.id)!.creditScore;

    await dealer.startNextHand();

    // p3 leaves during play (flee)
    dealer.handlePlayerLeave(p3.info.id);
    const newScore = dealer.getSeatInfo(p3.info.id)!.creditScore;
    expect(newScore).toBe(initialScore - 5);

    await dealer.stop();
  });

  // --- New player joins between hands ---

  it('allows new player to join between hands', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    // Play a hand
    await dealer.startNextHand();
    const engine = dealer.getEngine();
    const state = engine.getState();
    for (const p of state.players) {
      dealer.submitAction({ playerId: p.id, type: 'reveal' });
    }
    expect(dealer.getPhase()).toBe('between-hands');

    // New player joins
    const p3 = createPlayer();
    const joinResult = dealer.handlePlayerJoin(p3.info, p3.conn);
    expect(joinResult.accepted).toBe(true);
    expect(dealer.getPlayerStatus(p3.info.id)).toBe('seated');

    // Start next hand -- p3 should be included
    dealer.skipBetweenHandsDelay();
    await dealer.startNextHand();
    const newState = dealer.getEngine().getState();
    const playerIds = newState.players.map((p) => p.id);
    expect(playerIds).toContain(p3.info.id);

    await dealer.stop();
  });

  // --- Room goes to waiting when below minPlayers ---

  it('goes to waiting when below minPlayers after player leaves', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    // Play a hand
    await dealer.startNextHand();
    const engine = dealer.getEngine();
    const state = engine.getState();
    for (const p of state.players) {
      dealer.submitAction({ playerId: p.id, type: 'reveal' });
    }
    expect(dealer.getPhase()).toBe('between-hands');

    // p2 leaves -- now only 1 player
    dealer.handlePlayerLeave(p2.info.id);

    // When between-hands timer fires, should go to waiting (not enough players)
    vi.advanceTimersByTime(15000);
    expect(dealer.getPhase()).toBe('waiting');

    await dealer.stop();
  });

  // --- getRoomState ---

  it('returns correct room state', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);

    const roomState = dealer.getRoomState();
    expect(roomState.phase).toBe('waiting');
    expect(roomState.seats.size).toBe(1);
    expect(roomState.handCount).toBe(0);

    await dealer.stop();
  });

  // --- Close marks all as left ---

  it('marks all players as left on close', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    await dealer.stop();

    expect(dealer.getPlayerStatus(p1.info.id)).toBe('left');
    expect(dealer.getPlayerStatus(p2.info.id)).toBe('left');
    expect(dealer.getPhase()).toBe('closed');
  });

  // --- Chip balance updated after hand ---

  it('updates chip balances after hand completion', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    const initialBalance = dealer.getSeatInfo(p1.info.id)!.chipBalance;

    await dealer.startNextHand();
    const engine = dealer.getEngine();
    const state = engine.getState();

    // The test plugin always gives +10 to player 0, -10 to player 1
    dealer.submitAction({ playerId: state.players[0].id, type: 'reveal' });
    dealer.submitAction({ playerId: state.players[1].id, type: 'reveal' });

    const winnerId = state.players[0].id;
    const loserId = state.players[1].id;
    expect(dealer.getSeatInfo(winnerId)!.chipBalance).toBe(initialBalance + 10);
    expect(dealer.getSeatInfo(loserId)!.chipBalance).toBe(initialBalance - 10);

    await dealer.stop();
  });

  // --- Rejects action when not playing ---

  it('rejects actions when not in playing phase', async () => {
    const dealer = createDealer();
    await dealer.createRoom(0);

    const p1 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);

    const result = dealer.submitAction({ playerId: p1.info.id, type: 'reveal' });
    expect(result.accepted).toBe(false);

    await dealer.stop();
  });

  // --- Room full ---

  it('rejects join when room is full', async () => {
    // maxPlayers is 4 from the plugin
    const dealer = createDealer();
    await dealer.createRoom(0);

    const players = Array.from({ length: 4 }, () => createPlayer());
    for (const p of players) {
      const result = dealer.handlePlayerJoin(p.info, p.conn);
      expect(result.accepted).toBe(true);
    }

    const extra = createPlayer();
    const result = dealer.handlePlayerJoin(extra.info, extra.conn);
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('full');

    await dealer.stop();
  });

  // --- Between-hands auto-start ---

  it('automatically starts next hand after between-hands delay', async () => {
    const dealer = createDealer({ betweenHandsDelay: 100 });
    await dealer.createRoom(0);

    const p1 = createPlayer();
    const p2 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    dealer.handlePlayerJoin(p2.info, p2.conn);

    await dealer.startNextHand();
    const engine = dealer.getEngine();
    const state = engine.getState();
    dealer.submitAction({ playerId: state.players[0].id, type: 'reveal' });
    dealer.submitAction({ playerId: state.players[1].id, type: 'reveal' });

    expect(dealer.getPhase()).toBe('between-hands');
    expect(dealer.getHandCount()).toBe(1);

    // Advance past between-hands delay
    await vi.advanceTimersByTimeAsync(150);

    expect(dealer.getPhase()).toBe('playing');
    expect(dealer.getHandCount()).toBe(2);

    await dealer.stop();
  });

  // --- Auto-start when minPlayers reached ---

  it('auto-starts game when minPlayers join', async () => {
    const dealer = createDealer({ autoStart: true });
    await dealer.createRoom(0);

    const p1 = createPlayer();
    dealer.handlePlayerJoin(p1.info, p1.conn);
    // Only 1 player, should still be waiting
    expect(dealer.getPhase()).toBe('waiting');

    const p2 = createPlayer();
    dealer.handlePlayerJoin(p2.info, p2.conn);
    // 2 players (minPlayers=2), should auto-start
    expect(dealer.getPhase()).toBe('playing');
    expect(dealer.getHandCount()).toBe(1);

    await dealer.stop();
  });
});
