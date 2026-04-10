# @game-claw/blackjack

Blackjack (21) plugin for the Game Claw engine. The banker is a real player, not the house.

## Overview

Multi-player Blackjack for 2-8 players. One player acts as the banker. All standard actions are supported: hit, stand, double down, split, insurance, even money, and surrender.

## Rules

### Setup

- **Players**: 2-8
- **Deck**: Standard 52 cards
- **Banker**: A real player at the table, selected by `settings.bankerIndex`
- **Dealing**: Banker's first card is face-up (visible to all), second card is hidden

### Hand Values

| Card | Value |
|------|-------|
| 2-10 | Face value |
| J, Q, K | 10 |
| Ace | 11, reduced to 1 if total exceeds 21 |

- **Natural 21**: Exactly 2 cards totaling 21 (Ace + 10-value)
- **Soft 17**: Total of 17 with an Ace counting as 11

### Phases

```
betting → dealing → [insurance] → playing → banker-turn → end
```

1. **Betting**: Normal players place bets (min/max enforced)
2. **Dealing**: 2 cards each. Banker's first card face-up.
3. **Insurance** (optional): If banker shows Ace + `dealerPeek` enabled
4. **Playing**: Each normal player acts in turn
5. **Banker turn**: Banker follows fixed rules (hit < 17, stand >= 17)
6. **End**: Settle bets

### Player Actions

| Action | When Available | Effect |
|--------|---------------|--------|
| `bet` | Betting phase | Place initial bet |
| `hit` | Playing phase | Draw one card |
| `stand` | Playing phase | End turn |
| `double-down` | First action, 2 cards only | Double bet, receive exactly 1 card, auto-stand |
| `split` | First action, matching pair | Split into two hands, each receives 1 new card |
| `insurance` | Banker shows Ace | Side bet up to half original bet. Pays 2:1 if banker has natural. |
| `decline-insurance` | Banker shows Ace | Decline the insurance offer |
| `even-money` | Natural 21 + banker shows Ace | Guaranteed 1:1 payout instead of risking push |
| `surrender` | First action only | Forfeit half the bet, keep the other half |

### Payouts

| Outcome | Payout |
|---------|--------|
| Natural 21 (not split) | 3:2 |
| Normal win | 1:1 |
| Split-hand 21 | 1:1 (not considered natural) |
| Insurance (banker has natural) | 2:1 on insurance bet |
| Even money | 1:1 guaranteed |
| Surrender | Lose half the bet |
| Push (tie) | Bet returned |

### Banker Rules

The banker follows fixed rules — no choice:
- Hit on 16 or less
- Stand on hard 17 or more
- **Soft 17**: Configurable via `settings.softHit17` (default: stand)

### Dealer Peek

When `settings.dealerPeek` is enabled:
- Banker shows Ace → insurance phase
- Banker shows 10-value card → peek for natural. If natural, hand ends immediately (players only lose original bet, not doubled/split amounts).
- No peek → go directly to playing phase

### Split Rules

- Only on matching-rank pair with exactly 2 cards
- Each split hand receives one new card
- **Split Aces**: Each hand receives exactly one card, then auto-stands
- **Double after split**: Configurable via `settings.doubleAfterSplit`
- **Re-split**: Allowed up to `settings.maxSplitHands` (default: 4)

## Configuration

```typescript
const roomConfig = {
  gameType: 'blackjack',
  chipProvider: { type: 'local' },
  chipUnit: 'pts',
  minBet: 10,
  maxBet: 100,
  buyIn: 500,
  commission: 0,
  settings: {
    bankerIndex: 0,           // which player is the banker
    softHit17: true,          // banker hits on soft 17
    doubleAfterSplit: true,   // allow double-down on split hands
    dealerPeek: true,         // banker peeks for natural on 10/Ace
    maxSplitHands: 4,         // max hands after splitting
  },
};
```

## Usage

```typescript
import { BlackjackPlugin } from '@game-claw/blackjack';

const plugin = new BlackjackPlugin();
// plugin.meta = { name: 'blackjack', minPlayers: 2, maxPlayers: 8 }
```

## Exports

```typescript
export class BlackjackPlugin implements GamePlugin { ... }
export function handValue(cards: Card[]): number;
export function isNatural21(cards: Card[]): boolean;
export function isSoft17(cards: Card[]): boolean;
```

## Files

```
src/
  plugin.ts    Game rules, all actions, settlement, peek logic
```
