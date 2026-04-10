# @game-claw/dou-di-zhu

Dou Di Zhu (Fight the Landlord) plugin for the Game Claw engine. A classic 3-player climbing card game with bidding, bombs, and multipliers.

## Overview

3-player card game using 54 cards (standard 52 + 2 jokers). One player becomes the landlord and receives 3 extra cards. The landlord plays against the two peasants. First player to empty their hand wins.

## Rules

### Setup

- **Players**: Exactly 3
- **Deck**: 54 cards (52 standard + small joker + big joker)
- **Deal**: 17 cards each, 3 cards reserved for the landlord

### Rank Order

```
3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2 < Small Joker < Big Joker
```

### Phases

```
pre-bidding → bidding → dealing-landlord → doubling → playing → end
                │
                └→ (all pass) → redeal
```

1. **Pre-bidding**: Players signal ready (optional show-cards for multiplier)
2. **Bidding**: Each player bids 0 (pass) or 1-3. Highest bidder becomes landlord. If all pass, hand is redealt.
3. **Dealing landlord cards**: The 3 reserved cards go to the landlord (20 total)
4. **Doubling**: Each player can double their personal multiplier
5. **Playing**: Landlord leads first. Players take turns playing card patterns or passing.

### Actions

| Action | Phase | Payload |
|--------|-------|---------|
| `ready` | Pre-bidding | — |
| `show-cards` | Pre-bidding | Doubles player's show-card multiplier |
| `bid` | Bidding | `{ bid: 0\|1\|2\|3 }` (0 = pass) |
| `double` | Doubling | Doubles personal multiplier |
| `no-double` | Doubling | Keep current multiplier |
| `play` | Playing | `{ cards: Card[] }` |
| `pass` | Playing | Skip turn (only if not leading) |

### Card Patterns

| Pattern | Cards | Example |
|---------|-------|---------|
| Single | 1 | 5 |
| Pair | 2 same rank | 5-5 |
| Triple | 3 same rank | 5-5-5 |
| Triple + One | 3 same + 1 kicker | 5-5-5-3 |
| Triple + Pair | 3 same + 1 pair | 5-5-5-3-3 |
| Straight | 5+ consecutive singles | 3-4-5-6-7 (no 2s or jokers) |
| Pair Straight | 3+ consecutive pairs | 3-3-4-4-5-5 (no 2s or jokers) |
| Airplane | 2+ consecutive triples | 5-5-5-6-6-6 (+ optional kickers) |
| Airplane + singles | Consecutive triples + 1 single per triple | 5-5-5-6-6-6-3-4 |
| Airplane + pairs | Consecutive triples + 1 pair per triple | 5-5-5-6-6-6-3-3-4-4 |
| Quadplex + 2 singles | 4 same + 2 different singles | 5-5-5-5-3-4 |
| Quadplex + 2 pairs | 4 same + 2 different pairs | 5-5-5-5-3-3-4-4 |
| Bomb | 4 same rank | 5-5-5-5 |
| Rocket | Small joker + Big joker | Joker-Joker |

### Beating Rules

- A play can only be beaten by the **same pattern type** with a higher rank
- **Bombs** beat any non-bomb play
- **Rocket** beats everything (including bombs)
- Bombs and rockets can be played at any time, regardless of current pattern
- Quadplex plays must match length (6 or 8 cards)

### Airplane Kicker Rules

- Kickers must not include jokers
- Kickers must not form a bomb (no 4 of a kind)
- Single kickers: must have distinct ranks (one per triple)
- Pair kickers: must be valid pairs with distinct ranks

### Multiplier System

Final payout is calculated as:

```
payment = 10 * base_multiplier * landlord_personal_mul * peasant_personal_mul
```

Base multiplier is the product of:

| Factor | Value |
|--------|-------|
| Bid value | 1, 2, or 3 |
| Bombs | x2 per bomb played during the hand |
| Spring / Reverse Spring | x4 |
| Show cards | x2 per player who showed cards |

Personal multiplier (from doubling phase):

| Factor | Value |
|--------|-------|
| Double | x2 for that player |
| No double | x1 |

### Spring / Reverse Spring

- **Spring**: Landlord wins and neither peasant played a single card (x4)
- **Reverse Spring**: Peasants win and the landlord only played the opening lead (x4)

### Settlement

Each peasant settles independently with the landlord:

```
peasant_payment = 10 * base_mul * landlord_mul * peasant_mul
```

- If landlord wins: each peasant pays `peasant_payment` to landlord
- If peasants win: landlord pays `peasant_payment` to each peasant
- Always zero-sum: landlord's gain/loss = sum of peasants' loss/gain

## Usage

```typescript
import { DouDiZhuPlugin } from '@game-claw/dou-di-zhu';

const plugin = new DouDiZhuPlugin();
// plugin.meta = { name: 'dou-di-zhu', minPlayers: 3, maxPlayers: 3 }
```

## Exports

```typescript
export class DouDiZhuPlugin implements GamePlugin { ... }

// Card pattern utilities:
export enum PatternType { Single, Pair, Triple, ... }
export interface CardPattern { type: PatternType; rank: number; length?: number; }
export function identifyPattern(cards: Card[]): CardPattern | null;
export function canBeat(play: CardPattern, lastPlay: CardPattern): boolean;
export function getAllPlays(hand: Card[]): { cards: Card[]; pattern: CardPattern }[];
```

## Files

```
src/
  plugin.ts          Game rules, bidding, playing, scoring
  card-patterns.ts   Pattern recognition, comparison, play enumeration
```
