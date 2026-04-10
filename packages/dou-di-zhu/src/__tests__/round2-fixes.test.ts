/**
 * Unit tests for Round 2 Dou Di Zhu fixes: H7, M8.
 */
import { describe, it, expect } from 'vitest';
import { generateIdentity, identityToPlayerInfo } from '@game-claw/core';
import type { GameState, PlayerInfo, Card } from '@game-claw/core';
import { DouDiZhuPlugin } from '../plugin.js';

const plugin = new DouDiZhuPlugin();

function createPlayers(n: number): PlayerInfo[] {
  return Array.from({ length: n }, () => identityToPlayerInfo(generateIdentity()));
}

// === H7: Commission initialized from options ===

describe('H7: DDZ commission initialized from options', () => {
  it('reads commission from options.roomConfig', () => {
    const players = createPlayers(3);
    const state = plugin.createGame(players, {
      roomConfig: { commission: 5 },
    });

    expect(state.roundData.commission).toBe(5);
  });

  it('defaults to 0 when no options', () => {
    const players = createPlayers(3);
    const state = plugin.createGame(players);

    expect(state.roundData.commission).toBe(0);
  });

  it('commission shows up in getResult', () => {
    const players = createPlayers(3);
    const state = plugin.createGame(players, {
      roomConfig: { commission: 3 },
    });

    // Setup a won game
    state.phase = 'playing';
    state.roundData.landlord = players[0].id;
    state.roundData.currentBid = 1;
    state.hands = {
      [players[0].id]: [], // landlord won (no cards left)
      [players[1].id]: [{ id: 'x', suit: 's', rank: '3' }],
      [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }],
    };
    state.roundData.playCount = { [players[0].id]: 3, [players[1].id]: 1, [players[2].id]: 1 };
    state.roundData.bombCount = 0;

    const result = plugin.getResult(state);
    expect(result.commission).toBe(3);
  });
});

// === M8: Zero-sum with personalMultiplier ===

describe('M8: DDZ zero-sum with different personalMultipliers', () => {
  it('maintains zero-sum when all multipliers are 1', () => {
    const players = createPlayers(3);
    const state: GameState = {
      phase: 'playing', players, hands: {
        [players[0].id]: [], // landlord won
        [players[1].id]: [{ id: 'x', suit: 's', rank: '3' }],
        [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }],
      },
      communityCards: [], currentPlayerIndex: 0,
      roundData: {
        landlord: players[0].id,
        currentBid: 1,
        bombCount: 0,
        playCount: { [players[0].id]: 5, [players[1].id]: 2, [players[2].id]: 2 },
        showCardMultipliers: {},
        personalMultiplier: {},
        commission: 0,
      },
      deck: [], dealtCardMap: new Map(),
    };

    const result = plugin.getResult(state);
    const sum = Object.values(result.pointChanges).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);
    expect(result.pointChanges[players[0].id]).toBe(20); // landlord wins 10+10
    expect(result.pointChanges[players[1].id]).toBe(-10);
    expect(result.pointChanges[players[2].id]).toBe(-10);
  });

  it('maintains zero-sum when landlord doubles but peasants do not', () => {
    const players = createPlayers(3);
    const state: GameState = {
      phase: 'playing', players, hands: {
        [players[0].id]: [], // landlord won
        [players[1].id]: [{ id: 'x', suit: 's', rank: '3' }],
        [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }],
      },
      communityCards: [], currentPlayerIndex: 0,
      roundData: {
        landlord: players[0].id,
        currentBid: 1,
        bombCount: 0,
        playCount: { [players[0].id]: 5, [players[1].id]: 2, [players[2].id]: 2 },
        showCardMultipliers: {},
        personalMultiplier: { [players[0].id]: 2 }, // landlord doubled
        commission: 0,
      },
      deck: [], dealtCardMap: new Map(),
    };

    const result = plugin.getResult(state);
    const sum = Object.values(result.pointChanges).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);

    // Each peasant pays: 10 * base(1) * landlordMul(2) * peasantMul(1) = 20
    expect(result.pointChanges[players[1].id]).toBe(-20);
    expect(result.pointChanges[players[2].id]).toBe(-20);
    // Landlord gets: 20 + 20 = 40
    expect(result.pointChanges[players[0].id]).toBe(40);
  });

  it('maintains zero-sum when both landlord and one peasant double', () => {
    const players = createPlayers(3);
    const state: GameState = {
      phase: 'playing', players, hands: {
        [players[0].id]: [], // landlord won
        [players[1].id]: [{ id: 'x', suit: 's', rank: '3' }],
        [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }],
      },
      communityCards: [], currentPlayerIndex: 0,
      roundData: {
        landlord: players[0].id,
        currentBid: 1,
        bombCount: 0,
        playCount: { [players[0].id]: 5, [players[1].id]: 2, [players[2].id]: 2 },
        showCardMultipliers: {},
        personalMultiplier: { [players[0].id]: 2, [players[2].id]: 2 },
        commission: 0,
      },
      deck: [], dealtCardMap: new Map(),
    };

    const result = plugin.getResult(state);
    const sum = Object.values(result.pointChanges).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);

    // Peasant 1: 10 * 1 * 2 * 1 = 20
    // Peasant 2: 10 * 1 * 2 * 2 = 40
    // Landlord: 20 + 40 = 60
    expect(result.pointChanges[players[1].id]).toBe(-20);
    expect(result.pointChanges[players[2].id]).toBe(-40);
    expect(result.pointChanges[players[0].id]).toBe(60);
  });

  it('maintains zero-sum when peasants win and everyone doubled', () => {
    const players = createPlayers(3);
    const state: GameState = {
      phase: 'playing', players, hands: {
        [players[0].id]: [{ id: 'x', suit: 's', rank: '3' }], // landlord has cards
        [players[1].id]: [], // peasant 1 won
        [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }],
      },
      communityCards: [], currentPlayerIndex: 0,
      roundData: {
        landlord: players[0].id,
        currentBid: 2,
        bombCount: 1, // one bomb played
        playCount: { [players[0].id]: 3, [players[1].id]: 5, [players[2].id]: 2 },
        showCardMultipliers: {},
        personalMultiplier: { [players[0].id]: 2, [players[1].id]: 2, [players[2].id]: 2 },
        commission: 0,
      },
      deck: [], dealtCardMap: new Map(),
    };

    const result = plugin.getResult(state);
    const sum = Object.values(result.pointChanges).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);

    // base = bid(2) * bomb(2) * spring(1) * show(1) = 4
    // Peasant 1 gets: 10 * 4 * landlordMul(2) * peasantMul(2) = 160
    // Peasant 2 gets: 10 * 4 * landlordMul(2) * peasantMul(2) = 160
    // Landlord pays: -(160 + 160) = -320
    expect(result.pointChanges[players[0].id]).toBe(-320);
    expect(result.pointChanges[players[1].id]).toBe(160);
    expect(result.pointChanges[players[2].id]).toBe(160);
  });

  it('maintains zero-sum with spring multiplier', () => {
    const players = createPlayers(3);
    const state: GameState = {
      phase: 'playing', players, hands: {
        [players[0].id]: [], // landlord won, peasants never played = Spring!
        [players[1].id]: [{ id: 'x', suit: 's', rank: '3' }],
        [players[2].id]: [{ id: 'y', suit: 's', rank: '4' }],
      },
      communityCards: [], currentPlayerIndex: 0,
      roundData: {
        landlord: players[0].id,
        currentBid: 3,
        bombCount: 0,
        playCount: { [players[0].id]: 10, [players[1].id]: 0, [players[2].id]: 0 }, // spring!
        showCardMultipliers: {},
        personalMultiplier: {},
        commission: 0,
      },
      deck: [], dealtCardMap: new Map(),
    };

    const result = plugin.getResult(state);
    const sum = Object.values(result.pointChanges).reduce((a, b) => a + b, 0);
    expect(sum).toBe(0);

    // base = bid(3) * spring(4) = 12
    // Each peasant pays: 10 * 12 * 1 * 1 = 120
    expect(result.pointChanges[players[1].id]).toBe(-120);
    expect(result.pointChanges[players[2].id]).toBe(-120);
    expect(result.pointChanges[players[0].id]).toBe(240);
  });
});
