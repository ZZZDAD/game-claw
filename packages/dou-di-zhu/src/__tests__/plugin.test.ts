import { describe, it, expect } from 'vitest';
import { DouDiZhuPlugin } from '../plugin.js';
import { PatternType } from '../card-patterns.js';
import { generateIdentity, identityToPlayerInfo } from '@game-claw/core';
import type { GameState } from '@game-claw/core';

describe('DouDiZhuPlugin', () => {
  const plugin = new DouDiZhuPlugin();

  it('creates 54-card deck (52 + 2 jokers)', () => {
    const deck = plugin.createDeck();
    expect(deck).toHaveLength(54);
    const jokers = deck.filter((c) => c.suit === 'joker');
    expect(jokers).toHaveLength(2);
  });

  it('deals 17 cards to each of 3 players (bottom 3 stay in deck)', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    const state = plugin.createGame(players);
    const plans = plugin.getDealPlan(state);
    const dealPlan = plans[0];
    expect(dealPlan.deals).toHaveLength(3);
    dealPlan.deals.forEach((d) => expect(d.count).toBe(17));
  });

  it('starts in pre-bidding phase', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    const state = plugin.createGame(players);
    expect(state.phase).toBe('pre-bidding');
  });

  it('transitions from pre-bidding to bidding on ready', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    state = plugin.applyAction(state, { playerId: players[0].id, type: 'ready' }).state;
    expect(state.phase).toBe('bidding');
  });

  it('validates bid during bidding phase', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    state.phase = 'bidding'; // skip pre-bidding for simplicity
    expect(plugin.validateAction(state, { playerId: players[0].id, type: 'bid', payload: { bid: 1 } })).toBe(true);
    expect(plugin.validateAction(state, { playerId: players[0].id, type: 'bid', payload: { bid: 0 } })).toBe(true);
  });

  it('transitions from bidding to dealing-landlord to playing', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    state.phase = 'bidding'; // skip pre-bidding
    state.hands[players[0].id] = [];
    state.hands[players[1].id] = [];
    state.hands[players[2].id] = [];
    state.communityCards = [
      { id: 'test-1', suit: 'test', rank: '3' },
      { id: 'test-2', suit: 'test', rank: '4' },
      { id: 'test-3', suit: 'test', rank: '5' },
    ];

    // Player 0 bids 1
    state = plugin.applyAction(state, { playerId: players[0].id, type: 'bid', payload: { bid: 1 } }).state;
    expect(state.phase).toBe('bidding');

    // Player 1 passes
    state = plugin.applyAction(state, { playerId: players[1].id, type: 'bid', payload: { bid: 0 } }).state;

    // Player 2 passes — both others passed after a bid, bidding ends
    state = plugin.applyAction(state, { playerId: players[2].id, type: 'bid', payload: { bid: 0 } }).state;

    // Bidding done, player 0 is landlord — phase is 'dealing-landlord'
    expect(state.phase).toBe('dealing-landlord');
    expect(state.roundData.landlord).toBe(players[0].id);

    // Simulate engine dealing 3 bottom cards to landlord
    const landlordId = state.roundData.landlord as string;
    state.hands[landlordId].push(
      state.communityCards[0],
      state.communityCards[1],
      state.communityCards[2],
    );
    state.phase = 'playing';

    // Landlord now has the 3 community cards
    expect(state.hands[players[0].id]).toHaveLength(3);
    expect(state.phase).toBe('playing');
  });

  // --- Multi-round bidding tests ---

  describe('multi-round bidding (landlord bidding)', () => {
    it('allows bidding to go multiple rounds', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state.phase = 'bidding';

      // Player 0 bids 1
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'bid', payload: { bid: 1 } }).state;
      expect(state.phase).toBe('bidding');
      expect(state.roundData.highestBid).toBe(1);

      // Player 1 bids 2
      state = plugin.applyAction(state, { playerId: players[1].id, type: 'bid', payload: { bid: 2 } }).state;
      expect(state.phase).toBe('bidding');
      expect(state.roundData.highestBid).toBe(2);

      // Player 2 passes
      state = plugin.applyAction(state, { playerId: players[2].id, type: 'bid', payload: { bid: 0 } }).state;
      expect(state.phase).toBe('bidding'); // Not over yet, Player 0 can still bid

      // Player 0 bids 3
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'bid', payload: { bid: 3 } }).state;
      expect(state.phase).toBe('dealing-landlord');
      expect(state.roundData.landlord).toBe(players[0].id);
    });

    it('bid 3 instantly ends bidding', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state.phase = 'bidding';

      // Player 0 bids 3 immediately
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'bid', payload: { bid: 3 } }).state;
      expect(state.phase).toBe('dealing-landlord');
      expect(state.roundData.landlord).toBe(players[0].id);
    });

    it('player who passed cannot bid again', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state.phase = 'bidding';

      // Player 0 passes
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'bid', payload: { bid: 0 } }).state;

      // Player 1 bids 1
      state = plugin.applyAction(state, { playerId: players[1].id, type: 'bid', payload: { bid: 1 } }).state;

      // Player 2 bids 2
      state = plugin.applyAction(state, { playerId: players[2].id, type: 'bid', payload: { bid: 2 } }).state;

      // Player 0 already passed, cannot bid — validation should fail
      expect(plugin.validateAction(state, { playerId: players[0].id, type: 'bid', payload: { bid: 3 } })).toBe(false);
    });

    it('bidding ends when all others pass after someone bids', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state.phase = 'bidding';

      // Player 0 bids 1
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'bid', payload: { bid: 1 } }).state;
      // Player 1 bids 2
      state = plugin.applyAction(state, { playerId: players[1].id, type: 'bid', payload: { bid: 2 } }).state;
      // Player 2 passes
      state = plugin.applyAction(state, { playerId: players[2].id, type: 'bid', payload: { bid: 0 } }).state;
      expect(state.phase).toBe('bidding');
      // Player 0 passes — both non-highest bidders have passed
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'bid', payload: { bid: 0 } }).state;
      expect(state.phase).toBe('dealing-landlord');
      expect(state.roundData.landlord).toBe(players[1].id);
    });
  });

  // --- Redeal tests ---

  describe('redeal (no one bids)', () => {
    it('sets phase to redeal when all 3 players pass', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state.phase = 'bidding';

      state = plugin.applyAction(state, { playerId: players[0].id, type: 'bid', payload: { bid: 0 } }).state;
      state = plugin.applyAction(state, { playerId: players[1].id, type: 'bid', payload: { bid: 0 } }).state;
      state = plugin.applyAction(state, { playerId: players[2].id, type: 'bid', payload: { bid: 0 } }).state;

      expect(state.phase).toBe('redeal');
    });

    it('isGameOver returns true for redeal', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      const state = plugin.createGame(players);
      state.phase = 'redeal';
      expect(plugin.isGameOver(state)).toBe(true);
    });

    it('getResult returns zero pointChanges for redeal', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      const state = plugin.createGame(players);
      state.phase = 'redeal';

      const result = plugin.getResult(state);
      expect(result.winners).toEqual([]);
      expect(result.pointChanges[players[0].id]).toBe(0);
      expect(result.pointChanges[players[1].id]).toBe(0);
      expect(result.pointChanges[players[2].id]).toBe(0);
      expect(result.commission).toBe(0);
    });
  });

  // --- Show Cards (show cards) tests ---

  describe('show cards (show cards)', () => {
    it('allows show-cards during pre-bidding phase', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      const state = plugin.createGame(players);
      expect(plugin.validateAction(state, { playerId: players[0].id, type: 'show-cards' })).toBe(true);
    });

    it('show-cards doubles multiplier', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'show-cards' }).state;
      const multipliers = state.roundData.showCardMultipliers as Record<string, number>;
      expect(multipliers[players[0].id]).toBe(2);
    });

    it('show-cards multiplier applies to getResult', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      const state: GameState = {
        phase: 'end',
        players,
        hands: { [players[0].id]: [], [players[1].id]: [{ id: 'x', suit: 's', rank: '3' }], [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }] },
        communityCards: [],
        currentPlayerIndex: 0,
        roundData: {
          landlord: players[0].id,
          currentBid: 1,
          bids: {},
          lastPlay: null,
          passCount: 0,
          landlordCards: [],
          bombCount: 0,
          playCount: { [players[0].id]: 5, [players[1].id]: 3, [players[2].id]: 2 },
          showCardMultipliers: { [players[0].id]: 2 },
          personalMultiplier: {},
        },
        deck: [],
        dealtCardMap: new Map(),
      };

      const result = plugin.getResult(state);
      // base=20, bid=1, bombMul=1, spring=1, showCard=2 => 20*1*1*1*2=40
      expect(result.pointChanges[players[0].id]).toBe(40);
      expect(result.pointChanges[players[1].id]).toBe(-20);
    });

    it('multiple players showing cards stack multiplicatively', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      const state: GameState = {
        phase: 'end',
        players,
        hands: { [players[0].id]: [], [players[1].id]: [{ id: 'x', suit: 's', rank: '3' }], [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }] },
        communityCards: [],
        currentPlayerIndex: 0,
        roundData: {
          landlord: players[0].id,
          currentBid: 1,
          bids: {},
          lastPlay: null,
          passCount: 0,
          landlordCards: [],
          bombCount: 0,
          playCount: { [players[0].id]: 5, [players[1].id]: 3, [players[2].id]: 2 },
          showCardMultipliers: { [players[0].id]: 2, [players[1].id]: 2 },
          personalMultiplier: {},
        },
        deck: [],
        dealtCardMap: new Map(),
      };

      const result = plugin.getResult(state);
      // base=20, showCard=2*2=4 => 20*4=80
      expect(result.pointChanges[players[0].id]).toBe(80);
      expect(result.pointChanges[players[1].id]).toBe(-40);
    });

    it('allows show-cards during bidding phase', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state.phase = 'bidding';
      expect(plugin.validateAction(state, { playerId: players[0].id, type: 'show-cards' })).toBe(true);
    });

    it('allows landlord show-cards during dealing-landlord phase', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state.phase = 'dealing-landlord';
      state.roundData.landlord = players[0].id;
      expect(plugin.validateAction(state, { playerId: players[0].id, type: 'show-cards' })).toBe(true);
      // Non-landlord cannot show cards during dealing-landlord
      expect(plugin.validateAction(state, { playerId: players[1].id, type: 'show-cards' })).toBe(false);
    });

    it('cannot show cards twice in same phase', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state = plugin.applyAction(state, { playerId: players[0].id, type: 'show-cards' }).state;
      // Now showCardsDone is true for player 0
      expect(plugin.validateAction(state, { playerId: players[0].id, type: 'show-cards' })).toBe(false);
    });
  });

  // --- Doubling (doubling) tests ---

  describe('post-deal doubling (doubling)', () => {
    it('validates double and pass-double actions in doubling phase', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state.phase = 'doubling';
      state.roundData.landlord = players[0].id;

      expect(plugin.validateAction(state, { playerId: players[0].id, type: 'double' })).toBe(true);
      expect(plugin.validateAction(state, { playerId: players[0].id, type: 'pass-double' })).toBe(true);
    });

    it('transitions from doubling to playing after all decide', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state.phase = 'doubling';
      state.roundData.landlord = players[0].id;
      state.hands[players[0].id] = [];
      state.hands[players[1].id] = [];
      state.hands[players[2].id] = [];

      state = plugin.applyAction(state, { playerId: players[0].id, type: 'double' }).state;
      expect(state.phase).toBe('doubling');

      state = plugin.applyAction(state, { playerId: players[1].id, type: 'pass-double' }).state;
      expect(state.phase).toBe('doubling');

      state = plugin.applyAction(state, { playerId: players[2].id, type: 'double' }).state;
      expect(state.phase).toBe('playing');
    });

    it('personal multiplier affects only that player payout', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      const state: GameState = {
        phase: 'end',
        players,
        hands: { [players[0].id]: [], [players[1].id]: [{ id: 'x', suit: 's', rank: '3' }], [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }] },
        communityCards: [],
        currentPlayerIndex: 0,
        roundData: {
          landlord: players[0].id,
          currentBid: 1,
          bids: {},
          lastPlay: null,
          passCount: 0,
          landlordCards: [],
          bombCount: 0,
          playCount: { [players[0].id]: 5, [players[1].id]: 3, [players[2].id]: 2 },
          showCardMultipliers: {},
          personalMultiplier: { [players[0].id]: 2, [players[1].id]: 1, [players[2].id]: 2 },
        },
        deck: [],
        dealtCardMap: new Map(),
      };

      const result = plugin.getResult(state);
      // Landlord wins. base=1 (bid=1, no bombs, no spring, no showCards)
      // Each peasant settles with landlord: payment = 10 * base * landlordMul * peasantMul
      // Peasant 1: 10 * 1 * 2 * 1 = 20
      // Peasant 2: 10 * 1 * 2 * 2 = 40
      // Landlord: +20 + 40 = 60 (zero-sum verified)
      expect(result.pointChanges[players[0].id]).toBe(60);
      expect(result.pointChanges[players[1].id]).toBe(-20);
      expect(result.pointChanges[players[2].id]).toBe(-40);
    });

    it('cannot double twice', () => {
      const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
      let state = plugin.createGame(players);
      state.phase = 'doubling';
      state.roundData.landlord = players[0].id;

      state = plugin.applyAction(state, { playerId: players[0].id, type: 'double' }).state;
      expect(plugin.validateAction(state, { playerId: players[0].id, type: 'double' })).toBe(false);
    });
  });

  // --- Bomb multiplier tests ---

  it('tracks bombCount and applies 2^bombCount multiplier in getResult', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    const state: GameState = {
      phase: 'end',
      players,
      hands: { [players[0].id]: [], [players[1].id]: [{ id: 'x', suit: 's', rank: '3' }], [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }] },
      communityCards: [],
      currentPlayerIndex: 0,
      roundData: {
        landlord: players[0].id,
        currentBid: 1,
        bids: {},
        lastPlay: null,
        passCount: 0,
        landlordCards: [],
        bombCount: 2,
        playCount: { [players[0].id]: 5, [players[1].id]: 3, [players[2].id]: 2 },
        showCardMultipliers: {},
        personalMultiplier: {},
      },
      deck: [],
      dealtCardMap: new Map(),
    };

    const result = plugin.getResult(state);
    // base=20, bid=1, bombMultiplier=2^2=4, no spring => 20*1*4*1=80
    expect(result.pointChanges[players[0].id]).toBe(80);
    expect(result.pointChanges[players[1].id]).toBe(-40);
    expect(result.pointChanges[players[2].id]).toBe(-40);
  });

  it('increments bombCount when bomb is played', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    let state = plugin.createGame(players);
    state.phase = 'playing';
    state.roundData.landlord = players[0].id;
    state.hands[players[0].id] = [
      { id: 'h-3', suit: 'hearts', rank: '3' },
      { id: 's-3', suit: 'spades', rank: '3' },
      { id: 'c-3', suit: 'clubs', rank: '3' },
      { id: 'd-3', suit: 'diamonds', rank: '3' },
    ];
    state.hands[players[1].id] = [{ id: 'h-4', suit: 'hearts', rank: '4' }];
    state.hands[players[2].id] = [{ id: 'h-5', suit: 'hearts', rank: '5' }];

    state = plugin.applyAction(state, {
      playerId: players[0].id,
      type: 'play-cards',
      payload: { cardIds: ['h-3', 's-3', 'c-3', 'd-3'] },
    }).state;

    expect(state.roundData.bombCount).toBe(1);
  });

  // --- Spring tests ---

  it('applies spring multiplier (x4) when landlord wins and peasants never played', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    const state: GameState = {
      phase: 'end',
      players,
      hands: { [players[0].id]: [], [players[1].id]: [{ id: 'x', suit: 's', rank: '3' }], [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }] },
      communityCards: [],
      currentPlayerIndex: 0,
      roundData: {
        landlord: players[0].id,
        currentBid: 1,
        bids: {},
        lastPlay: null,
        passCount: 0,
        landlordCards: [],
        bombCount: 0,
        playCount: { [players[0].id]: 10 },
        showCardMultipliers: {},
        personalMultiplier: {},
      },
      deck: [],
      dealtCardMap: new Map(),
    };

    const result = plugin.getResult(state);
    // base=20, bid=1, bombMultiplier=1, spring=4 => 20*1*1*4=80
    expect(result.pointChanges[players[0].id]).toBe(80);
    expect(result.pointChanges[players[1].id]).toBe(-40);
  });

  // --- Reverse Spring tests ---

  it('applies reverse spring multiplier (x4) when peasant wins and landlord only played initial lead', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    const state: GameState = {
      phase: 'end',
      players,
      hands: { [players[0].id]: [{ id: 'x', suit: 's', rank: '3' }], [players[1].id]: [], [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }] },
      communityCards: [],
      currentPlayerIndex: 0,
      roundData: {
        landlord: players[0].id,
        currentBid: 1,
        bids: {},
        lastPlay: null,
        passCount: 0,
        landlordCards: [],
        bombCount: 0,
        playCount: { [players[0].id]: 1, [players[1].id]: 8, [players[2].id]: 5 },
        showCardMultipliers: {},
        personalMultiplier: {},
      },
      deck: [],
      dealtCardMap: new Map(),
    };

    const result = plugin.getResult(state);
    expect(result.pointChanges[players[0].id]).toBe(-80);
    expect(result.pointChanges[players[1].id]).toBe(40);
    expect(result.pointChanges[players[2].id]).toBe(40);
    expect(result.winners).not.toContain(players[0].id);
  });

  it('bomb multiplier and spring stack multiplicatively', () => {
    const players = [0, 1, 2].map(() => identityToPlayerInfo(generateIdentity()));
    const state: GameState = {
      phase: 'end',
      players,
      hands: { [players[0].id]: [], [players[1].id]: [{ id: 'x', suit: 's', rank: '3' }], [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }] },
      communityCards: [],
      currentPlayerIndex: 0,
      roundData: {
        landlord: players[0].id,
        currentBid: 2,
        bids: {},
        lastPlay: null,
        passCount: 0,
        landlordCards: [],
        bombCount: 1,
        playCount: { [players[0].id]: 10 },
        showCardMultipliers: {},
        personalMultiplier: {},
      },
      deck: [],
      dealtCardMap: new Map(),
    };

    const result = plugin.getResult(state);
    // base=20, bid=2, bombMultiplier=2^1=2, spring=4 => 20*2*2*4=320
    expect(result.pointChanges[players[0].id]).toBe(320);
    expect(result.pointChanges[players[1].id]).toBe(-160);
  });
});
