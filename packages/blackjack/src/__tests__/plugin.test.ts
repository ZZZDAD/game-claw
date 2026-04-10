import { describe, it, expect } from 'vitest';
import { BlackjackPlugin, handValue, isSoft17 } from '../plugin.js';
import { generateIdentity, identityToPlayerInfo } from '@game-claw/core';
import type { Card, RoomConfig } from '@game-claw/core';

const c = (id: string): Card => {
  const [suit, rank] = id.split('-');
  return { id, suit, rank };
};

describe('BlackjackPlugin', () => {
  const plugin = new BlackjackPlugin();

  it('creates 52-card deck', () => {
    expect(plugin.createDeck()).toHaveLength(52);
  });

  it('hand value calculates correctly', () => {
    expect(handValue([c('hearts-A'), c('spades-K')])).toBe(21);
    expect(handValue([c('hearts-A'), c('spades-A')])).toBe(12);
    expect(handValue([c('hearts-K'), c('spades-Q'), c('clubs-5')])).toBe(25);
  });

  it('first player is banker by default', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    const state = plugin.createGame(players);

    expect(state.roundData.bankerId).toBe(players[0].id);
    expect(state.roundData.normalPlayerIds).toEqual([players[1].id, players[2].id]);
    expect(state.phase).toBe('betting');
    // Current player should be first normal player (index 1)
    expect(state.currentPlayerIndex).toBe(1);
  });

  it('banker can be configured via room settings', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    const roomConfig: RoomConfig = {
      gameType: 'blackjack', chipProvider: { type: 'local' }, chipUnit: 'pts',
      minBet: 10, maxBet: 100, buyIn: 200, commission: 2,
      settings: { bankerIndex: 2 },
    };
    const state = plugin.createGame(players, { roomConfig });

    expect(state.roundData.bankerId).toBe(players[2].id);
    expect(state.roundData.normalPlayerIds).toEqual([players[0].id, players[1].id]);
  });

  it('deal plan: players + banker all get encrypted cards', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    const state = plugin.createGame(players);
    const plans = plugin.getDealPlan(state);
    const plan = plans[0];

    // 2 normal players + 1 banker, each gets 2 cards = 6 deals
    expect(plan.deals).toHaveLength(6);
    // Banker's first card is faceUp (publicly revealed), second is faceDown
    const bankerDeals = plan.deals.filter((d) => d.target === players[0].id);
    expect(bankerDeals).toHaveLength(2);
    expect(bankerDeals[0].faceUp).toBe(true);   // banker's first card revealed
    expect(bankerDeals[1].faceUp).toBe(false);  // banker's hole card hidden
    // Normal player cards are all faceDown
    const normalDeals = plan.deals.filter((d) => d.target !== players[0].id);
    expect(normalDeals.every((d) => d.faceUp === false)).toBe(true);
  });

  it('betting → dealing → playing → banker-turn → end', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = state.roundData.bankerId as string;
    const p1 = players[1].id;
    const p2 = players[2].id;

    // Betting phase: p1 and p2 place bets
    expect(state.phase).toBe('betting');
    state = plugin.applyAction(state, { playerId: p1, type: 'bet', payload: { amount: 20 } }).state;
    state = plugin.applyAction(state, { playerId: p2, type: 'bet', payload: { amount: 30 } }).state;
    expect(state.phase).toBe('dealing');

    // Simulate dealing (engine does this) → set to playing
    state.phase = 'playing';
    state.hands[p1] = [c('hearts-10'), c('spades-8')]; // 18
    state.hands[p2] = [c('diamonds-5'), c('clubs-4')]; // 9
    state.hands[bankerId] = [c('hearts-K'), c('spades-6')]; // 16
    // Reset current player to first normal player
    state.currentPlayerIndex = 1;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;

    // P1 stands (18)
    state = plugin.applyAction(state, { playerId: p1, type: 'stand' }).state;

    // P2 stands (9, bad hand but player's choice)
    state = plugin.applyAction(state, { playerId: p2, type: 'stand' }).state;

    // Should be banker's turn
    expect(state.phase).toBe('banker-turn');

    // Banker has 16, must hit (< 17)
    const bankerActions = plugin.getValidActions(state);
    expect(bankerActions).toHaveLength(1);
    expect(bankerActions[0].type).toBe('hit');

    // Simulate banker getting ♣3 → 19
    state.hands[bankerId].push(c('clubs-3'));
    state = plugin.applyAction(state, { playerId: bankerId, type: 'hit' }).state;
    // 19 >= 17, not bust, still banker-turn
    expect(state.phase).toBe('banker-turn');

    // Now must stand (19 >= 17)
    const bankerActions2 = plugin.getValidActions(state);
    expect(bankerActions2[0].type).toBe('stand');
    state = plugin.applyAction(state, { playerId: bankerId, type: 'stand' }).state;

    expect(state.phase).toBe('end');

    // Result: Banker 19, P1 18 (loses), P2 9 (loses)
    const result = plugin.getResult(state);
    expect(result.pointChanges[p1]).toBe(-20);  // P1 bet 20, lost
    expect(result.pointChanges[p2]).toBe(-30);  // P2 bet 30, lost
    expect(result.pointChanges[bankerId]).toBe(50); // banker wins 20+30
  });

  it('banker pays when player wins (non-natural)', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'end';
    state.hands[p1] = [c('hearts-10'), c('spades-8'), c('clubs-2')]; // 20 (non-natural)
    state.hands[bankerId] = [c('diamonds-10'), c('clubs-8')]; // 18
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    const result = plugin.getResult(state);
    expect(result.winners).toContain(p1);
    expect(result.pointChanges[p1]).toBe(50);
    expect(result.pointChanges[bankerId]).toBe(-50);
  });

  // === Natural 21 (Blackjack) tests ===

  it('natural 21 pays 3:2', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'end';
    state.hands[p1] = [c('hearts-A'), c('spades-K')]; // natural 21
    state.hands[bankerId] = [c('diamonds-10'), c('clubs-8')]; // 18
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    const result = plugin.getResult(state);
    expect(result.winners).toContain(p1);
    expect(result.pointChanges[p1]).toBe(75); // 50 * 1.5 = 75
    expect(result.pointChanges[bankerId]).toBe(-75);
  });

  it('natural 21 vs natural 21 is a push', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'end';
    state.hands[p1] = [c('hearts-A'), c('spades-K')]; // natural 21
    state.hands[bankerId] = [c('diamonds-A'), c('clubs-Q')]; // natural 21
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    const result = plugin.getResult(state);
    expect(result.pointChanges[p1]).toBe(0); // push
    expect(result.pointChanges[bankerId]).toBe(0);
    expect(result.winners).not.toContain(p1);
  });

  it('natural 21 beats non-natural 21', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'end';
    // Banker has natural 21, player has non-natural 21 (5+6+10)
    state.hands[p1] = [c('hearts-5'), c('spades-6'), c('clubs-10')]; // 21 non-natural
    state.hands[bankerId] = [c('diamonds-A'), c('clubs-K')]; // natural 21
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    const result = plugin.getResult(state);
    expect(result.pointChanges[p1]).toBe(-50); // banker natural beats non-natural
    expect(result.pointChanges[bankerId]).toBe(50);
    expect(result.winners).not.toContain(p1);
  });

  // === Double Down tests ===

  it('double down: doubles bet, one card, then stands', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    // Set up playing phase
    state.phase = 'playing';
    state.hands[p1] = [c('hearts-5'), c('spades-6')]; // 11
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')]; // 16
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Validate double-down is allowed on 2 cards
    expect(plugin.validateAction(state, { playerId: p1, type: 'double-down' })).toBe(true);

    // Simulate engine dealing one card before applyAction
    state.hands[p1].push(c('clubs-10')); // 21
    state = plugin.applyAction(state, { playerId: p1, type: 'double-down' }).state;

    // Player should be stood (auto-stand after double down)
    expect((state.roundData.stood as Record<string, boolean>)[p1]).toBe(true);
    expect((state.roundData.doubled as Record<string, boolean>)[p1]).toBe(true);

    // Should move to banker turn since only one normal player
    expect(state.phase).toBe('banker-turn');

    // Banker stands at 16? No, must hit. Simulate getting 5 -> 21
    state.hands[bankerId].push(c('hearts-5'));
    state = plugin.applyAction(state, { playerId: bankerId, type: 'hit' }).state;
    // 21 >= 17, banker stands
    state = plugin.applyAction(state, { playerId: bankerId, type: 'stand' }).state;
    expect(state.phase).toBe('end');

    // Both 21 but player doubled: bet is 100, push
    const result = plugin.getResult(state);
    expect(result.pointChanges[p1]).toBe(0); // push (both 21, non-natural)
    expect(result.pointChanges[bankerId]).toBe(0);
  });

  it('double down: not allowed after hit', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const p1 = players[1].id;
    const bankerId = players[0].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-5'), c('spades-6'), c('clubs-2')]; // 3 cards
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    expect(plugin.validateAction(state, { playerId: p1, type: 'double-down' })).toBe(false);
  });

  it('double down with bust', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-8'), c('spades-7')]; // 15
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Deal a 10 -> 25, bust
    state.hands[p1].push(c('clubs-10'));
    state = plugin.applyAction(state, { playerId: p1, type: 'double-down' }).state;

    expect((state.roundData.busted as Record<string, boolean>)[p1]).toBe(true);
    expect(state.phase).toBe('banker-turn');

    // Banker stands
    state = plugin.applyAction(state, { playerId: bankerId, type: 'stand' }).state;
    expect(state.phase).toBe('end');

    const result = plugin.getResult(state);
    // Doubled bet = 100, lost
    expect(result.pointChanges[p1]).toBe(-100);
    expect(result.pointChanges[bankerId]).toBe(100);
  });

  // === Surrender tests ===

  it('surrender: loses half the bet', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-10'), c('spades-6')]; // 16
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-A')]; // 21
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Surrender is valid on first two cards before any action
    expect(plugin.validateAction(state, { playerId: p1, type: 'surrender' })).toBe(true);

    state = plugin.applyAction(state, { playerId: p1, type: 'surrender' }).state;
    expect((state.roundData.surrendered as Record<string, boolean>)[p1]).toBe(true);

    // Move to banker turn and end
    expect(state.phase).toBe('banker-turn');
    state = plugin.applyAction(state, { playerId: bankerId, type: 'stand' }).state;
    expect(state.phase).toBe('end');

    const result = plugin.getResult(state);
    expect(result.pointChanges[p1]).toBe(-25); // lose half of 50
    expect(result.pointChanges[bankerId]).toBe(25);
  });

  it('surrender: not allowed after an action', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const p1 = players[1].id;
    const bankerId = players[0].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-10'), c('spades-6')]; // 16
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    (state.roundData.hasActed as Record<string, boolean>)[p1] = true; // already acted
    state.currentPlayerIndex = 1;

    expect(plugin.validateAction(state, { playerId: p1, type: 'surrender' })).toBe(false);
  });

  // === Split tests ===

  it('split: two hands played independently', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-8'), c('spades-8')]; // pair of 8s
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')]; // 16
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Validate split is allowed
    expect(plugin.validateAction(state, { playerId: p1, type: 'split' })).toBe(true);

    // Split with additional cards dealt to each hand
    state = plugin.applyAction(state, {
      playerId: p1, type: 'split',
      payload: { splitCards: [c('clubs-10'), c('diamonds-3')] }
    }).state;

    const splitHands = state.roundData.splitHands as Record<string, Card[][]>;
    expect(splitHands[p1]).toHaveLength(2);
    expect(splitHands[p1][0]).toEqual([c('hearts-8'), c('clubs-10')]); // 18
    expect(splitHands[p1][1]).toEqual([c('spades-8'), c('diamonds-3')]); // 11

    const splitBets = state.roundData.splitBets as Record<string, number[]>;
    expect(splitBets[p1]).toEqual([50, 50]);

    // Play first split hand: stand at 18
    expect(plugin.validateAction(state, { playerId: p1, type: 'stand' })).toBe(true);
    state = plugin.applyAction(state, { playerId: p1, type: 'stand' }).state;

    // Now playing second split hand: hit
    const activeSplitIndex = state.roundData.activeSplitIndex as Record<string, number>;
    expect(activeSplitIndex[p1]).toBe(1);

    // Hit on second hand: add a 10 -> 21
    splitHands[p1] = (state.roundData.splitHands as Record<string, Card[][]>)[p1];
    (state.roundData.splitHands as Record<string, Card[][]>)[p1][1].push(c('hearts-10'));
    state = plugin.applyAction(state, { playerId: p1, type: 'hit' }).state;

    // Second hand at 21, not bust. Stand.
    state = plugin.applyAction(state, { playerId: p1, type: 'stand' }).state;

    // Should be banker turn now
    expect(state.phase).toBe('banker-turn');

    // Banker has 16, hits, gets 5 -> 21
    state.hands[bankerId].push(c('hearts-5'));
    state = plugin.applyAction(state, { playerId: bankerId, type: 'hit' }).state;
    state = plugin.applyAction(state, { playerId: bankerId, type: 'stand' }).state;
    expect(state.phase).toBe('end');

    // Banker 21, Hand 1: 18 loses (-50), Hand 2: 21 push (0)
    const result = plugin.getResult(state);
    expect(result.pointChanges[p1]).toBe(-50);
    expect(result.pointChanges[bankerId]).toBe(50);
  });

  it('split: not allowed with different ranks', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const p1 = players[1].id;
    const bankerId = players[0].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-8'), c('spades-9')]; // different ranks
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    expect(plugin.validateAction(state, { playerId: p1, type: 'split' })).toBe(false);
  });

  // === Insurance tests ===

  it('insurance: pays 2:1 when banker has natural 21', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    // Set up insurance phase (banker's face-up card is Ace)
    state.phase = 'insurance';
    state.hands[p1] = [c('hearts-10'), c('spades-8')]; // 18
    state.hands[bankerId] = [c('diamonds-A'), c('clubs-K')]; // natural 21
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    // Player buys max insurance (half of bet = 25)
    expect(plugin.validateAction(state, {
      playerId: p1, type: 'insurance', payload: { amount: 25 }
    })).toBe(true);

    state = plugin.applyAction(state, {
      playerId: p1, type: 'insurance', payload: { amount: 25 }
    }).state;

    // Banker has natural 21, game should end immediately
    expect(state.phase).toBe('end');

    const result = plugin.getResult(state);
    // Insurance pays 2:1: +50 from insurance
    // Main bet lost: -50 (banker natural beats 18)
    // Net: 0
    expect(result.pointChanges[p1]).toBe(0); // insurance +50, main bet -50
  });

  it('insurance: lost when banker does not have natural 21', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'insurance';
    state.hands[p1] = [c('hearts-10'), c('spades-8')]; // 18
    state.hands[bankerId] = [c('diamonds-A'), c('clubs-6')]; // 17, not natural
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;

    state = plugin.applyAction(state, {
      playerId: p1, type: 'insurance', payload: { amount: 25 }
    }).state;

    // No natural, should proceed to playing
    expect(state.phase).toBe('playing');

    // Player stands
    state = plugin.applyAction(state, { playerId: p1, type: 'stand' }).state;
    expect(state.phase).toBe('banker-turn');

    // Banker has 17, stands
    state = plugin.applyAction(state, { playerId: bankerId, type: 'stand' }).state;
    expect(state.phase).toBe('end');

    const result = plugin.getResult(state);
    // Insurance lost: -25
    // Main bet won (18 > 17): +50
    // Net: +25
    expect(result.pointChanges[p1]).toBe(25);
  });

  it('decline insurance', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'insurance';
    state.hands[p1] = [c('hearts-10'), c('spades-8')]; // 18
    state.hands[bankerId] = [c('diamonds-A'), c('clubs-K')]; // natural 21
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    expect(plugin.validateAction(state, { playerId: p1, type: 'decline-insurance' })).toBe(true);
    state = plugin.applyAction(state, { playerId: p1, type: 'decline-insurance' }).state;

    // Banker has natural, game ends
    expect(state.phase).toBe('end');

    const result = plugin.getResult(state);
    // No insurance, banker natural beats player 18
    expect(result.pointChanges[p1]).toBe(-50);
    expect(result.pointChanges[bankerId]).toBe(50);
  });

  // === getValidActions tests ===

  it('getValidActions includes double-down, split, surrender when appropriate', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const p1 = players[1].id;
    const bankerId = players[0].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-8'), c('spades-8')]; // pair, 2 cards
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    const actions = plugin.getValidActions(state);
    const types = actions.map(a => a.type);
    expect(types).toContain('hit');
    expect(types).toContain('stand');
    expect(types).toContain('double-down');
    expect(types).toContain('split');
    expect(types).toContain('surrender');
  });

  it('getValidActions for insurance phase', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const p1 = players[1].id;

    state.phase = 'insurance';
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    const actions = plugin.getValidActions(state);
    const types = actions.map(a => a.type);
    expect(types).toContain('insurance');
    expect(types).toContain('decline-insurance');
  });

  // === Feature 1: Soft 17 configurable ===

  it('isSoft17 helper identifies soft 17 correctly', () => {
    // A + 6 = soft 17
    expect(isSoft17([c('hearts-A'), c('spades-6')])).toBe(true);
    // A + 3 + 3 = soft 17
    expect(isSoft17([c('hearts-A'), c('spades-3'), c('clubs-3')])).toBe(true);
    // 10 + 7 = hard 17
    expect(isSoft17([c('hearts-10'), c('spades-7')])).toBe(false);
    // A + K + 6 = 17 but ace counts as 1 (hard 17)
    expect(isSoft17([c('hearts-A'), c('spades-K'), c('clubs-6')])).toBe(false);
    // A + 5 = 16, not 17
    expect(isSoft17([c('hearts-A'), c('spades-5')])).toBe(false);
  });

  it('soft 17: banker must hit on soft 17 when softHit17 is true', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    const roomConfig: RoomConfig = {
      gameType: 'blackjack', chipProvider: { type: 'local' }, chipUnit: 'pts',
      minBet: 10, maxBet: 100, buyIn: 200, commission: 0,
      settings: { softHit17: true },
    };
    let state = plugin.createGame(players, { roomConfig });
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'banker-turn';
    state.hands[bankerId] = [c('hearts-A'), c('spades-6')]; // soft 17
    (state.roundData.stood as Record<string, boolean>)[bankerId] = false;

    // Must hit (not stand) on soft 17
    expect(plugin.validateAction(state, { playerId: bankerId, type: 'hit' })).toBe(true);
    expect(plugin.validateAction(state, { playerId: bankerId, type: 'stand' })).toBe(false);

    const actions = plugin.getValidActions(state);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('hit');
  });

  it('soft 17: banker stands on soft 17 when softHit17 is false (default)', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;

    state.phase = 'banker-turn';
    state.hands[bankerId] = [c('hearts-A'), c('spades-6')]; // soft 17
    (state.roundData.stood as Record<string, boolean>)[bankerId] = false;

    // Default: stand on soft 17
    expect(plugin.validateAction(state, { playerId: bankerId, type: 'stand' })).toBe(true);
    expect(plugin.validateAction(state, { playerId: bankerId, type: 'hit' })).toBe(false);
  });

  // === Feature 2: Split Aces restriction ===

  it('split aces: each hand gets exactly 1 card then auto-stands', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-A'), c('spades-A')]; // pair of aces
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Split aces with cards dealt to each hand
    state = plugin.applyAction(state, {
      playerId: p1, type: 'split',
      payload: { splitCards: [c('clubs-10'), c('diamonds-5')] }
    }).state;

    // Both hands should auto-stand (each has 2 cards)
    const splitStood = state.roundData.splitStood as Record<string, boolean[]>;
    expect(splitStood[p1][0]).toBe(true); // A+10 = 21, auto-stood
    expect(splitStood[p1][1]).toBe(true); // A+5 = 16, auto-stood

    // Player should be marked as done
    expect((state.roundData.stood as Record<string, boolean>)[p1]).toBe(true);

    // Should move to banker turn
    expect(state.phase).toBe('banker-turn');
  });

  it('split aces: cannot hit after receiving 1 card', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-A'), c('spades-A')];
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Split aces - give only 1 card to first hand, none to second (simulate partial deal)
    state = plugin.applyAction(state, {
      playerId: p1, type: 'split',
      payload: { splitCards: [c('clubs-10')] } // only first hand gets a card
    }).state;

    // First hand has 2 cards (A+10), auto-stood
    // Second hand has only 1 card (A), needs 1 more
    const splitHands = state.roundData.splitHands as Record<string, Card[][]>;
    expect(splitHands[p1][1]).toEqual([c('spades-A')]); // only 1 card

    // Active index should be on second hand since first is auto-stood
    const activeIdx = (state.roundData.activeSplitIndex as Record<string, number>)[p1];
    expect(activeIdx).toBe(1);

    // Hitting second hand (adds a card to make it 2 cards)
    splitHands[p1][1].push(c('diamonds-9'));
    state = plugin.applyAction(state, { playerId: p1, type: 'hit' }).state;

    // After receiving the card, hand should auto-stand
    const splitStood2 = state.roundData.splitStood as Record<string, boolean[]>;
    expect(splitStood2[p1][1]).toBe(true);

    // Cannot hit again on split aces
    expect(plugin.validateAction(state, { playerId: p1, type: 'hit' })).toBe(false);
  });

  // === Feature 3: Split-21 is not natural blackjack ===

  it('split-21 pays 1:1 not 3:2', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'end';
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.isSplitHand as Record<string, boolean>)[p1] = true;

    // Set up split hands where one hand is 21 (A + K)
    const splitHands = state.roundData.splitHands as Record<string, Card[][]>;
    splitHands[p1] = [
      [c('hearts-A'), c('spades-K')],   // 21 from split - should NOT be natural
      [c('clubs-A'), c('diamonds-5')],   // 16
    ];
    const splitBets = state.roundData.splitBets as Record<string, number[]>;
    splitBets[p1] = [50, 50];
    const splitBusted = state.roundData.splitBusted as Record<string, boolean[]>;
    splitBusted[p1] = [false, false];

    state.hands[bankerId] = [c('diamonds-10'), c('clubs-8')]; // 18

    const result = plugin.getResult(state);
    // Hand 1: 21 beats 18, pays 1:1 = +50 (NOT +75 for 3:2)
    // Hand 2: 16 loses to 18 = -50
    // Net: 0
    expect(result.pointChanges[p1]).toBe(0);
  });

  // === Feature 4: Double After Split (DAS) configurable ===

  it('DAS allowed by default', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-8'), c('spades-8')];
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Split
    state = plugin.applyAction(state, {
      playerId: p1, type: 'split',
      payload: { splitCards: [c('clubs-3'), c('diamonds-2')] }
    }).state;

    // First hand: 8+3=11. Should allow double-down
    expect(plugin.validateAction(state, { playerId: p1, type: 'double-down' })).toBe(true);
  });

  it('DAS rejected when doubleAfterSplit is false', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    const roomConfig: RoomConfig = {
      gameType: 'blackjack', chipProvider: { type: 'local' }, chipUnit: 'pts',
      minBet: 10, maxBet: 100, buyIn: 200, commission: 0,
      settings: { doubleAfterSplit: false },
    };
    let state = plugin.createGame(players, { roomConfig });
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-8'), c('spades-8')];
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Split
    state = plugin.applyAction(state, {
      playerId: p1, type: 'split',
      payload: { splitCards: [c('clubs-3'), c('diamonds-2')] }
    }).state;

    // Double-down on split hand should be rejected
    expect(plugin.validateAction(state, { playerId: p1, type: 'double-down' })).toBe(false);
  });

  // === Feature 5: Re-split limit configurable ===

  it('re-split allowed up to maxSplitHands', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    const roomConfig: RoomConfig = {
      gameType: 'blackjack', chipProvider: { type: 'local' }, chipUnit: 'pts',
      minBet: 10, maxBet: 100, buyIn: 200, commission: 0,
      settings: { maxSplitHands: 3 },
    };
    let state = plugin.createGame(players, { roomConfig });
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-8'), c('spades-8')];
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // First split: 2 hands
    state = plugin.applyAction(state, {
      playerId: p1, type: 'split',
      payload: { splitCards: [c('clubs-8'), c('diamonds-3')] }
    }).state;

    // First split hand is 8+8, can re-split (now at 2 hands, max is 3)
    expect(plugin.validateAction(state, { playerId: p1, type: 'split' })).toBe(true);

    // Re-split first hand
    state = plugin.applyAction(state, {
      playerId: p1, type: 'split',
      payload: { splitCards: [c('hearts-5'), c('spades-3')] }
    }).state;

    // Now at 3 hands (max), no more splits allowed
    const splitHands = state.roundData.splitHands as Record<string, Card[][]>;
    expect(splitHands[p1]).toHaveLength(3);

    // Even if active hand has a pair, cannot split further
    // Force active hand to be a pair for testing
    splitHands[p1][0] = [c('hearts-8'), c('diamonds-8')];
    expect(plugin.validateAction(state, { playerId: p1, type: 'split' })).toBe(false);
  });

  it('re-splitting aces is not allowed', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    const roomConfig: RoomConfig = {
      gameType: 'blackjack', chipProvider: { type: 'local' }, chipUnit: 'pts',
      minBet: 10, maxBet: 100, buyIn: 200, commission: 0,
      settings: { maxSplitHands: 4 },
    };
    let state = plugin.createGame(players, { roomConfig });
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'playing';
    state.hands[p1] = [c('hearts-A'), c('spades-A')];
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.stood as Record<string, boolean>)[p1] = false;
    state.currentPlayerIndex = 1;

    // Split aces - give only the Ace cards back (simulate receiving another ace)
    state = plugin.applyAction(state, {
      playerId: p1, type: 'split',
      payload: { splitCards: [c('clubs-A'), c('diamonds-5')] }
    }).state;

    // Even though first hand (A+A) could theoretically split, re-splitting aces is not allowed
    const splitAces = state.roundData.splitAces as Record<string, boolean>;
    expect(splitAces[p1]).toBe(true);
    expect(plugin.validateAction(state, { playerId: p1, type: 'split' })).toBe(false);
  });

  // === Feature 6: Peek rule ===

  it('dealer peek: 10-value showing with blackjack ends round immediately', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    // Simulate post-betting dealing
    state.phase = 'dealing';
    state.hands[p1] = [c('hearts-10'), c('spades-8')]; // 18
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-A')]; // blackjack, K is face-up
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    // postDeal should detect dealer blackjack via peek
    state = plugin.postDeal(state);
    expect(state.phase).toBe('end');
    expect(state.roundData.peekSettled).toBe(true);

    // Player loses only original bet (not any doubled/split amount)
    const result = plugin.getResult(state);
    expect(result.pointChanges[p1]).toBe(-50);
    expect(result.pointChanges[bankerId]).toBe(50);
  });

  it('dealer peek: 10-value showing without blackjack proceeds to playing', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'dealing';
    state.hands[p1] = [c('hearts-10'), c('spades-8')];
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')]; // 16, K face-up
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    state = plugin.postDeal(state);
    expect(state.phase).toBe('playing'); // no blackjack, play normally
  });

  it('dealer peek: Ace showing goes to insurance phase', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'dealing';
    state.hands[p1] = [c('hearts-10'), c('spades-8')];
    state.hands[bankerId] = [c('diamonds-A'), c('clubs-K')]; // A face-up
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    state = plugin.postDeal(state);
    expect(state.phase).toBe('insurance');
  });

  it('no-peek (European): players act before banker reveals', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    const roomConfig: RoomConfig = {
      gameType: 'blackjack', chipProvider: { type: 'local' }, chipUnit: 'pts',
      minBet: 10, maxBet: 100, buyIn: 200, commission: 0,
      settings: { dealerPeek: false },
    };
    let state = plugin.createGame(players, { roomConfig });
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'dealing';
    state.hands[p1] = [c('hearts-10'), c('spades-8')];
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-A')]; // blackjack, but no peek
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    state = plugin.postDeal(state);
    // With no-peek, goes straight to playing even though dealer has blackjack
    expect(state.phase).toBe('playing');
    expect(state.roundData.peekSettled).toBeFalsy();
  });

  // === Even Money tests ===

  it('even money accepted: gets 1:1 payout', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'insurance';
    state.hands[p1] = [c('hearts-A'), c('spades-K')]; // natural 21
    state.hands[bankerId] = [c('diamonds-A'), c('clubs-Q')]; // also natural 21
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    // Even money should be valid (player has natural 21, banker shows Ace)
    expect(plugin.validateAction(state, { playerId: p1, type: 'even-money' })).toBe(true);

    state = plugin.applyAction(state, { playerId: p1, type: 'even-money' }).state;

    // Banker has natural 21, game ends
    expect(state.phase).toBe('end');

    const result = plugin.getResult(state);
    // Even money: guaranteed 1:1 payout (50), not 1.5x
    expect(result.pointChanges[p1]).toBe(50);
    expect(result.pointChanges[bankerId]).toBe(-50);
    expect(result.winners).toContain(p1);
  });

  it('even money only offered to natural 21 hands', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;
    const p2 = players[2].id;

    state.phase = 'insurance';
    state.hands[p1] = [c('hearts-A'), c('spades-K')]; // natural 21
    state.hands[p2] = [c('hearts-10'), c('spades-8')]; // 18, not natural
    state.hands[bankerId] = [c('diamonds-A'), c('clubs-Q')];
    (state.roundData.bets as Record<string, number>)[p1] = 50;
    (state.roundData.bets as Record<string, number>)[p2] = 50;

    // p1 has natural 21 -> even-money valid
    expect(plugin.validateAction(state, { playerId: p1, type: 'even-money' })).toBe(true);
    // p2 does NOT have natural 21 -> even-money invalid
    expect(plugin.validateAction(state, { playerId: p2, type: 'even-money' })).toBe(false);

    // Check getValidActions offers even-money only to p1
    const actions = plugin.getValidActions(state);
    const p1Actions = actions.filter(a => a.playerId === p1).map(a => a.type);
    const p2Actions = actions.filter(a => a.playerId === p2).map(a => a.type);
    expect(p1Actions).toContain('even-money');
    expect(p2Actions).not.toContain('even-money');
  });

  it('even money not offered when banker does not show Ace', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    // Banker shows 10 (not Ace) -> postDeal would go to 'playing' or 'end', not 'insurance'
    // Even money is only available during insurance phase, which only happens when banker shows Ace
    state.phase = 'dealing';
    state.hands[p1] = [c('hearts-A'), c('spades-K')]; // natural 21
    state.hands[bankerId] = [c('diamonds-K'), c('clubs-6')]; // K face-up, no blackjack
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    state = plugin.postDeal(state);
    // Should go to playing, not insurance
    expect(state.phase).toBe('playing');

    // In playing phase, even-money is not a valid action
    state.currentPlayerIndex = 1;
    const actions = plugin.getValidActions(state);
    const types = actions.map(a => a.type);
    expect(types).not.toContain('even-money');
  });

  it('dealer peek: player with natural 21 pushes against peek blackjack', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    const bankerId = players[0].id;
    const p1 = players[1].id;

    state.phase = 'dealing';
    state.hands[p1] = [c('hearts-A'), c('spades-K')]; // also natural 21
    state.hands[bankerId] = [c('diamonds-10'), c('clubs-A')]; // blackjack
    (state.roundData.bets as Record<string, number>)[p1] = 50;

    state = plugin.postDeal(state);
    expect(state.phase).toBe('end');
    expect(state.roundData.peekSettled).toBe(true);

    const result = plugin.getResult(state);
    // Both natural 21: push
    expect(result.pointChanges[p1]).toBe(0);
    expect(result.pointChanges[bankerId]).toBe(0);
  });
});
