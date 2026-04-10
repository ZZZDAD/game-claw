import type { Card } from '@game-claw/core';

export enum HandRank {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
}

const RANK_VALUES: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

export interface HandResult {
  rank: HandRank;
  values: number[]; // for tiebreaking, descending
}

function getCombinations(arr: Card[], k: number): Card[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = getCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function evaluate5(cards: Card[]): HandResult {
  const values = cards.map((c) => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  // Check straight
  let isStraight = false;
  let straightHigh = 0;
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) {
      isStraight = true;
      straightHigh = unique[0];
    }
    // Ace-low: A-2-3-4-5
    if (unique[0] === 14 && unique[1] === 5 && unique[2] === 4 && unique[3] === 3 && unique[4] === 2) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  // Count ranks
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (isFlush && isStraight) {
    return { rank: HandRank.StraightFlush, values: [straightHigh] };
  }
  if (groups[0][1] === 4) return { rank: HandRank.FourOfAKind, values: [groups[0][0], groups[1][0]] };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { rank: HandRank.FullHouse, values: [groups[0][0], groups[1][0]] };
  if (isFlush) return { rank: HandRank.Flush, values };
  if (isStraight) return { rank: HandRank.Straight, values: [straightHigh] };
  if (groups[0][1] === 3) return { rank: HandRank.ThreeOfAKind, values: [groups[0][0], ...groups.slice(1).map((g) => g[0])] };
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const highPair = Math.max(groups[0][0], groups[1][0]);
    const lowPair = Math.min(groups[0][0], groups[1][0]);
    return { rank: HandRank.TwoPair, values: [highPair, lowPair, groups[2][0]] };
  }
  if (groups[0][1] === 2) return { rank: HandRank.OnePair, values: [groups[0][0], ...groups.slice(1).map((g) => g[0])] };
  return { rank: HandRank.HighCard, values };
}

function compareResults(a: HandResult, b: HandResult): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.min(a.values.length, b.values.length); i++) {
    if (a.values[i] !== b.values[i]) return a.values[i] - b.values[i];
  }
  return 0;
}

export function evaluateHand(cards: Card[]): HandResult {
  if (cards.length < 5) throw new Error('Need at least 5 cards');
  if (cards.length === 5) return evaluate5(cards);

  const combos = getCombinations(cards, 5);
  let best = evaluate5(combos[0]);
  for (let i = 1; i < combos.length; i++) {
    const result = evaluate5(combos[i]);
    if (compareResults(result, best) > 0) best = result;
  }
  return best;
}

export function compareHands(a: Card[], b: Card[]): number {
  return compareResults(evaluateHand(a), evaluateHand(b));
}
