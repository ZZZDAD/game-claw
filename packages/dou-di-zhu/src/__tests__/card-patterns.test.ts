import { describe, it, expect } from 'vitest';
import { identifyPattern, PatternType, canBeat, getAllPlays } from '../card-patterns.js';
import type { Card } from '@game-claw/core';

const c = (id: string): Card => {
  const [suit, rank] = id.split('-');
  return { id, suit, rank };
};

describe('card patterns', () => {
  it('identifies single', () => {
    expect(identifyPattern([c('hearts-3')])).toEqual({ type: PatternType.Single, rank: 3 });
  });

  it('identifies pair', () => {
    expect(identifyPattern([c('hearts-3'), c('spades-3')])).toEqual({ type: PatternType.Pair, rank: 3 });
  });

  it('identifies triple', () => {
    const cards = [c('hearts-3'), c('spades-3'), c('clubs-3')];
    expect(identifyPattern(cards)).toEqual({ type: PatternType.Triple, rank: 3 });
  });

  it('identifies bomb', () => {
    const cards = [c('hearts-3'), c('spades-3'), c('clubs-3'), c('diamonds-3')];
    expect(identifyPattern(cards)).toEqual({ type: PatternType.Bomb, rank: 3 });
  });

  it('identifies rocket (double joker)', () => {
    const cards = [c('joker-big'), c('joker-small')];
    expect(identifyPattern(cards)).toEqual({ type: PatternType.Rocket, rank: 99 });
  });

  it('identifies straight (5+)', () => {
    const cards = ['hearts-3', 'spades-4', 'clubs-5', 'diamonds-6', 'hearts-7'].map(c);
    const pattern = identifyPattern(cards);
    expect(pattern?.type).toBe(PatternType.Straight);
    expect(pattern?.rank).toBe(7);
    expect(pattern?.length).toBe(5);
  });

  it('identifies triple with one', () => {
    const cards = [c('hearts-5'), c('spades-5'), c('clubs-5'), c('diamonds-3')];
    expect(identifyPattern(cards)?.type).toBe(PatternType.TripleWithOne);
  });

  it('identifies triple with pair', () => {
    const cards = [c('hearts-5'), c('spades-5'), c('clubs-5'), c('diamonds-3'), c('hearts-3')];
    expect(identifyPattern(cards)?.type).toBe(PatternType.TripleWithPair);
  });

  it('rejects straight with 2', () => {
    const cards = ['hearts-Q', 'spades-K', 'clubs-A', 'diamonds-2', 'hearts-3'].map(c);
    // This should NOT be a straight because 2 can't be in a straight
    const pattern = identifyPattern(cards);
    expect(pattern?.type).not.toBe(PatternType.Straight);
  });

  it('bomb beats non-bomb', () => {
    const bomb = { type: PatternType.Bomb, rank: 3 };
    const pair = { type: PatternType.Pair, rank: 14 };
    expect(canBeat(bomb, pair)).toBe(true);
  });

  it('higher single beats lower single', () => {
    const high = { type: PatternType.Single, rank: 14 };
    const low = { type: PatternType.Single, rank: 3 };
    expect(canBeat(high, low)).toBe(true);
    expect(canBeat(low, high)).toBe(false);
  });

  it('rocket beats bomb', () => {
    const rocket = { type: PatternType.Rocket, rank: 99 };
    const bomb = { type: PatternType.Bomb, rank: 15 };
    expect(canBeat(rocket, bomb)).toBe(true);
    expect(canBeat(bomb, rocket)).toBe(false);
  });

  it('different types (non-bomb) cannot beat each other', () => {
    const single = { type: PatternType.Single, rank: 14 };
    const pair = { type: PatternType.Pair, rank: 3 };
    expect(canBeat(single, pair)).toBe(false);
    expect(canBeat(pair, single)).toBe(false);
  });

  // --- Quadplex tests ---

  it('identifies quadplex with 2 singles (6 cards)', () => {
    const cards = [c('hearts-7'), c('spades-7'), c('clubs-7'), c('diamonds-7'), c('hearts-3'), c('spades-5')];
    const pattern = identifyPattern(cards);
    expect(pattern).toEqual({ type: PatternType.Quadplex, rank: 7, length: 6 });
  });

  it('identifies quadplex with 2 pairs (8 cards)', () => {
    const cards = [
      c('hearts-7'), c('spades-7'), c('clubs-7'), c('diamonds-7'),
      c('hearts-3'), c('spades-3'), c('hearts-5'), c('spades-5'),
    ];
    const pattern = identifyPattern(cards);
    expect(pattern).toEqual({ type: PatternType.Quadplex, rank: 7, length: 8 });
  });

  it('quadplex is not a bomb — cannot beat a pair', () => {
    const quad = { type: PatternType.Quadplex, rank: 7, length: 6 };
    const pair = { type: PatternType.Pair, rank: 3 };
    expect(canBeat(quad, pair)).toBe(false);
  });

  it('higher quadplex beats lower quadplex (same length)', () => {
    const high = { type: PatternType.Quadplex, rank: 10, length: 6 };
    const low = { type: PatternType.Quadplex, rank: 7, length: 6 };
    expect(canBeat(high, low)).toBe(true);
    expect(canBeat(low, high)).toBe(false);
  });

  it('quadplex with 2 singles cannot beat quadplex with 2 pairs', () => {
    const singles = { type: PatternType.Quadplex, rank: 14, length: 6 };
    const pairs = { type: PatternType.Quadplex, rank: 3, length: 8 };
    expect(canBeat(singles, pairs)).toBe(false);
    expect(canBeat(pairs, singles)).toBe(false);
  });

  it('bomb beats quadplex', () => {
    const bomb = { type: PatternType.Bomb, rank: 3 };
    const quad = { type: PatternType.Quadplex, rank: 14, length: 6 };
    expect(canBeat(bomb, quad)).toBe(true);
  });

  it('rocket beats quadplex', () => {
    const rocket = { type: PatternType.Rocket, rank: 99 };
    const quad = { type: PatternType.Quadplex, rank: 14, length: 8 };
    expect(canBeat(rocket, quad)).toBe(true);
  });

  // --- Stricter airplane kicker validation ---

  it('rejects airplane with joker kickers', () => {
    const cards = [
      c('hearts-5'), c('spades-5'), c('clubs-5'),
      c('hearts-6'), c('spades-6'), c('clubs-6'),
      c('joker-small'), c('joker-big'),
    ];
    expect(identifyPattern(cards)).toBeNull();
  });

  it('rejects airplane with bomb kickers (4 of same rank)', () => {
    const cards = [
      c('hearts-5'), c('spades-5'), c('clubs-5'),
      c('hearts-6'), c('spades-6'), c('clubs-6'),
      c('hearts-3'), c('spades-3'), c('clubs-3'), c('diamonds-3'),
    ];
    // 2 triples (5,6) + 4 kickers that form a bomb — should be rejected
    expect(identifyPattern(cards)).toBeNull();
  });

  it('accepts airplane with valid kickers', () => {
    const cards = [
      c('hearts-5'), c('spades-5'), c('clubs-5'),
      c('hearts-6'), c('spades-6'), c('clubs-6'),
      c('hearts-3'), c('spades-4'),
    ];
    const pattern = identifyPattern(cards);
    expect(pattern?.type).toBe(PatternType.Airplane);
  });

  it('accepts airplane with distinct single kickers', () => {
    // 333-444 + 5,6 -> valid (different ranks)
    const cards = [
      c('hearts-3'), c('spades-3'), c('clubs-3'),
      c('hearts-4'), c('spades-4'), c('clubs-4'),
      c('hearts-5'), c('spades-6'),
    ];
    const pattern = identifyPattern(cards);
    expect(pattern?.type).toBe(PatternType.Airplane);
  });

  it('rejects airplane with duplicate-rank single kickers', () => {
    // 333-444 + 5,5 -> invalid (same rank kickers)
    const cards = [
      c('hearts-3'), c('spades-3'), c('clubs-3'),
      c('hearts-4'), c('spades-4'), c('clubs-4'),
      c('hearts-5'), c('spades-5'),
    ];
    expect(identifyPattern(cards)).toBeNull();
  });

  it('rejects airplane with kicker matching triple rank', () => {
    // 333-444 + 3,5 -> invalid (kicker rank 3 = triple rank)
    // Note: the 3 kicker is the 4th card of rank 3, so it counts as extra beyond the triple
    const cards = [
      c('hearts-3'), c('spades-3'), c('clubs-3'),
      c('hearts-4'), c('spades-4'), c('clubs-4'),
      c('diamonds-3'), c('hearts-5'),
    ];
    // The 4th '3' would be seen as part of the triples group (count=4), making it fail bomb check
    // or it gets filtered as a kicker - let's verify it's rejected
    expect(identifyPattern(cards)).toBeNull();
  });

  it('accepts airplane with distinct pair kickers', () => {
    // 333-444 + 55,66 -> valid (different pair ranks)
    const cards = [
      c('hearts-3'), c('spades-3'), c('clubs-3'),
      c('hearts-4'), c('spades-4'), c('clubs-4'),
      c('hearts-5'), c('spades-5'), c('hearts-6'), c('spades-6'),
    ];
    const pattern = identifyPattern(cards);
    expect(pattern?.type).toBe(PatternType.Airplane);
  });

  it('rejects airplane with duplicate-rank pair kickers', () => {
    // 333-444 + 5,5,5,5 -> 4 of same rank as kickers (bomb) - rejected
    const cards = [
      c('hearts-3'), c('spades-3'), c('clubs-3'),
      c('hearts-4'), c('spades-4'), c('clubs-4'),
      c('hearts-5'), c('spades-5'), c('clubs-5'), c('diamonds-5'),
    ];
    expect(identifyPattern(cards)).toBeNull();
  });

  // --- getAllPlays quadplex generation ---

  it('getAllPlays generates quadplex with 2 singles', () => {
    const hand = [
      c('hearts-7'), c('spades-7'), c('clubs-7'), c('diamonds-7'),
      c('hearts-3'), c('spades-5'),
    ];
    const plays = getAllPlays(hand);
    const quadPlays = plays.filter((p) => {
      const pat = identifyPattern(p);
      return pat?.type === PatternType.Quadplex && pat?.length === 6;
    });
    expect(quadPlays.length).toBeGreaterThan(0);
  });

  it('getAllPlays generates quadplex with 2 pairs', () => {
    const hand = [
      c('hearts-7'), c('spades-7'), c('clubs-7'), c('diamonds-7'),
      c('hearts-3'), c('spades-3'), c('hearts-5'), c('spades-5'),
    ];
    const plays = getAllPlays(hand);
    const quadPlays = plays.filter((p) => {
      const pat = identifyPattern(p);
      return pat?.type === PatternType.Quadplex && pat?.length === 8;
    });
    expect(quadPlays.length).toBeGreaterThan(0);
  });
});
