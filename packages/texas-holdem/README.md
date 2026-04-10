**English** | [中文](README.zh.md)

# @game-claw/texas-holdem

Texas Hold'em No-Limit poker plugin for the Game Claw engine.

## Overview

Standard No-Limit Texas Hold'em for 2-10 players. Implements the full `GamePlugin` interface including blind posting, multi-round betting, community card dealing with burn cards, side pot calculation, and hand evaluation.

## Rules

### Setup

- **Players**: 2-10
- **Deck**: Standard 52 cards
- **Positions**: Dealer button rotates each hand. Small blind = button+1, big blind = button+2.
- **Hole cards**: 2 per player, dealt one at a time starting from small blind

### Betting Rounds

| Round | Community Cards | First to Act |
|-------|----------------|-------------|
| Pre-flop | None | UTG (button+3). Heads-up: button acts first. |
| Flop | 3 cards (burn 1, deal 3) | Small blind |
| Turn | 1 card (burn 1, deal 1) | Small blind |
| River | 1 card (burn 1, deal 1) | Small blind |

### Actions

| Action | Payload | Rules |
|--------|---------|-------|
| `fold` | — | Forfeit the hand |
| `check` | — | Only when no bet to match |
| `call` | — | Match the current bet |
| `raise` | `{ amount }` | Total bet amount. Must be >= current bet + last raise size. |
| `all-in` | `{ amount }` | Bet entire remaining stack. Valid even if below min raise — but does not reopen betting unless >= min raise. |

### Raise Rules

- Minimum raise = current bet + last raise size (the "2x rule")
- Example: BB=10, player raises to 30 (raise of 20). Next min raise = 30+20 = 50.
- All-in below min raise: allowed, but does not reopen action for players who already acted.

### Side Pots

When players go all-in for different amounts, the engine automatically calculates side pots:

1. Sort all-in amounts ascending
2. Each level creates a pot containing contributions from all eligible players
3. Each pot is awarded to the best hand among its eligible players
4. Odd chip goes to the winner closest clockwise from the dealer button

### Hand Evaluation

Best 5-card hand from 7 cards (2 hole + 5 community):

| Rank | Hand |
|------|------|
| 9 | Straight Flush (includes Royal Flush) |
| 8 | Four of a Kind |
| 7 | Full House |
| 6 | Flush |
| 5 | Straight |
| 4 | Three of a Kind |
| 3 | Two Pair |
| 2 | One Pair |
| 1 | High Card |

- Ace-low straight (A-2-3-4-5 "wheel") is valid
- Ties broken by kicker cards in descending order

### Commission

Per-player fee deducted at hand start, credited to dealer at hand end. Not taken from the pot.

## Usage

```typescript
import { TexasHoldemPlugin } from '@game-claw/texas-holdem';

const plugin = new TexasHoldemPlugin();
// plugin.meta = { name: 'texas-holdem', minPlayers: 2, maxPlayers: 10 }
```

Pass to `DealerNode`:

```typescript
const dealer = new DealerNode(plugin, identity, version, {
  gameType: 'texas-holdem',
  chipProvider: { type: 'http', url: 'http://127.0.0.1:3100', authToken: '<token>' },
  chipUnit: 'pts',
  minBet: 10,   // small blind
  maxBet: 100,
  buyIn: 500,
  commission: 2,
});
```

## Files

```
src/
  plugin.ts       Game rules, betting, side pots, commission
  hand-eval.ts    Hand ranking and comparison
```
