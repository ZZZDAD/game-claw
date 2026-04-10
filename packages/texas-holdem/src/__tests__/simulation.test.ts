import { describe, it, expect, afterEach } from 'vitest';
import { DealerNode, PlayerNode, generateIdentity, GameEngine } from '@game-claw/core';
import type { RoomConfig } from '@game-claw/core';
import { TexasHoldemPlugin } from '../plugin.js';

const roomConfig: RoomConfig = {
  gameType: 'texas-holdem', chipProvider: { type: 'local' }, chipUnit: 'pts',
  minBet: 10, maxBet: 100, buyIn: 500, commission: 2,
};

describe('Texas Hold\'em full simulation', () => {
  let dealer: DealerNode;
  let players: PlayerNode[];

  afterEach(async () => {
    for (const p of players || []) await p.disconnect();
    if (dealer) await dealer.stop();
  });

  it('runs 3 consecutive games with button rotation', async () => {
    const plugin = new TexasHoldemPlugin();

    for (let game = 0; game < 3; game++) {
      const dealerIdentity = generateIdentity();
      dealer = new DealerNode(plugin, dealerIdentity, '0.1.0', roomConfig);
      const url = await dealer.createRoom(0);

      const botIdentities = Array.from({ length: 4 }, () => generateIdentity());
      players = botIdentities.map((id) => new PlayerNode(id, '0.1.0'));

      for (const p of players) {
        const result = await p.join(url);
        expect(result.accepted).toBe(true);
      }

      // Button rotates each game: game 0 → btn=0, game 1 → btn=1, game 2 → btn=2
      await dealer.startGame({ buttonIndex: game });
      await new Promise((r) => setTimeout(r, 300));

      // Each player should have 2 hole cards
      for (const p of players) {
        expect(p.getHand()).toHaveLength(2);
      }

      // Verify button position is correct
      const engine = dealer.getEngine();
      const state = engine.getState();
      expect(state.roundData.buttonIndex).toBe(game);

      // Simulate betting: all check/call through all rounds
      let rounds = 0;
      while (!engine.isOver() && rounds < 50) {
        const validActions = engine.getValidActions();
        if (validActions.length === 0) break;

        const action = validActions.find((a) => a.type === 'check')
          ?? validActions.find((a) => a.type === 'call')
          ?? validActions[0];

        const playerNode = players.find((p) => p.getPlayerId() === action.playerId);
        if (playerNode) {
          await playerNode.sendAction(action);
          await new Promise((r) => setTimeout(r, 50));
        }

        // Deal community cards when phase changes
        const currentState = engine.getState();
        if (['flop', 'turn', 'river'].includes(currentState.phase) &&
            currentState.communityCards.length < getExpectedCommunityCards(currentState.phase)) {
          engine.dealNextPhase();
        }

        rounds++;
      }

      expect(engine.isOver()).toBe(true);

      // Verify all commitments (including burn cards)
      const reveals = engine.getAllReveals();
      const commitments = engine.getCommitments();

      // Should have burn card commitments
      const burnCommitments = commitments.filter((c) => c.targetPlayerId === 'burn');
      expect(burnCommitments.length).toBeGreaterThan(0);

      // All reveals should verify
      for (const reveal of reveals) {
        const matching = commitments.find((c) => c.cardIndex === reveal.cardIndex);
        expect(matching).toBeDefined();
        expect(engine.verifyReveal(reveal, matching!.commitment)).toBe(true);
      }

      const result = engine.getResult();
      expect(result.winners.length).toBeGreaterThan(0);

      for (const p of players) await p.disconnect();
      await dealer.stop();
    }
  }, 30000);

  it('handles fold correctly — last player wins', async () => {
    const plugin = new TexasHoldemPlugin();
    const dealerIdentity = generateIdentity();
    dealer = new DealerNode(plugin, dealerIdentity, '0.1.0', roomConfig);
    const url = await dealer.createRoom(0);

    const botIdentities = Array.from({ length: 3 }, () => generateIdentity());
    players = botIdentities.map((id) => new PlayerNode(id, '0.1.0'));

    for (const p of players) {
      await p.join(url);
    }
    await dealer.startGame();
    await new Promise((r) => setTimeout(r, 200));

    const engine = dealer.getEngine();

    // First player folds
    const actions1 = engine.getValidActions();
    const fold1 = actions1.find((a) => a.type === 'fold')!;
    await players.find((p) => p.getPlayerId() === fold1.playerId)!.sendAction(fold1);
    await new Promise((r) => setTimeout(r, 50));

    // Second active player folds
    const actions2 = engine.getValidActions();
    const fold2 = actions2.find((a) => a.type === 'fold')!;
    await players.find((p) => p.getPlayerId() === fold2.playerId)!.sendAction(fold2);
    await new Promise((r) => setTimeout(r, 100));

    expect(engine.isOver()).toBe(true);
    const result = engine.getResult();
    expect(result.winners).toHaveLength(1);
  }, 10000);
});

function getExpectedCommunityCards(phase: string): number {
  switch (phase) {
    case 'flop': return 3;
    case 'turn': return 4;
    case 'river': return 5;
    default: return 0;
  }
}
