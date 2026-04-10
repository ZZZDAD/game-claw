/**
 * Unit tests for Round 2 Texas Hold'em fixes: C1, M9.
 */
import { describe, it, expect } from 'vitest';
import { generateIdentity, identityToPlayerInfo, GameEngine } from '@game-claw/core';
import type { GameState, PlayerInfo } from '@game-claw/core';
import { TexasHoldemPlugin } from '../plugin.js';

const plugin = new TexasHoldemPlugin();

function createPlayers(n: number): PlayerInfo[] {
  return Array.from({ length: n }, () => identityToPlayerInfo(generateIdentity()));
}

// === C1: Infinite loop guard in next-player selection ===

describe('C1: Next player loop guard prevents infinite loop', () => {
  it('ends the hand when all remaining players are folded or all-in', () => {
    const players = createPlayers(3);
    let state = plugin.createGame(players, { buttonIndex: 0 });
    state.phase = 'flop';
    state.roundData.pot = 100;
    state.roundData.currentBet = 0;
    state.roundData.lastRaiseSize = 0;
    state.roundData.totalContributions = {
      [players[0].id]: 30, [players[1].id]: 30, [players[2].id]: 40,
    };
    state.roundData.bets = { [players[0].id]: 0, [players[1].id]: 0, [players[2].id]: 0 };
    state.roundData.actedInRound = { [players[0].id]: false, [players[1].id]: false, [players[2].id]: false };
    state.roundData.folded = { [players[0].id]: true, [players[1].id]: false, [players[2].id]: false };
    state.roundData.allIn = { [players[0].id]: false, [players[1].id]: true, [players[2].id]: false };
    state.currentPlayerIndex = 2;
    state.roundData.stacks = { [players[0].id]: 0, [players[1].id]: 0, [players[2].id]: 50 };

    // Player 2 goes all-in — now all remaining are folded or all-in
    const result = plugin.applyAction(state, {
      playerId: players[2].id,
      type: 'all-in',
      payload: { amount: 50 },
    });

    // Should end the hand, not infinite loop
    expect(result.state.phase).toBe('end');
  });

  it('handles 2-player case where opponent folds', () => {
    const players = createPlayers(2);
    let state = plugin.createGame(players, { buttonIndex: 0 });
    state.phase = 'flop';
    state.roundData.pot = 20;
    state.roundData.currentBet = 10;
    state.roundData.lastRaiseSize = 10;
    state.roundData.totalContributions = { [players[0].id]: 10, [players[1].id]: 10 };
    state.roundData.bets = { [players[0].id]: 10, [players[1].id]: 10 };
    state.roundData.actedInRound = { [players[0].id]: false, [players[1].id]: false };
    state.roundData.folded = { [players[0].id]: false, [players[1].id]: false };
    state.roundData.allIn = { [players[0].id]: false, [players[1].id]: false };
    state.currentPlayerIndex = 0;

    // Player 0 folds — only player 1 left
    const result = plugin.applyAction(state, { playerId: players[0].id, type: 'fold' });
    expect(result.state.phase).toBe('end');
  });
});

// === M9: oddChipWinner findIndex guard ===

describe('M9: oddChipWinner findIndex guard', () => {
  it('handles getResult without crashing on a real game', () => {
    const players = createPlayers(3);
    const dealer = generateIdentity();
    const engine = new GameEngine(plugin, dealer);
    engine.startGame(players, { buttonIndex: 0 });

    // Play through to showdown: everyone checks
    let rounds = 0;
    while (!engine.isOver() && rounds < 50) {
      const actions = engine.getValidActions();
      if (actions.length === 0) break;
      const action = actions.find(a => a.type === 'check')
        ?? actions.find(a => a.type === 'call')
        ?? actions[0];
      engine.submitAction(action);
      rounds++;
    }

    expect(engine.isOver()).toBe(true);
    const result = engine.getResult();
    expect(result.winners.length).toBeGreaterThan(0);

    // Zero-sum (with commission=0)
    const sum = Object.values(result.pointChanges).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
  });
});
