import { describe, it, expect } from 'vitest';
import { evaluateHand, compareHands, HandRank } from '../hand-eval.js';
import type { Card } from '@game-claw/core';

const c = (id: string): Card => {
  const [suit, rank] = id.split('-');
  return { id, suit, rank };
};

describe('hand evaluation', () => {
  it('detects ace-high straight flush (royal flush)', () => {
    const cards = ['hearts-A', 'hearts-K', 'hearts-Q', 'hearts-J', 'hearts-10'].map(c);
    const result = evaluateHand(cards);
    expect(result.rank).toBe(HandRank.StraightFlush);
    expect(result.values).toEqual([14]); // ace-high
  });

  it('detects straight flush', () => {
    const cards = ['spades-9', 'spades-8', 'spades-7', 'spades-6', 'spades-5'].map(c);
    expect(evaluateHand(cards).rank).toBe(HandRank.StraightFlush);
  });

  it('detects four of a kind', () => {
    const cards = ['hearts-A', 'spades-A', 'clubs-A', 'diamonds-A', 'hearts-K'].map(c);
    expect(evaluateHand(cards).rank).toBe(HandRank.FourOfAKind);
  });

  it('detects full house', () => {
    const cards = ['hearts-A', 'spades-A', 'clubs-A', 'diamonds-K', 'hearts-K'].map(c);
    expect(evaluateHand(cards).rank).toBe(HandRank.FullHouse);
  });

  it('detects flush', () => {
    const cards = ['hearts-A', 'hearts-9', 'hearts-7', 'hearts-5', 'hearts-3'].map(c);
    expect(evaluateHand(cards).rank).toBe(HandRank.Flush);
  });

  it('detects straight', () => {
    const cards = ['hearts-9', 'spades-8', 'clubs-7', 'diamonds-6', 'hearts-5'].map(c);
    expect(evaluateHand(cards).rank).toBe(HandRank.Straight);
  });

  it('detects ace-low straight', () => {
    const cards = ['hearts-A', 'spades-2', 'clubs-3', 'diamonds-4', 'hearts-5'].map(c);
    expect(evaluateHand(cards).rank).toBe(HandRank.Straight);
  });

  it('picks best 5 from 7 cards', () => {
    const cards = ['hearts-A', 'hearts-K', 'hearts-Q', 'hearts-J', 'hearts-10', 'spades-2', 'clubs-3'].map(c);
    expect(evaluateHand(cards).rank).toBe(HandRank.StraightFlush);
  });

  it('compares hands correctly', () => {
    const flush = ['hearts-A', 'hearts-9', 'hearts-7', 'hearts-5', 'hearts-3'].map(c);
    const straight = ['hearts-9', 'spades-8', 'clubs-7', 'diamonds-6', 'hearts-5'].map(c);
    expect(compareHands(flush, straight)).toBeGreaterThan(0);
  });

  it('detects three of a kind', () => {
    const cards = ['hearts-7', 'spades-7', 'clubs-7', 'diamonds-2', 'hearts-5'].map(c);
    expect(evaluateHand(cards).rank).toBe(HandRank.ThreeOfAKind);
  });

  it('detects two pair', () => {
    const cards = ['hearts-7', 'spades-7', 'clubs-5', 'diamonds-5', 'hearts-2'].map(c);
    expect(evaluateHand(cards).rank).toBe(HandRank.TwoPair);
  });

  it('detects one pair', () => {
    const cards = ['hearts-A', 'spades-A', 'clubs-7', 'diamonds-5', 'hearts-2'].map(c);
    expect(evaluateHand(cards).rank).toBe(HandRank.OnePair);
  });

  it('detects high card', () => {
    const cards = ['hearts-A', 'spades-K', 'clubs-7', 'diamonds-5', 'hearts-2'].map(c);
    expect(evaluateHand(cards).rank).toBe(HandRank.HighCard);
  });
});
