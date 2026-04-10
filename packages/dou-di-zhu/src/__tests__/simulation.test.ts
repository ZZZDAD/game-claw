import { describe, it, expect, afterEach } from 'vitest';
import { DealerNode, PlayerNode, generateIdentity } from '@game-claw/core';
import type { RoomConfig } from '@game-claw/core';
import { DouDiZhuPlugin } from '../plugin.js';

const roomConfig: RoomConfig = {
  gameType: 'dou-di-zhu', chipProvider: { type: 'local' }, chipUnit: 'pts',
  minBet: 10, maxBet: 100, buyIn: 500, commission: 2,
};

describe('Dou Di Zhu full simulation', () => {
  let dealer: DealerNode;
  let players: PlayerNode[];

  afterEach(async () => {
    for (const p of players || []) await p.disconnect();
    if (dealer) await dealer.stop();
  });

  it('runs 5 full games with 3 bot players', async () => {
    const plugin = new DouDiZhuPlugin();

    for (let game = 0; game < 5; game++) {
      const dealerIdentity = generateIdentity();
      dealer = new DealerNode(plugin, dealerIdentity, '0.1.0', roomConfig);
      const url = await dealer.createRoom(0);

      const botIdentities = Array.from({ length: 3 }, () => generateIdentity());
      players = botIdentities.map((id) => new PlayerNode(id, '0.1.0'));

      for (const p of players) {
        const result = await p.join(url);
        expect(result.accepted).toBe(true);
      }

      await dealer.startGame();
      await new Promise((r) => setTimeout(r, 300));

      // Each player should have 17 cards
      for (const p of players) {
        expect(p.getHand()).toHaveLength(17);
      }

      const engine = dealer.getEngine();
      let turns = 0;

      // Pre-bidding phase: first player sends ready
      if (engine.getState().phase === 'pre-bidding') {
        const currentPlayer = engine.getState().players[engine.getState().currentPlayerIndex];
        const playerNode = players.find((p) => p.getPlayerId() === currentPlayer.id);
        if (playerNode) {
          await playerNode.sendAction({ playerId: currentPlayer.id, type: 'ready' });
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      // Bidding phase: bots bid randomly
      while (engine.getState().phase === 'bidding' && turns < 10) {
        const validActions = engine.getValidActions();
        // Filter out show-cards actions for simplicity
        const bidActions = validActions.filter((a) => a.type === 'bid');
        if (bidActions.length === 0) break;

        // First bot bids 1, rest pass
        const action = turns === 0
          ? bidActions.find((a) => (a.payload as { bid: number })?.bid === 1) ?? bidActions[0]
          : bidActions[0]; // pass

        const playerNode = players.find((p) => p.getPlayerId() === action.playerId);
        if (playerNode) {
          await playerNode.sendAction(action);
          await new Promise((r) => setTimeout(r, 50));
        }
        turns++;
      }

      // After bidding, check if redeal
      let state = engine.getState();
      if (state.phase === 'redeal') {
        expect(engine.isOver()).toBe(true);
        const result = engine.getResult();
        expect(result.winners).toEqual([]);
        for (const p of players) await p.disconnect();
        await dealer.stop();
        continue;
      }

      expect(state.phase).toBe('dealing-landlord');
      const landlordId = state.roundData.landlord as string;

      // Deal 3 bottom cards to landlord, then set phase to 'doubling'
      engine.dealCardToPlayer(landlordId);
      engine.dealCardToPlayer(landlordId);
      engine.dealCardToPlayer(landlordId);
      state = engine.getState();
      state.phase = 'doubling';

      // Landlord should have 20 cards (17 + 3)
      expect(state.hands[landlordId].length).toBe(20);

      // Doubling phase: all players pass-double
      for (const p of state.players) {
        const playerNode = players.find((pn) => pn.getPlayerId() === p.id);
        if (playerNode) {
          await playerNode.sendAction({ playerId: p.id, type: 'pass-double' });
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      state = engine.getState();
      expect(state.phase).toBe('playing');

      // Playing phase: bots play the first valid card combination
      turns = 0;
      while (!engine.isOver() && turns < 200) {
        const validActions = engine.getValidActions();
        if (validActions.length === 0) break;

        // Bot strategy: play the first valid card play, or pass if must
        const playAction = validActions.find((a) => a.type === 'play-cards');
        const action = playAction ?? validActions.find((a) => a.type === 'pass') ?? validActions[0];

        const playerNode = players.find((p) => p.getPlayerId() === action.playerId);
        if (playerNode) {
          await playerNode.sendAction(action);
          await new Promise((r) => setTimeout(r, 30));
        }
        turns++;
      }

      expect(engine.isOver()).toBe(true);

      // Verify all card commitments
      const reveals = engine.getAllReveals();
      const commitments = engine.getCommitments();
      for (const reveal of reveals) {
        const matching = commitments.find((c) => c.cardIndex === reveal.cardIndex);
        expect(matching).toBeDefined();
        expect(engine.verifyReveal(reveal, matching!.commitment)).toBe(true);
      }

      // Check result
      const result = engine.getResult();
      expect(result.winners.length).toBeGreaterThan(0);

      // Check someone actually ran out of cards
      const finalState = engine.getState();
      const emptyHandPlayer = finalState.players.find((p) => (finalState.hands[p.id]?.length ?? 0) === 0);
      expect(emptyHandPlayer).toBeDefined();

      for (const p of players) await p.disconnect();
      await dealer.stop();
    }
  }, 60000);
});
