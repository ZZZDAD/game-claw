# 10-Round Blackjack Edge Case Test

**Date**: 2026-04-08T11:14:55.121Z
**Transport**: LocalTransport (WebSocket)
**Setup**: 1 banker + 2 players, edge cases per round

## Initial Balances

- **Banker**: 1000 chips
- **Alice**: 1000 chips
- **Bob**: 1000 chips


## Round 1: Normal play (hit/stand)

| 1 | Banker | joined | id=98a89f0b |
| 1 | Alice | joined | id=6fc1c7fa |
| 1 | Bob | joined | id=fdb78c7f |
**Banker**: Banker
**Players**: Alice, Bob

| 1 | Alice | bet | 10 chips |
| 1 | Bob | bet | 10 chips |

| Player | Hand | Value |
|--------|------|-------|
| Banker | hearts-10, spades-7 | 17 |
| Alice | hearts-8, spades-5 | 13 |
| Bob | diamonds-9, clubs-7 | 16 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 1 | Alice | hit | hand=hearts-8,spades-5,hearts-3 val=16 |
| 1 | Bob | hit | hand=diamonds-9,clubs-7,diamonds-6 val=22 |
| 1 | Alice | hit | hand=hearts-8,spades-5,hearts-3,diamonds-5 val=21 |
| 1 | Alice | stand | hand=hearts-8,spades-5,hearts-3,diamonds-5 val=21 |
| 1 | Banker | stand | hand=hearts-10,spades-7 val=17 |

**Results**:

| Player | Net Change | New Balance |
|--------|-----------|-------------|
| Banker | +0 | 1000 |
| Alice | +10 | 1010 |
| Bob | -10 | 990 |

**Zero-sum**: PASS
**Winners**: Alice

## Round 2: Normal play (both stand)

| 2 | Banker | joined | id=98a89f0b |
| 2 | Alice | joined | id=6fc1c7fa |
| 2 | Bob | joined | id=fdb78c7f |
**Banker**: Banker
**Players**: Alice, Bob

| 2 | Alice | bet | 10 chips |
| 2 | Bob | bet | 10 chips |

| Player | Hand | Value |
|--------|------|-------|
| Banker | hearts-K, spades-6 | 16 |
| Alice | hearts-10, spades-9 | 19 |
| Bob | diamonds-10, clubs-8 | 18 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 2 | Alice | stand | hand=hearts-10,spades-9 val=19 |
| 2 | Bob | stand | hand=diamonds-10,clubs-8 val=18 |
| 2 | Banker | hit | hand=hearts-K,spades-6,diamonds-6 val=22 |

**Results**:

| Player | Net Change | New Balance |
|--------|-----------|-------------|
| Banker | -20 | 980 |
| Alice | +10 | 1020 |
| Bob | +10 | 1000 |

**Zero-sum**: PASS
**Winners**: Alice, Bob

## Round 3: Player natural blackjack (3:2 payout)

| 3 | Banker | joined | id=98a89f0b |
| 3 | Alice | joined | id=6fc1c7fa |
| 3 | Bob | joined | id=fdb78c7f |
**Banker**: Banker
**Players**: Alice, Bob

| 3 | Alice | bet | 10 chips |
| 3 | Bob | bet | 10 chips |

| Player | Hand | Value |
|--------|------|-------|
| Banker | hearts-10, spades-8 | 18 |
| Alice | hearts-A, spades-K | 21 (NATURAL) |
| Bob | diamonds-10, clubs-8 | 18 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 3 | Alice | stand | hand=hearts-A,spades-K val=21 |
| 3 | Bob | stand | hand=diamonds-10,clubs-8 val=18 |
| 3 | Banker | stand | hand=hearts-10,spades-8 val=18 |

**Results**:

| Player | Net Change | New Balance |
|--------|-----------|-------------|
| Banker | -15 | 965 |
| Alice | +15 | 1035 |
| Bob | +0 | 1000 |

**Zero-sum**: PASS
**Winners**: Alice
**Verification**: Alice's natural BJ should pay 3:2

## Round 4: Banker natural blackjack (all players lose)

| 4 | Banker | joined | id=98a89f0b |
| 4 | Alice | joined | id=6fc1c7fa |
| 4 | Bob | joined | id=fdb78c7f |
**Banker**: Banker
**Players**: Alice, Bob

| 4 | Alice | bet | 10 chips |
| 4 | Bob | bet | 10 chips |

| Player | Hand | Value |
|--------|------|-------|
| Banker | hearts-A, spades-K | 21 (NATURAL) |
| Alice | hearts-10, spades-9 | 19 |
| Bob | diamonds-10, clubs-8 | 18 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 4 | Alice | decline-insurance |  |
| 4 | Bob | decline-insurance |  |

**Results**:

| Player | Net Change | New Balance |
|--------|-----------|-------------|
| Banker | +20 | 985 |
| Alice | -10 | 1025 |
| Bob | -10 | 990 |

**Zero-sum**: PASS
**Winners**: (none)

## Round 5: Player busts (over 21)

| 5 | Banker | joined | id=98a89f0b |
| 5 | Alice | joined | id=6fc1c7fa |
| 5 | Bob | joined | id=fdb78c7f |
**Banker**: Banker
**Players**: Alice, Bob

| 5 | Alice | bet | 10 chips |
| 5 | Bob | bet | 10 chips |

| Player | Hand | Value |
|--------|------|-------|
| Banker | hearts-K, spades-8 | 18 |
| Alice | hearts-10, spades-6 | 16 |
| Bob | diamonds-10, clubs-9 | 19 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 5 | Alice | hit | hand=hearts-10,spades-6,clubs-10 val=26 |
| 5 | Bob | stand | hand=diamonds-10,clubs-9 val=19 |
| 5 | Banker | stand | hand=hearts-K,spades-8 val=18 |

**Results**:

| Player | Net Change | New Balance |
|--------|-----------|-------------|
| Banker | +0 | 985 |
| Alice | -10 | 1015 |
| Bob | +10 | 1000 |

**Zero-sum**: PASS
**Winners**: Bob

## Round 6: Push (tie)

| 6 | Banker | joined | id=98a89f0b |
| 6 | Alice | joined | id=6fc1c7fa |
| 6 | Bob | joined | id=fdb78c7f |
**Banker**: Banker
**Players**: Alice, Bob

| 6 | Alice | bet | 10 chips |
| 6 | Bob | bet | 10 chips |

| Player | Hand | Value |
|--------|------|-------|
| Banker | hearts-K, spades-8 | 18 |
| Alice | hearts-10, spades-8 | 18 |
| Bob | diamonds-10, clubs-8 | 18 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 6 | Alice | stand | hand=hearts-10,spades-8 val=18 |
| 6 | Bob | stand | hand=diamonds-10,clubs-8 val=18 |
| 6 | Banker | stand | hand=hearts-K,spades-8 val=18 |

**Results**:

| Player | Net Change | New Balance |
|--------|-----------|-------------|
| Banker | +0 | 985 |
| Alice | +0 | 1015 |
| Bob | +0 | 1000 |

**Zero-sum**: PASS
**Winners**: (none)

## Round 7: Player doubles down

| 7 | Banker | joined | id=98a89f0b |
| 7 | Alice | joined | id=6fc1c7fa |
| 7 | Bob | joined | id=fdb78c7f |
**Banker**: Banker
**Players**: Alice, Bob

| 7 | Alice | bet | 50 chips |
| 7 | Bob | bet | 10 chips |

| Player | Hand | Value |
|--------|------|-------|
| Banker | hearts-K, spades-7 | 17 |
| Alice | hearts-5, spades-6 | 11 |
| Bob | diamonds-10, clubs-9 | 19 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 7 | Alice | double-down | hand=hearts-5,spades-6,clubs-10 val=21 |
| 7 | Bob | stand | hand=diamonds-10,clubs-9 val=19 |
| 7 | Banker | stand | hand=hearts-K,spades-7 val=17 |

**Results**:

| Player | Net Change | New Balance |
|--------|-----------|-------------|
| Banker | -110 | 875 |
| Alice | +100 | 1115 |
| Bob | +10 | 1010 |

**Zero-sum**: PASS
**Winners**: Alice, Bob

## Round 8: Player join/leave mid-session

**Bob** leaves the table (chips: 1010)
**Charlie** joins the table (chips: 1000)

## Round 8: New player joins, another leaves

| 8 | Banker | joined | id=98a89f0b |
| 8 | Alice | joined | id=6fc1c7fa |
| 8 | Charlie | joined | id=c23047b5 |
**Banker**: Banker
**Players**: Alice, Charlie

| 8 | Alice | bet | 10 chips |
| 8 | Charlie | bet | 10 chips |

| Player | Hand | Value |
|--------|------|-------|
| Banker | hearts-K, spades-7 | 17 |
| Alice | hearts-10, spades-9 | 19 |
| Charlie | diamonds-10, clubs-7 | 17 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 8 | Alice | stand | hand=hearts-10,spades-9 val=19 |
| 8 | Charlie | stand | hand=diamonds-10,clubs-7 val=17 |
| 8 | Banker | stand | hand=hearts-K,spades-7 val=17 |

**Results**:

| Player | Net Change | New Balance |
|--------|-----------|-------------|
| Banker | -10 | 865 |
| Alice | +10 | 1125 |
| Charlie | +0 | 1000 |

**Zero-sum**: PASS
**Winners**: Alice
**Verification**: Charlie joined and played successfully

## Round 9: Player surrenders

| 9 | Banker | joined | id=98a89f0b |
| 9 | Alice | joined | id=6fc1c7fa |
| 9 | Charlie | joined | id=c23047b5 |
**Banker**: Banker
**Players**: Alice, Charlie

| 9 | Alice | bet | 10 chips |
| 9 | Charlie | bet | 10 chips |

| Player | Hand | Value |
|--------|------|-------|
| Banker | hearts-K, spades-9 | 19 |
| Alice | hearts-10, spades-6 | 16 |
| Charlie | diamonds-10, clubs-9 | 19 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 9 | Alice | surrender | hand=hearts-10,spades-6 val=16 |
| 9 | Charlie | stand | hand=diamonds-10,clubs-9 val=19 |
| 9 | Banker | stand | hand=hearts-K,spades-9 val=19 |

**Results**:

| Player | Net Change | New Balance |
|--------|-----------|-------------|
| Banker | +5 | 870 |
| Alice | -5 | 1120 |
| Charlie | +0 | 1000 |

**Zero-sum**: PASS
**Winners**: (none)

## Round 10 setup: Bob rejoins

**Bob** rejoins the table (chips: 1010)

## Round 10: Multiple outcomes: win + bust + push

| 10 | Banker | joined | id=98a89f0b |
| 10 | Alice | joined | id=6fc1c7fa |
| 10 | Bob | joined | id=fdb78c7f |
| 10 | Charlie | joined | id=c23047b5 |
**Banker**: Banker
**Players**: Alice, Bob, Charlie

| 10 | Alice | bet | 10 chips |
| 10 | Bob | bet | 10 chips |
| 10 | Charlie | bet | 10 chips |

| Player | Hand | Value |
|--------|------|-------|
| Banker | hearts-K, spades-8 | 18 |
| Alice | hearts-10, spades-10 | 20 |
| Bob | diamonds-10, clubs-4 | 14 |
| Charlie | hearts-9, spades-9 | 18 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 10 | Alice | stand | hand=hearts-10,spades-10 val=20 |
| 10 | Bob | hit | hand=diamonds-10,clubs-4,clubs-K val=24 |
| 10 | Charlie | stand | hand=hearts-9,spades-9 val=18 |
| 10 | Banker | stand | hand=hearts-K,spades-8 val=18 |

**Results**:

| Player | Net Change | New Balance |
|--------|-----------|-------------|
| Banker | +0 | 870 |
| Alice | +10 | 1130 |
| Bob | -10 | 1000 |
| Charlie | +0 | 1000 |

**Zero-sum**: PASS
**Winners**: Alice

---
## Summary

| Round | Description | Result |
|-------|-------------|--------|
| 1 | Normal play (hit/stand) | PASS |
| 2 | Normal play (both stand) | PASS |
| 3 | Player natural blackjack (3:2 payout) | PASS |
| 4 | Banker natural blackjack (all lose) | PASS |
| 5 | Player busts (over 21) | PASS |
| 6 | Push (tie) | PASS |
| 7 | Player doubles down | PASS |
| 8 | New player joins, another leaves | PASS |
| 9 | Player surrenders | PASS |
| 10 | Multiple outcomes: win + bust + push | PASS |

**Total**: 10 passed, 0 failed out of 10 rounds

## Final Balances

| Player | Chips |
|--------|-------|
| Banker | 870 |
| Alice | 1130 |
| Bob | 1000 |
| Charlie | 1000 |

## Issues

No issues found.