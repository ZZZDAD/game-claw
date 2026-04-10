import type { Card } from '@game-claw/core';

export enum PatternType {
  Single = 'single',
  Pair = 'pair',
  Triple = 'triple',
  TripleWithOne = 'triple-with-one',
  TripleWithPair = 'triple-with-pair',
  Straight = 'straight',
  PairStraight = 'pair-straight',
  Bomb = 'bomb',
  Rocket = 'rocket',
  Airplane = 'airplane',
  Quadplex = 'quadplex',
}

export interface CardPattern {
  type: PatternType;
  rank: number;    // primary rank for comparison
  length?: number; // for straights
}

// Dou Di Zhu rank order: 3,4,5,6,7,8,9,10,J,Q,K,A,2,Small Joker, Big Joker
const DDZ_RANK: Record<string, number> = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15,
  'small': 16, 'big': 17,
};

function getRank(card: Card): number {
  return DDZ_RANK[card.rank] ?? 0;
}

export function identifyPattern(cards: Card[]): CardPattern | null {
  if (cards.length === 0) return null;

  const ranks = cards.map(getRank).sort((a, b) => a - b);

  // Rocket: big + small joker
  if (cards.length === 2 && ranks.includes(16) && ranks.includes(17)) {
    return { type: PatternType.Rocket, rank: 99 };
  }

  // Count occurrences
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  if (cards.length === 1) {
    return { type: PatternType.Single, rank: ranks[0] };
  }

  if (cards.length === 2 && groups.length === 1 && groups[0][1] === 2) {
    return { type: PatternType.Pair, rank: groups[0][0] };
  }

  if (cards.length === 3 && groups.length === 1 && groups[0][1] === 3) {
    return { type: PatternType.Triple, rank: groups[0][0] };
  }

  if (cards.length === 4) {
    if (groups.length === 1 && groups[0][1] === 4) {
      return { type: PatternType.Bomb, rank: groups[0][0] };
    }
    if (groups[0][1] === 3) {
      return { type: PatternType.TripleWithOne, rank: groups[0][0] };
    }
  }

  if (cards.length === 5 && groups[0][1] === 3 && groups[1]?.[1] === 2) {
    return { type: PatternType.TripleWithPair, rank: groups[0][0] };
  }

  // Straight: 5+ consecutive singles (no 2 or jokers)
  if (cards.length >= 5 && groups.every(([, c]) => c === 1)) {
    const sortedRanks = [...new Set(ranks)].sort((a, b) => a - b);
    if (sortedRanks.length === cards.length) {
      const min = sortedRanks[0], max = sortedRanks[sortedRanks.length - 1];
      if (max <= 14 && max - min === cards.length - 1) {
        return { type: PatternType.Straight, rank: max, length: cards.length };
      }
    }
  }

  // Pair straight: 3+ consecutive pairs (6+ cards)
  if (cards.length >= 6 && cards.length % 2 === 0 && groups.every(([, c]) => c === 2)) {
    const sortedRanks = groups.map(([r]) => r).sort((a, b) => a - b);
    const min = sortedRanks[0], max = sortedRanks[sortedRanks.length - 1];
    if (max <= 14 && max - min === sortedRanks.length - 1) {
      return { type: PatternType.PairStraight, rank: max, length: sortedRanks.length };
    }
  }

  // Quadplex: four of a kind + 2 singles (6 cards) or + 2 pairs (8 cards)
  if ((cards.length === 6 || cards.length === 8) && groups[0][1] === 4) {
    const quadRank = groups[0][0];
    const kickers = groups.slice(1);
    if (cards.length === 6 && kickers.length === 2 && kickers.every(([, c]) => c === 1)) {
      return { type: PatternType.Quadplex, rank: quadRank, length: 6 };
    }
    if (cards.length === 8 && kickers.length === 2 && kickers.every(([, c]) => c === 2)) {
      return { type: PatternType.Quadplex, rank: quadRank, length: 8 };
    }
  }

  // Airplane: 2+ consecutive triples (with optional kickers)
  const triples = groups.filter(([, c]) => c >= 3).map(([r]) => r).sort((a, b) => a - b);
  if (triples.length >= 2) {
    const min = triples[0], max = triples[triples.length - 1];
    if (max <= 14 && max - min === triples.length - 1) {
      // Pure airplane (just triples) or airplane with wings
      const tripleCardCount = triples.length * 3;
      const remaining = cards.length - tripleCardCount;
      if (remaining === 0) {
        return { type: PatternType.Airplane, rank: max, length: triples.length };
      }
      if (remaining === triples.length || remaining === triples.length * 2) {
        // Validate kickers: no bombs (4 of same rank) and no jokers
        const kickerCards = cards.filter((card) => {
          const r = getRank(card);
          return !triples.includes(r);
        });
        // Check no jokers in kickers
        if (kickerCards.some((card) => card.rank === 'small' || card.rank === 'big')) {
          return null;
        }
        // Check kickers don't form a bomb (4 of same rank)
        const kickerCounts = new Map<number, number>();
        for (const card of kickerCards) {
          const r = getRank(card);
          kickerCounts.set(r, (kickerCounts.get(r) ?? 0) + 1);
        }
        if ([...kickerCounts.values()].some((count) => count >= 4)) {
          return null;
        }
        // Kicker ranks must not overlap with triple ranks (already filtered above)
        // Single kickers: each must be a different rank
        if (remaining === triples.length) {
          // Single kickers: number of distinct kicker ranks must equal number of kickers
          if (kickerCounts.size !== triples.length) {
            return null;
          }
        }
        // Pair kickers: each pair must be a different rank, and each kicker must be exactly a pair
        if (remaining === triples.length * 2) {
          // Each kicker rank must appear exactly 2 times, and there must be triples.length distinct ranks
          if (kickerCounts.size !== triples.length) {
            return null;
          }
          if ([...kickerCounts.values()].some((count) => count !== 2)) {
            return null;
          }
        }
        return { type: PatternType.Airplane, rank: max, length: triples.length };
      }
    }
  }

  return null;
}

export function canBeat(play: CardPattern, previous: CardPattern): boolean {
  // Rocket beats everything
  if (play.type === PatternType.Rocket) return true;
  if (previous.type === PatternType.Rocket) return false;

  // Bomb beats non-bomb (including quadplex)
  if (play.type === PatternType.Bomb && previous.type !== PatternType.Bomb) return true;
  if (play.type !== PatternType.Bomb && previous.type === PatternType.Bomb) return false;

  // Same type, higher rank
  if (play.type !== previous.type) return false;

  // Quadplex: must match length (6 vs 8) in addition to type
  if (play.type === PatternType.Quadplex && play.length !== previous.length) return false;
  if (play.length !== undefined && play.length !== previous.length) return false;
  return play.rank > previous.rank;
}

// Generate all valid plays from a hand
export function getAllPlays(hand: Card[]): Card[][] {
  const plays: Card[][] = [];

  // Singles
  for (const card of hand) {
    plays.push([card]);
  }

  // Group by rank
  const byRank = new Map<string, Card[]>();
  for (const card of hand) {
    const key = card.rank;
    if (!byRank.has(key)) byRank.set(key, []);
    byRank.get(key)!.push(card);
  }

  // Pairs, triples, bombs
  for (const [, cards] of byRank) {
    if (cards.length >= 2) plays.push(cards.slice(0, 2));
    if (cards.length >= 3) plays.push(cards.slice(0, 3));
    if (cards.length === 4) plays.push(cards.slice(0, 4)); // bomb
  }

  // Triple with one
  for (const [, tripleCards] of byRank) {
    if (tripleCards.length >= 3) {
      for (const [, kickCards] of byRank) {
        if (kickCards[0].rank !== tripleCards[0].rank && kickCards.length >= 1) {
          plays.push([...tripleCards.slice(0, 3), kickCards[0]]);
        }
      }
    }
  }

  // Triple with pair
  for (const [, tripleCards] of byRank) {
    if (tripleCards.length >= 3) {
      for (const [, pairCards] of byRank) {
        if (pairCards[0].rank !== tripleCards[0].rank && pairCards.length >= 2) {
          plays.push([...tripleCards.slice(0, 3), ...pairCards.slice(0, 2)]);
        }
      }
    }
  }

  // Quadplex with 2 singles (6 cards)
  for (const [, quadCards] of byRank) {
    if (quadCards.length === 4) {
      const otherRanks = [...byRank.entries()].filter(([r]) => r !== quadCards[0].rank);
      for (let i = 0; i < otherRanks.length; i++) {
        for (let j = i + 1; j < otherRanks.length; j++) {
          plays.push([...quadCards, otherRanks[i][1][0], otherRanks[j][1][0]]);
        }
      }
    }
  }

  // Quadplex with 2 pairs (8 cards)
  for (const [, quadCards] of byRank) {
    if (quadCards.length === 4) {
      const otherPairs = [...byRank.entries()].filter(([r, cards]) => r !== quadCards[0].rank && cards.length >= 2);
      for (let i = 0; i < otherPairs.length; i++) {
        for (let j = i + 1; j < otherPairs.length; j++) {
          plays.push([...quadCards, ...otherPairs[i][1].slice(0, 2), ...otherPairs[j][1].slice(0, 2)]);
        }
      }
    }
  }

  // Rocket
  const smallJoker = hand.find((c) => c.rank === 'small');
  const bigJoker = hand.find((c) => c.rank === 'big');
  if (smallJoker && bigJoker) plays.push([smallJoker, bigJoker]);

  // Straights (5+ consecutive singles, rank 3-A only)
  const uniqueRanks = [...byRank.entries()]
    .filter(([r]) => (DDZ_RANK[r] ?? 0) <= 14)
    .sort((a, b) => (DDZ_RANK[a[0]] ?? 0) - (DDZ_RANK[b[0]] ?? 0));

  for (let len = 5; len <= uniqueRanks.length; len++) {
    for (let start = 0; start <= uniqueRanks.length - len; start++) {
      const seq = uniqueRanks.slice(start, start + len);
      const ranks = seq.map(([r]) => DDZ_RANK[r] ?? 0);
      if (ranks[ranks.length - 1] - ranks[0] === len - 1) {
        plays.push(seq.map(([, cards]) => cards[0]));
      }
    }
  }

  return plays;
}
