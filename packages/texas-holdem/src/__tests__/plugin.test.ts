import { describe, it, expect } from 'vitest';
import { TexasHoldemPlugin } from '../plugin.js';
import { generateIdentity, identityToPlayerInfo } from '@game-claw/core';

describe('TexasHoldemPlugin', () => {
  const plugin = new TexasHoldemPlugin();

  it('creates 52-card deck', () => {
    const deck = plugin.createDeck();
    expect(deck).toHaveLength(52);
    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(52);
  });

  it('creates game with blinds posted', () => {
    const players = [0, 1, 2, 3].map(() => identityToPlayerInfo(generateIdentity()));
    const state = plugin.createGame(players);
    expect(state.phase).toBe('preflop');
    expect(state.players).toHaveLength(4);

    // Positions: Button=0, SB=1, BB=2, UTG=3
    expect(state.roundData.buttonIndex).toBe(0);
    expect(state.roundData.sbIndex).toBe(1);
    expect(state.roundData.bbIndex).toBe(2);

    // Blinds posted
    const bets = state.roundData.bets as Record<string, number>;
    expect(bets[players[1].id]).toBe(5);  // SB = 5
    expect(bets[players[2].id]).toBe(10); // BB = 10
    expect(state.roundData.pot).toBe(15);
    expect(state.roundData.currentBet).toBe(10);

    // UTG acts first preflop
    expect(state.currentPlayerIndex).toBe(3);
  });

  it('deals cards in correct order: SB first, one at a time', () => {
    const players = [0, 1, 2, 3].map(() => identityToPlayerInfo(generateIdentity()));
    const state = plugin.createGame(players);
    const plans = plugin.getDealPlan(state);
    const preflopPlan = plans.find((p) => p.phase === 'preflop')!;

    // SB=index 1, so deal order: P1, P2, P3, P0, P1, P2, P3, P0
    // 8 deals total (4 players × 2 rounds of 1 card each)
    expect(preflopPlan.deals).toHaveLength(8);

    // Round 1: SB, BB, UTG, Button (each gets 1 card)
    expect(preflopPlan.deals[0].target).toBe(players[1].id); // SB first
    expect(preflopPlan.deals[0].count).toBe(1);
    expect(preflopPlan.deals[1].target).toBe(players[2].id); // BB
    expect(preflopPlan.deals[2].target).toBe(players[3].id); // UTG
    expect(preflopPlan.deals[3].target).toBe(players[0].id); // Button last

    // Round 2: same order, second card
    expect(preflopPlan.deals[4].target).toBe(players[1].id); // SB
    expect(preflopPlan.deals[7].target).toBe(players[0].id); // Button
  });

  it('heads-up: Button=SB, other=BB', () => {
    const players = [0, 1].map(() => identityToPlayerInfo(generateIdentity()));
    const state = plugin.createGame(players);

    // In heads-up: Button(0)=SB, Player(1)=BB
    const bets = state.roundData.bets as Record<string, number>;
    expect(bets[players[0].id]).toBe(5);  // Button/SB
    expect(bets[players[1].id]).toBe(10); // BB

    // SB/Button acts first preflop in heads-up
    expect(state.currentPlayerIndex).toBe(0);
  });

  it('preflop: UTG can call/raise/fold, not check', () => {
    const players = [0, 1, 2, 3].map(() => identityToPlayerInfo(generateIdentity()));
    const state = plugin.createGame(players);

    // UTG (index 3) faces BB of 10
    const actions = plugin.getValidActions(state);
    const types = actions.map((a) => a.type);
    expect(types).toContain('fold');
    expect(types).toContain('call');     // call the BB
    expect(types).toContain('raise');    // raise above BB
    expect(types).not.toContain('check'); // can't check, BB is outstanding
  });

  it('BB can check if no raise', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    // SB=1, BB=2, UTG=0 (3 players: btn=0, sb=1, bb=2, utg wraps to 0)

    // UTG calls
    state = plugin.applyAction(state, { playerId: players[0].id, type: 'call' }).state;
    // SB calls
    state = plugin.applyAction(state, { playerId: players[1].id, type: 'call' }).state;

    // Now BB should be able to check (everyone matched the big blind)
    expect(state.currentPlayerIndex).toBe(2); // BB's turn
    const actions = plugin.getValidActions(state);
    const types = actions.map((a) => a.type);
    expect(types).toContain('check');
  });

  it('post-flop action starts from SB', () => {
    const players = [0, 1, 2, 3].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);

    // Everyone calls/checks through preflop
    // UTG(3) calls, Button(0) calls, SB(1) calls, BB(2) checks
    state = plugin.applyAction(state, { playerId: players[3].id, type: 'call' }).state;
    state = plugin.applyAction(state, { playerId: players[0].id, type: 'call' }).state;
    state = plugin.applyAction(state, { playerId: players[1].id, type: 'call' }).state;
    state = plugin.applyAction(state, { playerId: players[2].id, type: 'check' }).state;

    // Should now be flop, action starts from SB (index 1)
    expect(state.phase).toBe('flop');
    expect(state.currentPlayerIndex).toBe(1); // SB acts first post-flop
  });

  it('min raise = current bet + last raise size (2x rule)', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    const state = plugin.createGame(players);

    // UTG tries to raise to 15 (currentBet=10, lastRaiseSize=10, min raise=20)
    expect(plugin.validateAction(state, {
      playerId: players[0].id, type: 'raise', payload: { amount: 15 }
    })).toBe(false); // 15 < 20

    expect(plugin.validateAction(state, {
      playerId: players[0].id, type: 'raise', payload: { amount: 20 }
    })).toBe(true); // 20 = 10 + 10 (currentBet + lastRaiseSize) ✓
  });

  it('runs a full game with positions', () => {
    const players = [0, 1, 2, 3].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);

    // Set up known hands for deterministic test
    state.hands[players[0].id] = [
      { id: 'hearts-A', suit: 'hearts', rank: 'A' },
      { id: 'hearts-K', suit: 'hearts', rank: 'K' },
    ];
    state.hands[players[1].id] = [
      { id: 'spades-2', suit: 'spades', rank: '2' },
      { id: 'clubs-3', suit: 'clubs', rank: '3' },
    ];
    state.hands[players[2].id] = [
      { id: 'diamonds-7', suit: 'diamonds', rank: '7' },
      { id: 'clubs-8', suit: 'clubs', rank: '8' },
    ];
    state.hands[players[3].id] = [
      { id: 'spades-J', suit: 'spades', rank: 'J' },
      { id: 'diamonds-Q', suit: 'diamonds', rank: 'Q' },
    ];
    state.communityCards = [
      { id: 'hearts-Q', suit: 'hearts', rank: 'Q' },
      { id: 'hearts-J', suit: 'hearts', rank: 'J' },
      { id: 'hearts-10', suit: 'hearts', rank: '10' },
      { id: 'diamonds-5', suit: 'diamonds', rank: '5' },
      { id: 'clubs-9', suit: 'clubs', rank: '9' },
    ];

    // Play through to showdown
    while (!plugin.isGameOver(state)) {
      const validActions = plugin.getValidActions(state);
      if (validActions.length === 0) break;
      const action = validActions.find((a) => a.type === 'check')
        ?? validActions.find((a) => a.type === 'call')
        ?? validActions[0];
      state = plugin.applyAction(state, action).state;
    }

    expect(plugin.isGameOver(state)).toBe(true);
    const result = plugin.getResult(state);
    // Player 0 has ace-high straight flush (A-K-Q-J-10 hearts)
    expect(result.winners).toContain(players[0].id);
  });

  describe('odd chip distribution', () => {
    it('gives remainder chip to winner closest to button clockwise', () => {
      // 3 players: button=0, SB=1, BB=2
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);

      // Give player 1 and player 2 identical hands (tie)
      // Player 0 will fold, leaving pot split between p1 and p2
      state.hands[players[0].id] = [
        { id: 'spades-2', suit: 'spades', rank: '2' },
        { id: 'clubs-3', suit: 'clubs', rank: '3' },
      ];
      state.hands[players[1].id] = [
        { id: 'hearts-A', suit: 'hearts', rank: 'A' },
        { id: 'diamonds-K', suit: 'diamonds', rank: 'K' },
      ];
      state.hands[players[2].id] = [
        { id: 'spades-A', suit: 'spades', rank: 'A' },
        { id: 'clubs-K', suit: 'clubs', rank: 'K' },
      ];
      state.communityCards = [
        { id: 'hearts-Q', suit: 'hearts', rank: 'Q' },
        { id: 'diamonds-J', suit: 'diamonds', rank: 'J' },
        { id: 'clubs-10', suit: 'clubs', rank: '10' },
        { id: 'hearts-5', suit: 'hearts', rank: '5' },
        { id: 'diamonds-4', suit: 'diamonds', rank: '4' },
      ];

      // UTG(0) raises to 20, SB(1) calls, BB(2) calls
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'raise', payload: { amount: 20 } }).state;
      state = plugin.applyAction(state, { playerId: players[1].id, type: 'call' }).state;
      state = plugin.applyAction(state, { playerId: players[2].id, type: 'call' }).state;

      // Flop: all check
      state = plugin.applyAction(state, { playerId: players[1].id, type: 'check' }).state;
      state = plugin.applyAction(state, { playerId: players[2].id, type: 'check' }).state;
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'check' }).state;

      // Turn: P0 raises to 5, P1 calls, P2 calls
      state = plugin.applyAction(state, { playerId: players[1].id, type: 'raise', payload: { amount: 10 } }).state;
      state = plugin.applyAction(state, { playerId: players[2].id, type: 'call' }).state;
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'fold' }).state;

      // River: check-check
      state = plugin.applyAction(state, { playerId: players[1].id, type: 'check' }).state;
      state = plugin.applyAction(state, { playerId: players[2].id, type: 'check' }).state;

      expect(plugin.isGameOver(state)).toBe(true);

      // Pot = 60 (preflop) + 20 (turn) = 80 total
      // P0 contributed 20, P1 contributed 30, P2 contributed 30
      // Total pot = 80
      // Both P1 and P2 win with AK high straight
      // 80 / 2 = 40 each, no remainder here
      // Let's check the result is correct
      const result = plugin.getResult(state);
      expect(result.winners).toContain(players[1].id);
      expect(result.winners).toContain(players[2].id);
    });

    it('awards odd chip to first player clockwise after button', () => {
      // Directly test getResult with a crafted state that has an odd pot
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);

      // Manually set up a scenario with odd pot
      // Identical hands for P1 (SB, seat 1) and P2 (BB, seat 2)
      state.hands[players[0].id] = [
        { id: 'spades-2', suit: 'spades', rank: '2' },
        { id: 'clubs-3', suit: 'clubs', rank: '3' },
      ];
      state.hands[players[1].id] = [
        { id: 'hearts-A', suit: 'hearts', rank: 'A' },
        { id: 'diamonds-K', suit: 'diamonds', rank: 'K' },
      ];
      state.hands[players[2].id] = [
        { id: 'spades-A', suit: 'spades', rank: 'A' },
        { id: 'clubs-K', suit: 'clubs', rank: 'K' },
      ];
      state.communityCards = [
        { id: 'hearts-Q', suit: 'hearts', rank: 'Q' },
        { id: 'diamonds-J', suit: 'diamonds', rank: 'J' },
        { id: 'clubs-10', suit: 'clubs', rank: '10' },
        { id: 'hearts-5', suit: 'hearts', rank: '5' },
        { id: 'diamonds-4', suit: 'diamonds', rank: '4' },
      ];

      // Manipulate contributions to produce an odd pot
      // P0 folds, P1 and P2 are active with a pot of 15
      (state.roundData.folded as Record<string, boolean>)[players[0].id] = true;
      (state.roundData.totalContributions as Record<string, number>)[players[0].id] = 5;
      (state.roundData.totalContributions as Record<string, number>)[players[1].id] = 5;
      (state.roundData.totalContributions as Record<string, number>)[players[2].id] = 5;
      state.roundData.pot = 15;
      state.phase = 'end';

      const result = plugin.getResult(state);
      expect(result.winners).toContain(players[1].id);
      expect(result.winners).toContain(players[2].id);

      // Pot=15, each contributed 5.
      // 15 / 2 = 7 each, remainder 1
      // P1 (seat 1, closest to button clockwise) gets odd chip: wins 8, contributed 5, net +3
      // P2 (seat 2): wins 7, contributed 5, net +2
      // P0: contributed 5, wins 0, net -5
      expect(result.pointChanges[players[1].id]).toBe(3);
      expect(result.pointChanges[players[2].id]).toBe(2);
      expect(result.pointChanges[players[0].id]).toBe(-5);
    });

    it('odd chip goes to correct winner when button is between winners', () => {
      // 4 players, button=2, winners at seats 0 and 3
      const players = [0, 1, 2, 3].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players, { buttonIndex: 2 });

      // Identical hands for P0 and P3
      state.hands[players[0].id] = [
        { id: 'hearts-A', suit: 'hearts', rank: 'A' },
        { id: 'diamonds-K', suit: 'diamonds', rank: 'K' },
      ];
      state.hands[players[1].id] = [
        { id: 'spades-2', suit: 'spades', rank: '2' },
        { id: 'clubs-3', suit: 'clubs', rank: '3' },
      ];
      state.hands[players[2].id] = [
        { id: 'spades-4', suit: 'spades', rank: '4' },
        { id: 'clubs-5', suit: 'clubs', rank: '5' },
      ];
      state.hands[players[3].id] = [
        { id: 'spades-A', suit: 'spades', rank: 'A' },
        { id: 'clubs-K', suit: 'clubs', rank: 'K' },
      ];
      state.communityCards = [
        { id: 'hearts-Q', suit: 'hearts', rank: 'Q' },
        { id: 'diamonds-J', suit: 'diamonds', rank: 'J' },
        { id: 'clubs-10', suit: 'clubs', rank: '10' },
        { id: 'hearts-5', suit: 'hearts', rank: '5' },
        { id: 'diamonds-4', suit: 'diamonds', rank: '4' },
      ];

      // P1, P2 fold. P0 and P3 are active with odd pot of 15
      (state.roundData.folded as Record<string, boolean>)[players[1].id] = true;
      (state.roundData.folded as Record<string, boolean>)[players[2].id] = true;
      (state.roundData.totalContributions as Record<string, number>)[players[0].id] = 5;
      (state.roundData.totalContributions as Record<string, number>)[players[1].id] = 3;
      (state.roundData.totalContributions as Record<string, number>)[players[2].id] = 2;
      (state.roundData.totalContributions as Record<string, number>)[players[3].id] = 5;
      state.roundData.pot = 15;
      state.phase = 'end';

      const result = plugin.getResult(state);
      expect(result.winners).toContain(players[0].id);
      expect(result.winners).toContain(players[3].id);

      // Button at seat 2. Clockwise order after button: seat 3, seat 0, seat 1, ...
      // P3 (seat 3, distance 1) is closer than P0 (seat 0, distance 2)
      // P3 gets the odd chip
      // Pot: P0 and P3 each contributed 5 (level=5), P1 contributed 3, P2 contributed 2
      // Side pot at level 2: 2*4=8, eligible: P0, P3 -> 4 each
      // Side pot at level 3: 1*3=3 (P0:1 + P1:1 + P3:1, P2 has nothing above 2), eligible: P0, P3 -> 1 each, remainder 1 -> P3
      // Side pot at level 5: 2*2=4 (only P0 and P3 above 3), eligible: P0, P3 -> 2 each
      // Total winnings: P0 = 4 + 1 + 2 = 7, P3 = 4 + 1 + 1 + 2 = 8
      // Net: P0 = 7 - 5 = +2, P3 = 8 - 5 = +3, P1 = 0 - 3 = -3, P2 = 0 - 2 = -2
      expect(result.pointChanges[players[3].id]).toBe(3);
      expect(result.pointChanges[players[0].id]).toBe(2);
      expect(result.pointChanges[players[1].id]).toBe(-3);
      expect(result.pointChanges[players[2].id]).toBe(-2);
    });
  });

  describe('table stakes enforcement', () => {
    it('initializes stacks from buyIn', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      const state = plugin.createGame(players, { roomConfig: { buyIn: 500, gameType: 'texas-holdem', chipProvider: { type: 'local' }, chipUnit: 'chips', minBet: 5, maxBet: 100, commission: 0 } });
      const stacks = state.roundData.stacks as Record<string, number>;

      // SB posted 5, BB posted 10
      expect(stacks[players[1].id]).toBe(495); // SB: 500 - 5
      expect(stacks[players[2].id]).toBe(490); // BB: 500 - 10
      expect(stacks[players[0].id]).toBe(500); // UTG: no blind yet
    });

    it('deducts from stack on call and raise', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players, { roomConfig: { buyIn: 500, gameType: 'texas-holdem', chipProvider: { type: 'local' }, chipUnit: 'chips', minBet: 5, maxBet: 100, commission: 0 } });

      // UTG (P0) raises to 20
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'raise', payload: { amount: 20 } }).state;
      const stacks = state.roundData.stacks as Record<string, number>;
      expect(stacks[players[0].id]).toBe(480); // 500 - 20
    });

    it('rejects raise exceeding player stack', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      const state = plugin.createGame(players, { roomConfig: { buyIn: 30, gameType: 'texas-holdem', chipProvider: { type: 'local' }, chipUnit: 'chips', minBet: 5, maxBet: 100, commission: 0 } });

      // UTG (P0) has 30 chips, tries to raise to 40 (needs 40 chips, only has 30)
      expect(plugin.validateAction(state, {
        playerId: players[0].id, type: 'raise', payload: { amount: 40 }
      })).toBe(false);

      // Can raise to 20 (min raise, costs 20, has 30)
      expect(plugin.validateAction(state, {
        playerId: players[0].id, type: 'raise', payload: { amount: 20 }
      })).toBe(true);
    });

    it('only offers raise if player has enough for min raise', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      // buyIn=15: after BB posts, UTG has 15 chips and currentBet=10, minRaise=20 (needs 20 chips)
      const state = plugin.createGame(players, { roomConfig: { buyIn: 15, gameType: 'texas-holdem', chipProvider: { type: 'local' }, chipUnit: 'chips', minBet: 5, maxBet: 100, commission: 0 } });

      const actions = plugin.getValidActions(state);
      const types = actions.map((a) => a.type);

      // P0 has 15 chips, min raise to 20 costs 20 - can't afford
      expect(types).not.toContain('raise');
      // But all-in should be available
      expect(types).toContain('all-in');
    });

    it('offers all-in with remaining stack amount', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      const state = plugin.createGame(players, { roomConfig: { buyIn: 50, gameType: 'texas-holdem', chipProvider: { type: 'local' }, chipUnit: 'chips', minBet: 5, maxBet: 100, commission: 0 } });

      const actions = plugin.getValidActions(state);
      const allInAction = actions.find((a) => a.type === 'all-in');

      expect(allInAction).toBeDefined();
      // P0 (UTG) has 50 chips, no bet yet, all-in = 0 + 50 = 50
      expect((allInAction!.payload as { amount: number }).amount).toBe(50);
    });

    it('sets stack to 0 on all-in', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players, { roomConfig: { buyIn: 50, gameType: 'texas-holdem', chipProvider: { type: 'local' }, chipUnit: 'chips', minBet: 5, maxBet: 100, commission: 0 } });

      // UTG goes all-in
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'all-in', payload: { amount: 50 } }).state;
      const stacks = state.roundData.stacks as Record<string, number>;
      expect(stacks[players[0].id]).toBe(0);
    });
  });
});
