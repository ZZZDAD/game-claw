/**
 * Unit tests for Round 2 Blackjack fixes: H5, H6, C3 (postDeal integration).
 */
import { describe, it, expect } from 'vitest';
import { generateIdentity, identityToPlayerInfo, GameEngine } from '@game-claw/core';
import type { GameState, Card, PlayerInfo } from '@game-claw/core';
import { BlackjackPlugin, handValue, isNatural21 } from '../plugin.js';

const plugin = new BlackjackPlugin();

function createPlayers(n: number): PlayerInfo[] {
  return Array.from({ length: n }, () => identityToPlayerInfo(generateIdentity()));
}

// === C3: postDeal called by GameEngine ===

describe('C3: Blackjack postDeal is called by GameEngine', () => {
  it('transitions from dealing to playing/insurance/end after startGame', () => {
    const dealer = generateIdentity();
    const players = createPlayers(3);
    const engine = new GameEngine(plugin, dealer);
    engine.startGame(players, { roomConfig: { settings: { bankerIndex: 0 } } });

    const state = engine.getState();
    // postDeal should have been called — phase should NOT be 'dealing'
    expect(state.phase).not.toBe('dealing');
    expect(['playing', 'insurance', 'end']).toContain(state.phase);
  });

  it('enters insurance phase when banker shows Ace', () => {
    // Create a rigged state where banker's first card is Ace
    const players = createPlayers(3);
    const state = plugin.createGame(players, {
      roomConfig: { settings: { bankerIndex: 0, dealerPeek: true } },
    });
    state.phase = 'dealing';
    state.roundData.dealerPeek = true;

    // Give banker an Ace as first card
    state.hands[players[0].id] = [
      { id: 'spades-A', suit: 'spades', rank: 'A' },
      { id: 'hearts-5', suit: 'hearts', rank: '5' },
    ];

    const result = plugin.postDeal(state);
    expect(result.phase).toBe('insurance');
  });

  it('ends immediately when banker has natural with 10-value showing', () => {
    const players = createPlayers(3);
    const state = plugin.createGame(players, {
      roomConfig: { settings: { bankerIndex: 0, dealerPeek: true } },
    });
    state.phase = 'dealing';
    state.roundData.dealerPeek = true;

    // Give banker 10 + A = natural blackjack
    state.hands[players[0].id] = [
      { id: 'spades-10', suit: 'spades', rank: '10' },
      { id: 'hearts-A', suit: 'hearts', rank: 'A' },
    ];

    const result = plugin.postDeal(state);
    expect(result.phase).toBe('end');
    expect(result.roundData.peekSettled).toBe(true);
  });
});

// === H5: Bust check timing — refreshBustFlags ===

describe('H5: refreshBustFlags catches busts from dealt cards', () => {
  it('detects bust after cards are actually in hand', () => {
    const players = createPlayers(3);
    let state = plugin.createGame(players, {
      roomConfig: { settings: { bankerIndex: 0 } },
    });
    state.phase = 'playing';
    state.roundData.bets = { [players[1].id]: 10, [players[2].id]: 10 };
    state.roundData.stood = { [players[0].id]: false, [players[1].id]: false, [players[2].id]: false };
    state.roundData.busted = { [players[0].id]: false, [players[1].id]: false, [players[2].id]: false };
    state.roundData.surrendered = { [players[0].id]: false, [players[1].id]: false, [players[2].id]: false };
    state.roundData.hasActed = { [players[0].id]: false, [players[1].id]: false, [players[2].id]: false };
    state.currentPlayerIndex = 1;

    // Give player 1 a hand of 20 (10 + K)
    state.hands[players[1].id] = [
      { id: 'hearts-10', suit: 'hearts', rank: '10' },
      { id: 'spades-K', suit: 'spades', rank: 'K' },
    ];

    // Player hits — card hasn't been dealt yet (it's a pending action)
    const result = plugin.applyAction(state, { playerId: players[1].id, type: 'hit' });

    // The pending action should include deal-to-player
    expect(result.pendingActions.some(pa => pa.type === 'deal-to-player')).toBe(true);

    // Now simulate the engine dealing a card that busts the player
    result.state.hands[players[1].id].push({ id: 'clubs-5', suit: 'clubs', rank: '5' });
    // Hand is now 10 + K + 5 = 25 (bust!)

    // On next action, refreshBustFlags should detect the bust
    // We can test by calling getValidActions — bust player shouldn't have actions
    const busted = result.state.roundData.busted as Record<string, boolean>;
    // Manually call refresh (in real flow this happens in next applyAction)
    (plugin as any).refreshBustFlags(result.state);
    expect(busted[players[1].id]).toBe(true);
  });
});

// === H6: Split double-down includes deal-to-player ===

describe('H6: Split hand double-down pushes deal-to-player', () => {
  it('includes deal-to-player pending action on split double-down', () => {
    const players = createPlayers(3);
    let state = plugin.createGame(players, {
      roomConfig: { settings: { bankerIndex: 0, doubleAfterSplit: true } },
    });
    state.phase = 'playing';
    state.roundData.bets = { [players[1].id]: 10, [players[2].id]: 10 };
    state.roundData.stood = { [players[0].id]: false, [players[1].id]: false, [players[2].id]: false };
    state.roundData.busted = { [players[0].id]: false, [players[1].id]: false, [players[2].id]: false };
    state.roundData.surrendered = { [players[0].id]: false, [players[1].id]: false, [players[2].id]: false };
    state.roundData.hasActed = { [players[1].id]: true };
    state.roundData.doubled = {};
    state.roundData.splitHands = {
      [players[1].id]: [
        [{ id: 'hearts-8', suit: 'hearts', rank: '8' }, { id: 'diamonds-3', suit: 'diamonds', rank: '3' }],
      ],
    };
    state.roundData.splitBets = { [players[1].id]: [10] };
    state.roundData.splitStood = { [players[1].id]: [false] };
    state.roundData.splitBusted = { [players[1].id]: [false] };
    state.roundData.splitCount = { [players[1].id]: 2 };
    state.roundData.splitAces = { [players[1].id]: false };
    state.roundData.activeSplitIndex = { [players[1].id]: 0 };
    state.roundData.doubleAfterSplit = true;
    state.currentPlayerIndex = 1;

    const result = plugin.applyAction(state, { playerId: players[1].id, type: 'double-down' });

    // Must have both debit and deal-to-player
    const debit = result.pendingActions.find(pa => pa.type === 'debit');
    const deal = result.pendingActions.find(pa => pa.type === 'deal-to-player');
    expect(debit).toBeDefined();
    expect(deal).toBeDefined();
    expect((deal as any).playerId).toBe(players[1].id);
    expect((deal as any).count).toBe(1);
  });
});
