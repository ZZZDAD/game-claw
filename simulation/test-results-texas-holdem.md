# 20-Round Texas Hold'em Edge Case Test

**Date**: 2026-04-08T11:08:35.923Z
**Transport**: LocalTransport (in-process WebSocket)
**Players**: 5 bots | **Blinds**: 5/10 | **Buy-in**: 1000 | **Commission**: 5/player/round

## Initial Balances

- **Alice**: 1000
- **Bob**: 1000
- **Charlie**: 1000
- **Diana**: 1000
- **Eve**: 1000

**Initial total**: 5000


---
## Round 1

**Description**: Normal play (all call/check through)
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Alice | **SB**: Bob (5) | **BB**: Charlie (10)

**Balances before**:
  Alice: 1000
  Bob: 1000
  Charlie: 1000
  Diana: 1000
  Eve: 1000

| Player | Hole Cards |
|--------|-----------|
| Alice | clubs-10, hearts-Q |
| Bob | spades-8, hearts-6 |
| Charlie | hearts-A, diamonds-5 |
| Diana | diamonds-J, hearts-5 |
| Eve | spades-J, clubs-J |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 1 | Diana | call |  |
| 1 | Eve | call |  |
| 1 | Alice | call |  |
| 1 | Bob | call |  |
| 1 | Charlie | check |  |
| 1 | Bob | check |  |
| 1 | Charlie | check |  |
| 1 | Diana | check |  |
| 1 | Eve | check |  |
| 1 | Alice | check |  |
| 1 | Bob | check |  |
| 1 | Charlie | check |  |
| 1 | Diana | check |  |
| 1 | Eve | check |  |
| 1 | Alice | check |  |
| 1 | Bob | check |  |
| 1 | Charlie | check |  |
| 1 | Diana | check |  |
| 1 | Eve | check |  |
| 1 | Alice | check |  |

**Community**: hearts-4, diamonds-8, hearts-K, hearts-10, spades-6
**Winners**: Bob

| Player | Net Change |
|--------|-----------|
| Alice | -15 |
| Bob | +35 |
| Charlie | -15 |
| Diana | -15 |
| Eve | -15 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 980
  Bob: 1025
  Charlie: 970
  Diana: 980
  Eve: 980
  Dealer: 25

**Round 1 result**: PASS

---
## Round 2

**Description**: Normal play (all call/check through)
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Bob | **SB**: Charlie (5) | **BB**: Diana (10)

**Balances before**:
  Alice: 980
  Bob: 1025
  Charlie: 970
  Diana: 980
  Eve: 980

| Player | Hole Cards |
|--------|-----------|
| Alice | clubs-6, diamonds-A |
| Bob | hearts-6, spades-9 |
| Charlie | clubs-Q, diamonds-4 |
| Diana | hearts-4, hearts-10 |
| Eve | hearts-K, clubs-7 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 2 | Eve | call |  |
| 2 | Alice | call |  |
| 2 | Bob | call |  |
| 2 | Charlie | call |  |
| 2 | Diana | check |  |
| 2 | Charlie | check |  |
| 2 | Diana | check |  |
| 2 | Eve | check |  |
| 2 | Alice | check |  |
| 2 | Bob | check |  |
| 2 | Charlie | check |  |
| 2 | Diana | check |  |
| 2 | Eve | check |  |
| 2 | Alice | check |  |
| 2 | Bob | check |  |
| 2 | Charlie | check |  |
| 2 | Diana | check |  |
| 2 | Eve | check |  |
| 2 | Alice | check |  |
| 2 | Bob | check |  |

**Community**: hearts-5, spades-K, spades-A, clubs-K, clubs-5
**Winners**: Eve

| Player | Net Change |
|--------|-----------|
| Alice | -15 |
| Bob | -15 |
| Charlie | -15 |
| Diana | -15 |
| Eve | +35 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 960
  Bob: 1005
  Charlie: 945
  Diana: 950
  Eve: 1010
  Dealer: 50

**Round 2 result**: PASS

---
## Round 3

**Description**: Normal play (all call/check through)
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Charlie | **SB**: Diana (5) | **BB**: Eve (10)

**Balances before**:
  Alice: 960
  Bob: 1005
  Charlie: 945
  Diana: 950
  Eve: 1010

| Player | Hole Cards |
|--------|-----------|
| Alice | clubs-5, hearts-3 |
| Bob | clubs-8, diamonds-2 |
| Charlie | diamonds-9, clubs-6 |
| Diana | spades-9, hearts-A |
| Eve | hearts-8, hearts-10 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 3 | Alice | call |  |
| 3 | Bob | call |  |
| 3 | Charlie | call |  |
| 3 | Diana | call |  |
| 3 | Eve | check |  |
| 3 | Diana | check |  |
| 3 | Eve | check |  |
| 3 | Alice | check |  |
| 3 | Bob | check |  |
| 3 | Charlie | check |  |
| 3 | Diana | check |  |
| 3 | Eve | check |  |
| 3 | Alice | check |  |
| 3 | Bob | check |  |
| 3 | Charlie | check |  |
| 3 | Diana | check |  |
| 3 | Eve | check |  |
| 3 | Alice | check |  |
| 3 | Bob | check |  |
| 3 | Charlie | check |  |

**Community**: spades-8, spades-3, spades-J, diamonds-6, hearts-7
**Winners**: Eve

| Player | Net Change |
|--------|-----------|
| Alice | -15 |
| Bob | -15 |
| Charlie | -15 |
| Diana | -15 |
| Eve | +35 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 940
  Bob: 985
  Charlie: 925
  Diana: 925
  Eve: 1030
  Dealer: 75

**Round 3 result**: PASS

---
## Round 4

**Description**: All players fold except one (last player wins without showdown)
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Diana | **SB**: Eve (5) | **BB**: Alice (10)

**Balances before**:
  Alice: 940
  Bob: 985
  Charlie: 925
  Diana: 925
  Eve: 1030

| Player | Hole Cards |
|--------|-----------|
| Alice | diamonds-10, spades-8 |
| Bob | hearts-10, diamonds-3 |
| Charlie | hearts-5, hearts-2 |
| Diana | diamonds-7, hearts-3 |
| Eve | clubs-4, hearts-J |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 4 | Bob | fold |  |
| 4 | Charlie | raise | to 20 |
| 4 | Diana | fold |  |
| 4 | Eve | fold |  |
| 4 | Alice | fold |  |

**Community**: (none)
**Winners**: Charlie

| Player | Net Change |
|--------|-----------|
| Alice | -15 |
| Bob | -5 |
| Charlie | +10 |
| Diana | -5 |
| Eve | -10 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 910
  Bob: 975
  Charlie: 930
  Diana: 915
  Eve: 1010
  Dealer: 100

**Round 4 result**: PASS

---
## Round 5

**Description**: Player goes all-in with short stack
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Eve | **SB**: Alice (5) | **BB**: Bob (10)

**Balances before**:
  Alice: 30
  Bob: 975
  Charlie: 930
  Diana: 915
  Eve: 1010

| Player | Hole Cards |
|--------|-----------|
| Alice | clubs-J, clubs-A |
| Bob | hearts-A, hearts-5 |
| Charlie | diamonds-A, spades-K |
| Diana | hearts-J, spades-Q |
| Eve | spades-4, clubs-10 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 5 | Charlie | call |  |
| 5 | Diana | call |  |
| 5 | Eve | call |  |
| 5 | Alice | all-in | amount=1000 |
| 5 | Bob | call |  |
| 5 | Charlie | call |  |
| 5 | Diana | call |  |
| 5 | Eve | call |  |
| 5 | Bob | check |  |
| 5 | Charlie | check |  |
| 5 | Diana | check |  |
| 5 | Eve | check |  |
| 5 | Bob | check |  |
| 5 | Charlie | check |  |
| 5 | Diana | check |  |
| 5 | Eve | check |  |
| 5 | Bob | check |  |
| 5 | Charlie | check |  |
| 5 | Diana | check |  |
| 5 | Eve | check |  |

**Community**: diamonds-10, hearts-K, clubs-2, hearts-Q, diamonds-J
**Winners**: Alice, Bob, Charlie

| Player | Net Change |
|--------|-----------|
| Alice | +663 |
| Bob | +661 |
| Charlie | +661 |
| Diana | -1005 |
| Eve | -1005 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 1678
  Bob: 2611
  Charlie: 2576
  Diana: 895
  Eve: 0
  Dealer: 125

**Round 5 result**: PASS

---
## Round 6

**Description**: Multiple players all-in at different stack levels (side pots)
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Alice | **SB**: Bob (5) | **BB**: Charlie (10)

**Balances before**:
  Alice: 1678
  Bob: 100
  Charlie: 200
  Diana: 895
  Eve: 0

| Player | Hole Cards |
|--------|-----------|
| Alice | diamonds-5, diamonds-10 |
| Bob | spades-A, clubs-J |
| Charlie | diamonds-4, hearts-9 |
| Diana | hearts-10, spades-5 |
| Eve | diamonds-Q, diamonds-7 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 6 | Diana | call |  |
| 6 | Eve | call |  |
| 6 | Alice | all-in | amount=1000 |
| 6 | Bob | all-in | amount=1000 |
| 6 | Charlie | all-in | amount=1000 |
| 6 | Diana | call |  |
| 6 | Eve | call |  |
| 6 | Diana | check |  |
| 6 | Eve | check |  |
| 6 | Diana | check |  |
| 6 | Eve | check |  |
| 6 | Diana | check |  |
| 6 | Eve | check |  |

**Community**: hearts-Q, clubs-Q, hearts-A, clubs-8, diamonds-J
**Winners**: Eve

| Player | Net Change |
|--------|-----------|
| Alice | -1005 |
| Bob | -1005 |
| Charlie | -1005 |
| Diana | -1005 |
| Eve | +3995 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 668
  Bob: 80
  Charlie: 170
  Diana: 875
  Eve: 5000
  Dealer: 150

**Round 6 result**: PASS

---
## Round 7

**Description**: Normal play (tied hands resolved by hand evaluator)
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Bob | **SB**: Charlie (5) | **BB**: Diana (10)

**Balances before**:
  Alice: 668
  Bob: 80
  Charlie: 170
  Diana: 875
  Eve: 5000

| Player | Hole Cards |
|--------|-----------|
| Alice | diamonds-5, hearts-10 |
| Bob | diamonds-8, clubs-A |
| Charlie | hearts-4, spades-10 |
| Diana | clubs-3, hearts-2 |
| Eve | spades-J, spades-K |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 7 | Eve | call |  |
| 7 | Alice | call |  |
| 7 | Bob | call |  |
| 7 | Charlie | call |  |
| 7 | Diana | check |  |
| 7 | Charlie | check |  |
| 7 | Diana | check |  |
| 7 | Eve | check |  |
| 7 | Alice | check |  |
| 7 | Bob | check |  |
| 7 | Charlie | check |  |
| 7 | Diana | check |  |
| 7 | Eve | check |  |
| 7 | Alice | check |  |
| 7 | Bob | check |  |
| 7 | Charlie | check |  |
| 7 | Diana | check |  |
| 7 | Eve | check |  |
| 7 | Alice | check |  |
| 7 | Bob | check |  |

**Community**: clubs-5, hearts-8, hearts-7, spades-Q, diamonds-2
**Winners**: Bob

| Player | Net Change |
|--------|-----------|
| Alice | -15 |
| Bob | +35 |
| Charlie | -15 |
| Diana | -15 |
| Eve | -15 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 648
  Bob: 110
  Charlie: 145
  Diana: 845
  Eve: 4980
  Dealer: 175

**Round 7 result**: PASS

---
## Round 8

**Description**: Player timeout (simulated disconnect, auto-fold/check)
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Charlie | **SB**: Diana (5) | **BB**: Eve (10)

**Balances before**:
  Alice: 648
  Bob: 110
  Charlie: 145
  Diana: 845
  Eve: 4980

| Player | Hole Cards |
|--------|-----------|
| Alice | diamonds-3, clubs-A |
| Bob | clubs-5, hearts-7 |
| Charlie | hearts-2, clubs-10 |
| Diana | clubs-6, clubs-Q |
| Eve | spades-A, hearts-Q |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 8 | Alice | call |  |
| 8 | Bob | call |  |
| 8 | Charlie | call |  |
| 8 | Diana | TIMEOUT | (simulated) |
| 8 | Diana | auto:fold |  |
| 8 | Eve | check |  |
| 8 | Eve | check |  |
| 8 | Alice | check |  |
| 8 | Bob | check |  |
| 8 | Charlie | check |  |
| 8 | Eve | check |  |
| 8 | Alice | check |  |
| 8 | Bob | check |  |
| 8 | Charlie | check |  |
| 8 | Eve | check |  |
| 8 | Alice | check |  |
| 8 | Bob | check |  |
| 8 | Charlie | check |  |

**Community**: spades-K, hearts-9, spades-2, clubs-2, diamonds-7
**Winners**: Charlie

| Player | Net Change |
|--------|-----------|
| Alice | -15 |
| Bob | -15 |
| Charlie | +30 |
| Diana | -10 |
| Eve | -15 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 628
  Bob: 90
  Charlie: 170
  Diana: 825
  Eve: 4950
  Dealer: 200

**Round 8 result**: PASS

---
## Round 9

**Description**: Player with very low chips joins (edge case for blinds)
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Diana | **SB**: Eve (5) | **BB**: Alice (10)

**Balances before**:
  Alice: 628
  Bob: 90
  Charlie: 170
  Diana: 825
  Eve: 4950

| Player | Hole Cards |
|--------|-----------|
| Alice | hearts-6, spades-9 |
| Bob | diamonds-A, spades-4 |
| Charlie | diamonds-9, clubs-A |
| Diana | diamonds-8, diamonds-3 |
| Eve | clubs-8, clubs-3 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 9 | Bob | call |  |
| 9 | Charlie | call |  |
| 9 | Diana | call |  |
| 9 | Eve | call |  |
| 9 | Alice | check |  |
| 9 | Eve | check |  |
| 9 | Alice | check |  |
| 9 | Bob | check |  |
| 9 | Charlie | check |  |
| 9 | Diana | check |  |
| 9 | Eve | check |  |
| 9 | Alice | check |  |
| 9 | Bob | check |  |
| 9 | Charlie | check |  |
| 9 | Diana | check |  |
| 9 | Eve | check |  |
| 9 | Alice | check |  |
| 9 | Bob | check |  |
| 9 | Charlie | check |  |
| 9 | Diana | check |  |

**Community**: hearts-8, hearts-3, hearts-A, clubs-J, spades-7
**Winners**: Diana, Eve

| Player | Net Change |
|--------|-----------|
| Alice | -15 |
| Bob | -15 |
| Charlie | -15 |
| Diana | +10 |
| Eve | +10 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 598
  Bob: 70
  Charlie: 150
  Diana: 830
  Eve: 4950
  Dealer: 225

**Round 9 result**: PASS

---
## Round 10

**Description**: Normal play with raises
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Eve | **SB**: Alice (5) | **BB**: Bob (10)

**Balances before**:
  Alice: 598
  Bob: 70
  Charlie: 150
  Diana: 830
  Eve: 4950

| Player | Hole Cards |
|--------|-----------|
| Alice | hearts-5, spades-10 |
| Bob | diamonds-Q, hearts-4 |
| Charlie | diamonds-3, hearts-8 |
| Diana | spades-J, spades-K |
| Eve | diamonds-A, diamonds-6 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 10 | Charlie | call |  |
| 10 | Diana | call |  |
| 10 | Eve | call |  |
| 10 | Alice | call |  |
| 10 | Bob | check |  |
| 10 | Alice | raise | to 10 |
| 10 | Bob | call |  |
| 10 | Charlie | call |  |
| 10 | Diana | raise | to 20 |
| 10 | Eve | raise | to 30 |
| 10 | Alice | call |  |
| 10 | Bob | call |  |
| 10 | Charlie | call |  |
| 10 | Diana | call |  |
| 10 | Alice | check |  |
| 10 | Bob | check |  |
| 10 | Charlie | check |  |
| 10 | Diana | check |  |
| 10 | Eve | check |  |
| 10 | Alice | check |  |
| 10 | Bob | check |  |
| 10 | Charlie | check |  |
| 10 | Diana | check |  |
| 10 | Eve | check |  |

**Community**: spades-5, clubs-A, diamonds-K, diamonds-J, hearts-2
**Winners**: Diana

| Player | Net Change |
|--------|-----------|
| Alice | -45 |
| Bob | -45 |
| Charlie | -45 |
| Diana | +155 |
| Eve | -45 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 543
  Bob: 10
  Charlie: 100
  Diana: 980
  Eve: 4900
  Dealer: 250

**Round 10 result**: PASS

---
## Round 11

**Description**: Normal play with raises
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Alice | **SB**: Bob (5) | **BB**: Charlie (10)

**Balances before**:
  Alice: 543
  Bob: 10
  Charlie: 100
  Diana: 980
  Eve: 4900

| Player | Hole Cards |
|--------|-----------|
| Alice | hearts-3, spades-A |
| Bob | clubs-3, clubs-5 |
| Charlie | diamonds-K, spades-10 |
| Diana | clubs-8, diamonds-3 |
| Eve | spades-Q, diamonds-9 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 11 | Diana | call |  |
| 11 | Eve | call |  |
| 11 | Alice | call |  |
| 11 | Bob | call |  |
| 11 | Charlie | check |  |
| 11 | Bob | check |  |
| 11 | Charlie | check |  |
| 11 | Diana | check |  |
| 11 | Eve | check |  |
| 11 | Alice | check |  |
| 11 | Bob | check |  |
| 11 | Charlie | check |  |
| 11 | Diana | check |  |
| 11 | Eve | check |  |
| 11 | Alice | check |  |
| 11 | Bob | raise | to 10 |
| 11 | Charlie | call |  |
| 11 | Diana | call |  |
| 11 | Eve | raise | to 20 |
| 11 | Alice | call |  |
| 11 | Bob | raise | to 30 |
| 11 | Charlie | raise | to 40 |
| 11 | Diana | call |  |
| 11 | Eve | raise | to 50 |
| 11 | Alice | call |  |
| 11 | Bob | call |  |
| 11 | Charlie | call |  |
| 11 | Diana | raise | to 60 |
| 11 | Eve | call |  |
| 11 | Alice | call |  |
| 11 | Bob | call |  |
| 11 | Charlie | raise | to 70 |
| 11 | Diana | call |  |
| 11 | Eve | call |  |
| 11 | Alice | call |  |
| 11 | Bob | raise | to 80 |
| 11 | Charlie | raise | to 90 |
| 11 | Diana | raise | to 100 |
| 11 | Eve | call |  |
| 11 | Alice | call |  |
| 11 | Bob | call |  |
| 11 | Charlie | call |  |

**Community**: diamonds-4, diamonds-Q, hearts-5, diamonds-2, spades-5
**Winners**: Alice

| Player | Net Change |
|--------|-----------|
| Alice | +435 |
| Bob | -115 |
| Charlie | -115 |
| Diana | -115 |
| Eve | -115 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 973
  Bob: 0
  Charlie: 0
  Diana: 860
  Eve: 4780
  Dealer: 275

**Round 11 result**: PASS

---
## Round 12

**Description**: Normal play with raises
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Bob | **SB**: Charlie (5) | **BB**: Diana (10)

**Balances before**:
  Alice: 973
  Bob: 0
  Charlie: 0
  Diana: 860
  Eve: 4780

| Player | Hole Cards |
|--------|-----------|
| Alice | clubs-A, clubs-K |
| Bob | clubs-3, hearts-5 |
| Charlie | hearts-4, hearts-6 |
| Diana | spades-4, spades-2 |
| Eve | diamonds-9, diamonds-7 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 12 | Eve | raise | to 20 |
| 12 | Alice | raise | to 30 |
| 12 | Bob | call |  |
| 12 | Charlie | call |  |
| 12 | Diana | call |  |
| 12 | Eve | raise | to 40 |
| 12 | Alice | call |  |
| 12 | Bob | call |  |
| 12 | Charlie | call |  |
| 12 | Diana | call |  |
| 12 | Charlie | check |  |
| 12 | Diana | raise | to 10 |
| 12 | Eve | raise | to 20 |
| 12 | Alice | raise | to 30 |
| 12 | Bob | call |  |
| 12 | Charlie | call |  |
| 12 | Diana | call |  |
| 12 | Eve | raise | to 40 |
| 12 | Alice | call |  |
| 12 | Bob | raise | to 50 |
| 12 | Charlie | call |  |
| 12 | Diana | call |  |
| 12 | Eve | call |  |
| 12 | Alice | call |  |
| 12 | Charlie | check |  |
| 12 | Diana | raise | to 10 |
| 12 | Eve | call |  |
| 12 | Alice | call |  |
| 12 | Bob | call |  |
| 12 | Charlie | call |  |
| 12 | Charlie | check |  |
| 12 | Diana | check |  |
| 12 | Eve | raise | to 10 |
| 12 | Alice | raise | to 20 |
| 12 | Bob | call |  |
| 12 | Charlie | raise | to 30 |
| 12 | Diana | raise | to 40 |
| 12 | Eve | call |  |
| 12 | Alice | call |  |
| 12 | Bob | call |  |
| 12 | Charlie | call |  |

**Community**: clubs-J, spades-6, hearts-9, hearts-2, hearts-J
**Winners**: Charlie

| Player | Net Change |
|--------|-----------|
| Alice | -145 |
| Bob | -145 |
| Charlie | +555 |
| Diana | -145 |
| Eve | -145 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 823
  Bob: 0
  Charlie: 700
  Diana: 700
  Eve: 4630
  Dealer: 300

**Round 12 result**: PASS

---
## Round 13

**Description**: All players all-in preflop
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Charlie | **SB**: Diana (5) | **BB**: Eve (10)

**Balances before**:
  Alice: 823
  Bob: 0
  Charlie: 700
  Diana: 700
  Eve: 4630

| Player | Hole Cards |
|--------|-----------|
| Alice | diamonds-3, hearts-10 |
| Bob | hearts-3, hearts-Q |
| Charlie | hearts-7, hearts-4 |
| Diana | diamonds-5, spades-8 |
| Eve | spades-J, spades-10 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 13 | Alice | all-in | amount=1000 |
| 13 | Bob | all-in | amount=1000 |
| 13 | Charlie | all-in | amount=1000 |
| 13 | Diana | all-in | amount=1000 |
| 13 | Eve | all-in | amount=1000 |

**Community**: (none)
**Winners**: 

| Player | Net Change |
|--------|-----------|
| Alice | -1005 |
| Bob | -1005 |
| Charlie | -1005 |
| Diana | -1005 |
| Eve | -1005 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 813
  Bob: 0
  Charlie: 690
  Diana: 680
  Eve: 3610
  Dealer: 325

**Round 13 result**: PASS

---
## Round 14

**Description**: Player tries invalid action (invalid raise amount)
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Diana | **SB**: Eve (5) | **BB**: Alice (10)

**Balances before**:
  Alice: 813
  Bob: 0
  Charlie: 690
  Diana: 680
  Eve: 3610

| Player | Hole Cards |
|--------|-----------|
| Alice | diamonds-Q, clubs-5 |
| Bob | hearts-A, spades-5 |
| Charlie | hearts-Q, spades-9 |
| Diana | clubs-8, spades-4 |
| Eve | spades-10, hearts-4 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 14 | Bob | call |  |
| 14 | Charlie | REJECTED:raise | to 1 |
| 14 | Charlie | fold | (fallback after rejection) |
| 14 | Diana | call |  |
| 14 | Eve | call |  |
| 14 | Alice | check |  |
| 14 | Eve | check |  |
| 14 | Alice | check |  |
| 14 | Bob | check |  |
| 14 | Diana | check |  |
| 14 | Eve | check |  |
| 14 | Alice | check |  |
| 14 | Bob | check |  |
| 14 | Diana | check |  |
| 14 | Eve | check |  |
| 14 | Alice | check |  |
| 14 | Bob | check |  |
| 14 | Diana | check |  |

**Community**: hearts-9, clubs-Q, clubs-A, diamonds-10, hearts-7
**Winners**: Bob

| Player | Net Change |
|--------|-----------|
| Alice | -15 |
| Bob | +25 |
| Charlie | -5 |
| Diana | -15 |
| Eve | -15 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 783
  Bob: 40
  Charlie: 680
  Diana: 660
  Eve: 3585
  Dealer: 350

**Round 14 result**: PASS

---
## Round 15

**Description**: Normal play with mixed strategies
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Eve | **SB**: Alice (5) | **BB**: Bob (10)

**Balances before**:
  Alice: 783
  Bob: 40
  Charlie: 680
  Diana: 660
  Eve: 3585

| Player | Hole Cards |
|--------|-----------|
| Alice | hearts-Q, hearts-7 |
| Bob | hearts-3, clubs-J |
| Charlie | hearts-J, clubs-A |
| Diana | spades-4, spades-J |
| Eve | spades-9, hearts-9 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 15 | Charlie | call |  |
| 15 | Diana | fold |  |
| 15 | Eve | fold |  |
| 15 | Alice | all-in | amount=1000 |
| 15 | Bob | all-in | amount=1000 |
| 15 | Charlie | all-in | amount=1000 |

**Community**: (none)
**Winners**: 

| Player | Net Change |
|--------|-----------|
| Alice | -1005 |
| Bob | -1005 |
| Charlie | -1005 |
| Diana | -5 |
| Eve | -5 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 763
  Bob: 10
  Charlie: 660
  Diana: 650
  Eve: 3575
  Dealer: 375

**Round 15 result**: PASS

---
## Round 16

**Description**: Normal play with mixed strategies
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Alice | **SB**: Bob (5) | **BB**: Charlie (10)

**Balances before**:
  Alice: 763
  Bob: 10
  Charlie: 660
  Diana: 650
  Eve: 3575

| Player | Hole Cards |
|--------|-----------|
| Alice | hearts-9, spades-5 |
| Bob | spades-A, diamonds-3 |
| Charlie | diamonds-K, spades-9 |
| Diana | clubs-A, clubs-3 |
| Eve | clubs-5, spades-6 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 16 | Diana | call |  |
| 16 | Eve | call |  |
| 16 | Alice | all-in | amount=1000 |
| 16 | Bob | fold |  |
| 16 | Charlie | all-in | amount=1000 |
| 16 | Diana | all-in | amount=1000 |
| 16 | Eve | all-in | amount=1000 |

**Community**: (none)
**Winners**: 

| Player | Net Change |
|--------|-----------|
| Alice | -1005 |
| Bob | -10 |
| Charlie | -1005 |
| Diana | -1005 |
| Eve | -1005 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 753
  Bob: 0
  Charlie: 630
  Diana: 630
  Eve: 2565
  Dealer: 400

**Round 16 result**: PASS

---
## Round 17

**Description**: Normal play with mixed strategies
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Bob | **SB**: Charlie (5) | **BB**: Diana (10)

**Balances before**:
  Alice: 753
  Bob: 0
  Charlie: 630
  Diana: 630
  Eve: 2565

| Player | Hole Cards |
|--------|-----------|
| Alice | clubs-J, spades-7 |
| Bob | spades-A, spades-10 |
| Charlie | spades-3, diamonds-4 |
| Diana | spades-6, diamonds-J |
| Eve | spades-5, hearts-7 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 17 | Eve | raise | to 20 |
| 17 | Alice | call |  |
| 17 | Bob | all-in | amount=1000 |
| 17 | Charlie | fold |  |
| 17 | Diana | call |  |
| 17 | Eve | call |  |
| 17 | Alice | all-in | amount=1000 |
| 17 | Diana | fold |  |
| 17 | Eve | check |  |

**Community**: spades-2, spades-9, diamonds-7
**Winners**: Alice

| Player | Net Change |
|--------|-----------|
| Alice | +3000 |
| Bob | -1005 |
| Charlie | -10 |
| Diana | -1005 |
| Eve | -1005 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 4728
  Bob: 0
  Charlie: 610
  Diana: 600
  Eve: 1555
  Dealer: 425

**Round 17 result**: PASS

---
## Round 18

**Description**: Heads-up (only 2 players)
**Players**: Alice, Bob
**Button**: Bob | **SB**: Bob (5) | **BB**: Alice (10)

**Balances before**:
  Alice: 4728
  Bob: 200

| Player | Hole Cards |
|--------|-----------|
| Alice | clubs-3, hearts-8 |
| Bob | spades-3, spades-2 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 18 | Bob | call |  |
| 18 | Alice | check |  |
| 18 | Bob | check |  |
| 18 | Alice | check |  |
| 18 | Bob | raise | to 10 |
| 18 | Alice | call |  |
| 18 | Bob | check |  |
| 18 | Alice | raise | to 10 |
| 18 | Bob | call |  |

**Community**: hearts-A, diamonds-3, clubs-2, spades-J, spades-6
**Winners**: Bob

| Player | Net Change |
|--------|-----------|
| Alice | -35 |
| Bob | +25 |
| Dealer (commission) | +10 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 4678
  Bob: 215
  Dealer: 435

**Round 18 result**: PASS

---
## Round 19

**Description**: Normal play (final rounds)
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Diana | **SB**: Eve (5) | **BB**: Alice (10)

**Balances before**:
  Alice: 4678
  Bob: 215
  Charlie: 610
  Diana: 600
  Eve: 1555

| Player | Hole Cards |
|--------|-----------|
| Alice | diamonds-10, diamonds-7 |
| Bob | spades-8, diamonds-8 |
| Charlie | diamonds-4, clubs-10 |
| Diana | spades-A, diamonds-Q |
| Eve | diamonds-2, hearts-Q |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 19 | Bob | call |  |
| 19 | Charlie | call |  |
| 19 | Diana | call |  |
| 19 | Eve | call |  |
| 19 | Alice | check |  |
| 19 | Eve | check |  |
| 19 | Alice | check |  |
| 19 | Bob | check |  |
| 19 | Charlie | check |  |
| 19 | Diana | check |  |
| 19 | Eve | check |  |
| 19 | Alice | check |  |
| 19 | Bob | check |  |
| 19 | Charlie | check |  |
| 19 | Diana | check |  |
| 19 | Eve | check |  |
| 19 | Alice | check |  |
| 19 | Bob | check |  |
| 19 | Charlie | check |  |
| 19 | Diana | check |  |

**Community**: hearts-A, clubs-4, diamonds-9, hearts-8, clubs-2
**Winners**: Bob

| Player | Net Change |
|--------|-----------|
| Alice | -15 |
| Bob | +35 |
| Charlie | -15 |
| Diana | -15 |
| Eve | -15 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 4648
  Bob: 245
  Charlie: 590
  Diana: 580
  Eve: 1530
  Dealer: 460

**Round 19 result**: PASS

---
## Round 20

**Description**: Normal play (final rounds)
**Players**: Alice, Bob, Charlie, Diana, Eve
**Button**: Eve | **SB**: Alice (5) | **BB**: Bob (10)

**Balances before**:
  Alice: 4648
  Bob: 245
  Charlie: 590
  Diana: 580
  Eve: 1530

| Player | Hole Cards |
|--------|-----------|
| Alice | hearts-7, spades-7 |
| Bob | hearts-3, spades-10 |
| Charlie | diamonds-8, clubs-10 |
| Diana | hearts-5, diamonds-9 |
| Eve | spades-9, clubs-2 |

| Round | Player | Action | Detail |
|-------|--------|--------|--------|
| 20 | Charlie | call |  |
| 20 | Diana | call |  |
| 20 | Eve | call |  |
| 20 | Alice | call |  |
| 20 | Bob | check |  |
| 20 | Alice | check |  |
| 20 | Bob | check |  |
| 20 | Charlie | check |  |
| 20 | Diana | check |  |
| 20 | Eve | check |  |
| 20 | Alice | check |  |
| 20 | Bob | check |  |
| 20 | Charlie | check |  |
| 20 | Diana | check |  |
| 20 | Eve | check |  |
| 20 | Alice | check |  |
| 20 | Bob | check |  |
| 20 | Charlie | check |  |
| 20 | Diana | check |  |
| 20 | Eve | check |  |

**Community**: diamonds-J, diamonds-5, hearts-4, spades-6, spades-Q
**Winners**: Alice

| Player | Net Change |
|--------|-----------|
| Alice | +35 |
| Bob | -15 |
| Charlie | -15 |
| Diana | -15 |
| Eve | -15 |
| Dealer (commission) | +25 |

**Crypto verification**: PASS

**Balances after**:
  Alice: 4673
  Bob: 215
  Charlie: 570
  Diana: 560
  Eve: 1510
  Dealer: 485

**Round 20 result**: PASS

---
## Final Balances

| Player | Balance |
|--------|---------|
| Alice | 4673 |
| Bob | 215 |
| Charlie | 570 |
| Diana | 560 |
| Eve | 1510 |
| Dealer | 485 |

## Zero-Sum Verification

| Metric | Value |
|--------|-------|
| Player total | 7528 |
| Dealer total | 485 |
| Grand total | 8013 |
| Initial total | 5000 |

---
## Issues Found

No issues found - all 20 rounds completed successfully.

---
## Summary

**Rounds passed**: 20/20
**Issues**: 0