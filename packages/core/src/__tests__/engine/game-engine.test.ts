import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../engine/game-engine.js';
import { generateIdentity, identityToPlayerInfo } from '../../crypto/keys.js';
import type { GamePlugin, GameState, DealPlan, PlayerAction, GameResult, PlayerInfo } from '../../types/index.js';

// Minimal test plugin: 1-card game, player with highest card wins
const testPlugin: GamePlugin = {
  meta: { name: 'test', displayName: 'Test', minPlayers: 2, maxPlayers: 2, version: '0.1.0' },
  createDeck: () => [
    { id: 'card-1', suit: 'test', rank: '1' },
    { id: 'card-2', suit: 'test', rank: '2' },
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
  validateAction: (_state, action) => action.type === 'reveal',
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
    const p0 = state.players[0].id;
    const p1 = state.players[1].id;
    const r0 = parseInt(state.hands[p0]?.[0]?.rank ?? '0');
    const r1 = parseInt(state.hands[p1]?.[0]?.rank ?? '0');
    const winner = r0 > r1 ? p0 : p1;
    const loser = winner === p0 ? p1 : p0;
    return { winners: [winner], pointChanges: { [winner]: 10, [loser]: -10 }, commission: 0, finalState: state };
  },
  getValidActions: (s) => s.players.map((p) => ({ playerId: p.id, type: 'reveal' })),
  getPublicState: (s) => ({ phase: s.phase, revealed: s.roundData.revealed }),
};

describe('GameEngine', () => {
  it('runs a full game with crypto dealing and verification', () => {
    const dealer = generateIdentity();
    const p1Identity = generateIdentity();
    const p2Identity = generateIdentity();
    const players = [identityToPlayerInfo(p1Identity), identityToPlayerInfo(p2Identity)];

    const engine = new GameEngine(testPlugin, dealer);
    const { commitments } = engine.startGame(players);

    // Each player got 1 commitment
    expect(commitments).toHaveLength(2);

    // Player 1 decrypts their card
    const p1Commitment = commitments.find((c) => c.targetPlayerId === players[0].id)!;
    const p1Card = engine.decryptCard(p1Commitment, p1Identity.encryptKeyPair.secretKey);
    expect(p1Card.cardId).toBeDefined();

    // Player 2 decrypts their card
    const p2Commitment = commitments.find((c) => c.targetPlayerId === players[1].id)!;
    const p2Card = engine.decryptCard(p2Commitment, p2Identity.encryptKeyPair.secretKey);
    expect(p2Card.cardId).toBeDefined();
    expect(p1Card.cardId).not.toBe(p2Card.cardId);

    // Both players reveal
    const s1 = engine.submitAction({ playerId: players[0].id, type: 'reveal' });
    expect(s1.accepted).toBe(true);
    const s2 = engine.submitAction({ playerId: players[1].id, type: 'reveal' });
    expect(s2.accepted).toBe(true);

    // Game should be over
    expect(engine.isOver()).toBe(true);

    // Get result
    const result = engine.getResult();
    expect(result.winners).toHaveLength(1);

    // Verify all commitments
    const reveals = engine.getAllReveals();
    for (const reveal of reveals) {
      const matching = commitments.find((c) => c.cardIndex === reveal.cardIndex);
      expect(matching).toBeDefined();
      expect(engine.verifyReveal(reveal, matching!.commitment)).toBe(true);
    }
  });
});
