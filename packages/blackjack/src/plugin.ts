import type { GamePlugin, GameState, Card, DealPlan, PlayerAction, GameResult, PlayerInfo, RoomConfig, ApplyActionResult, PendingAction } from '@game-claw/core';
import { deepCloneState } from '@game-claw/core';

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export function handValue(cards: Card[]): number {
  let value = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') { aces++; value += 11; }
    else if (['K', 'Q', 'J'].includes(card.rank)) value += 10;
    else value += parseInt(card.rank);
  }
  while (value > 21 && aces > 0) { value -= 10; aces--; }
  return value;
}

export function isNatural21(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

/** Returns true if the hand totals exactly 17 with an Ace counted as 11 (soft 17). */
export function isSoft17(cards: Card[]): boolean {
  let value = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') { aces++; value += 11; }
    else if (['K', 'Q', 'J'].includes(card.rank)) value += 10;
    else value += parseInt(card.rank);
  }
  // Reduce aces only until value <= 21, then check if value is 17 and at least one ace still counts as 11
  let acesReduced = 0;
  while (value > 21 && acesReduced < aces) { value -= 10; acesReduced++; }
  return value === 17 && acesReduced < aces;
}

function sameRank(cards: Card[]): boolean {
  return cards.length === 2 && cards[0].rank === cards[1].rank;
}

export class BlackjackPlugin implements GamePlugin {
  meta = {
    name: 'blackjack',
    displayName: 'Blackjack',
    minPlayers: 2,  // at least 1 banker + 1 player
    maxPlayers: 8,  // 1 banker + up to 7 players
    version: '0.2.0',
  };

  createDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ id: `${suit}-${rank}`, suit, rank });
      }
    }
    return deck;
  }

  createGame(players: PlayerInfo[], options?: Record<string, unknown>): GameState {
    const roomConfig = options?.roomConfig as RoomConfig | undefined;
    const settings = roomConfig?.settings ?? {};
    const bankerIndex = (settings.bankerIndex as number) ?? 0;
    const bankerId = players[bankerIndex].id;

    const normalPlayerIds = players.filter((p) => p.id !== bankerId).map((p) => p.id);

    const stood: Record<string, boolean> = {};
    const busted: Record<string, boolean> = {};
    const bets: Record<string, number> = {};
    players.forEach((p) => {
      stood[p.id] = false;
      busted[p.id] = false;
      bets[p.id] = 0;
    });

    stood[bankerId] = true;

    return {
      phase: 'betting',
      players,
      hands: {},
      communityCards: [],
      currentPlayerIndex: bankerIndex === 0 ? 1 : 0,
      roundData: {
        stood,
        busted,
        bets,
        bankerId,
        bankerIndex,
        normalPlayerIds,
        minBet: roomConfig?.minBet ?? 10,
        maxBet: roomConfig?.maxBet ?? 100,
        // Room settings (configurable edge-case rules)
        softHit17: (settings.softHit17 as boolean) ?? false,
        doubleAfterSplit: (settings.doubleAfterSplit as boolean) ?? true,
        maxSplitHands: (settings.maxSplitHands as number) ?? 4,
        dealerPeek: (settings.dealerPeek as boolean) ?? true,
        // Feature tracking
        insurance: {} as Record<string, number>,       // playerId -> insurance bet amount
        evenMoney: {} as Record<string, boolean>,       // playerId -> true if took even money
        surrendered: {} as Record<string, boolean>,     // playerId -> true if surrendered
        doubled: {} as Record<string, boolean>,         // playerId -> true if doubled down
        splitHands: {} as Record<string, Card[][]>,     // playerId -> array of hands (each is Card[])
        splitBets: {} as Record<string, number[]>,      // playerId -> bet for each split hand
        splitStood: {} as Record<string, boolean[]>,    // playerId -> stood status per split hand
        splitBusted: {} as Record<string, boolean[]>,   // playerId -> busted status per split hand
        activeSplitIndex: {} as Record<string, number>, // playerId -> which split hand is active
        hasActed: {} as Record<string, boolean>,        // playerId -> true once they've taken any play action
        splitAces: {} as Record<string, boolean>,       // playerId -> true if aces were split
        splitCount: {} as Record<string, number>,       // playerId -> number of times player has split
        isSplitHand: {} as Record<string, boolean>,     // playerId -> true if player has split (for result calc)
        peekSettled: false as boolean,                   // true if dealer peek ended the round early
      },
      deck: [],
      dealtCardMap: new Map(),
    };
  }

  getDealPlan(state: GameState): DealPlan[] {
    const bankerId = state.roundData.bankerId as string;
    const normalPlayerIds = state.roundData.normalPlayerIds as string[];

    const round1 = [
      ...normalPlayerIds.map((pid) => ({ target: pid, count: 1, faceUp: false })),
      { target: bankerId, count: 1, faceUp: true },
    ];
    const round2 = [
      ...normalPlayerIds.map((pid) => ({ target: pid, count: 1, faceUp: false })),
      { target: bankerId, count: 1, faceUp: false },
    ];

    return [{ phase: 'deal', deals: [...round1, ...round2] }];
  }

  validateAction(state: GameState, action: PlayerAction): boolean {
    const bankerId = state.roundData.bankerId as string;

    // Betting phase
    if (state.phase === 'betting') {
      if (action.playerId === bankerId) return false;
      if (action.type !== 'bet') return false;
      const amount = (action.payload as { amount: number })?.amount ?? 0;
      const minBet = state.roundData.minBet as number;
      const maxBet = state.roundData.maxBet as number;
      return amount >= minBet && amount <= maxBet;
    }

    // Insurance phase: players can buy insurance or decline
    if (state.phase === 'insurance') {
      if (action.playerId === bankerId) return false;
      const normalPlayerIds = state.roundData.normalPlayerIds as string[];
      if (!normalPlayerIds.includes(action.playerId)) return false;
      const insurance = state.roundData.insurance as Record<string, number>;
      if (insurance[action.playerId] !== undefined) return false; // already decided
      if (action.type === 'insurance') {
        const amount = (action.payload as { amount: number })?.amount ?? 0;
        const bets = state.roundData.bets as Record<string, number>;
        const maxInsurance = Math.floor(bets[action.playerId] / 2);
        return amount > 0 && amount <= maxInsurance;
      }
      if (action.type === 'even-money') {
        // Even money is only available to players with natural blackjack
        const hand = state.hands[action.playerId] ?? [];
        return isNatural21(hand);
      }
      if (action.type === 'decline-insurance') return true;
      return false;
    }

    // Player phase
    if (state.phase === 'playing') {
      if (action.playerId === bankerId) return false;
      const currentPlayer = state.players[state.currentPlayerIndex];
      if (!currentPlayer || action.playerId !== currentPlayer.id) return false;

      const stood = state.roundData.stood as Record<string, boolean>;
      const busted = state.roundData.busted as Record<string, boolean>;
      const surrendered = state.roundData.surrendered as Record<string, boolean>;
      const splitHands = state.roundData.splitHands as Record<string, Card[][]>;

      // If player has split hands, check the active split hand
      if (splitHands[action.playerId] && splitHands[action.playerId].length > 0) {
        const splitStood = state.roundData.splitStood as Record<string, boolean[]>;
        const splitBusted = state.roundData.splitBusted as Record<string, boolean[]>;
        const activeIdx = (state.roundData.activeSplitIndex as Record<string, number>)[action.playerId] ?? 0;
        if (splitStood[action.playerId]?.[activeIdx] || splitBusted[action.playerId]?.[activeIdx]) return false;

        const splitAces = state.roundData.splitAces as Record<string, boolean>;
        const activeHand = splitHands[action.playerId][activeIdx];

        // Split Aces restriction: after split aces, each hand gets exactly 1 card then auto-stands
        // Reject 'hit' if aces were split and hand already has 2 cards
        if (splitAces[action.playerId] && action.type === 'hit' && activeHand.length >= 2) {
          return false;
        }

        // Double After Split: only allow 'double-down' on split hands if DAS is enabled
        if (action.type === 'double-down') {
          const doubleAfterSplit = state.roundData.doubleAfterSplit as boolean;
          if (!doubleAfterSplit) return false;
          return activeHand.length === 2;
        }

        // Re-split: allow split on active split hand if under limit and not aces
        if (action.type === 'split') {
          if (splitAces[action.playerId]) return false; // no re-splitting aces
          const maxSplitHands = state.roundData.maxSplitHands as number;
          if (splitHands[action.playerId].length >= maxSplitHands) return false;
          return activeHand.length === 2 && sameRank(activeHand);
        }

        return ['hit', 'stand'].includes(action.type);
      }

      if (stood[action.playerId] || busted[action.playerId] || surrendered[action.playerId]) return false;

      const hand = state.hands[action.playerId] ?? [];
      const hasActed = state.roundData.hasActed as Record<string, boolean>;

      // Surrender: only before any action on first two cards
      if (action.type === 'surrender') {
        return hand.length === 2 && !hasActed[action.playerId];
      }

      // Double down: only on first two cards
      if (action.type === 'double-down') {
        return hand.length === 2;
      }

      // Split: only on first two cards with same rank, check max split limit
      if (action.type === 'split') {
        if (!(hand.length === 2 && sameRank(hand))) return false;
        const maxSplitHands = state.roundData.maxSplitHands as number;
        const splitCount = (state.roundData.splitCount as Record<string, number>)[action.playerId] ?? 0;
        if (splitCount >= maxSplitHands - 1) return false; // already at max
        return true;
      }

      return ['hit', 'stand'].includes(action.type);
    }

    // Banker phase
    if (state.phase === 'banker-turn') {
      if (action.playerId !== bankerId) return false;
      const bankerCards = state.hands[bankerId] ?? [];
      const val = handValue(bankerCards);
      const softHit17 = state.roundData.softHit17 as boolean;

      // Soft 17: if softHit17 is enabled and banker has a soft 17, must hit
      const mustHitSoft17 = softHit17 && isSoft17(bankerCards);

      if (action.type === 'hit') return val < 17 || mustHitSoft17;
      if (action.type === 'stand') return val >= 17 && !mustHitSoft17;
      return false;
    }

    return false;
  }

  applyAction(state: GameState, action: PlayerAction): ApplyActionResult {
    const newState = deepCloneState(state);
    const bankerId = newState.roundData.bankerId as string;
    const normalPlayerIds = newState.roundData.normalPlayerIds as string[];
    const stood = newState.roundData.stood as Record<string, boolean>;
    const busted = newState.roundData.busted as Record<string, boolean>;
    const bets = newState.roundData.bets as Record<string, number>;
    const pendingActions: PendingAction[] = [];

    // === Betting phase ===
    if (newState.phase === 'betting') {
      const amount = (action.payload as { amount: number }).amount;
      bets[action.playerId] = amount;
      pendingActions.push({ type: 'debit', playerId: action.playerId, amount, reason: 'bet' });

      const allBet = normalPlayerIds.every((pid) => bets[pid] > 0);
      if (allBet) {
        newState.phase = 'dealing';
      } else {
        this.advanceToNextNormalPlayer(newState, bankerId);
      }
      return { state: newState, pendingActions };
    }

    // === Insurance phase ===
    if (newState.phase === 'insurance') {
      const insurance = newState.roundData.insurance as Record<string, number>;
      const evenMoney = newState.roundData.evenMoney as Record<string, boolean>;
      if (action.type === 'even-money') {
        evenMoney[action.playerId] = true;
        insurance[action.playerId] = 0; // mark as decided for insurance tracking
      } else if (action.type === 'insurance') {
        const amount = (action.payload as { amount: number }).amount;
        insurance[action.playerId] = amount;
        pendingActions.push({ type: 'debit', playerId: action.playerId, amount, reason: 'insurance' });
      } else if (action.type === 'decline-insurance') {
        insurance[action.playerId] = 0;
      }

      // Check if all normal players have decided
      const allDecided = normalPlayerIds.every((pid) => insurance[pid] !== undefined);
      if (allDecided) {
        // Check for banker natural 21
        const bankerCards = newState.hands[bankerId] ?? [];
        if (isNatural21(bankerCards)) {
          // Banker has natural 21 - resolve immediately
          newState.phase = 'end';
        } else {
          // No banker natural - proceed to playing
          newState.phase = 'playing';
          // Set current player to first normal player
          const bankerIndex = newState.roundData.bankerIndex as number;
          newState.currentPlayerIndex = bankerIndex === 0 ? 1 : 0;
        }
      }
      return { state: newState, pendingActions };
    }

    // === Player phase ===
    if (newState.phase === 'playing') {
      const hasActed = newState.roundData.hasActed as Record<string, boolean>;
      const splitHands = newState.roundData.splitHands as Record<string, Card[][]>;

      // Handle split hand play
      if (splitHands[action.playerId] && splitHands[action.playerId].length > 0) {
        const splitStood = newState.roundData.splitStood as Record<string, boolean[]>;
        const splitBusted = newState.roundData.splitBusted as Record<string, boolean[]>;
        const activeSplitIndex = newState.roundData.activeSplitIndex as Record<string, number>;
        const activeIdx = activeSplitIndex[action.playerId] ?? 0;
        const splitAces = newState.roundData.splitAces as Record<string, boolean>;

        if (action.type === 'stand') {
          splitStood[action.playerId][activeIdx] = true;
        } else if (action.type === 'double-down') {
          // Double on split hand: double the bet, deal one card, then auto-stand
          const splitBetsArr = newState.roundData.splitBets as Record<string, number[]>;
          const originalBet = splitBetsArr[action.playerId][activeIdx];
          splitBetsArr[action.playerId][activeIdx] *= 2;
          pendingActions.push({ type: 'debit', playerId: action.playerId, amount: originalBet, reason: 'double-down' });
          // H6: Must deal one card after double-down
          pendingActions.push({ type: 'deal-to-player', playerId: action.playerId, count: 1 });
          // Note: bust check will happen after card is dealt by the engine
          // For now, mark as stood (card hasn't arrived yet, bust checked on next state)
          splitStood[action.playerId][activeIdx] = true;
        } else if (action.type === 'split') {
          // Re-split: split the active hand into two
          const hand = splitHands[action.playerId][activeIdx];
          const card1 = hand[0];
          const card2 = hand[1];
          const payload = action.payload as { splitCards?: Card[] } | undefined;
          const splitCards = payload?.splitCards ?? [];

          const newHand1 = [card1];
          const newHand2 = [card2];
          if (splitCards.length >= 1) newHand1.push(splitCards[0]);
          if (splitCards.length >= 2) newHand2.push(splitCards[1]);

          // Replace current hand and insert new hand after it
          splitHands[action.playerId].splice(activeIdx, 1, newHand1, newHand2);

          const splitBetsArr = newState.roundData.splitBets as Record<string, number[]>;
          const bet = splitBetsArr[action.playerId][activeIdx];
          splitBetsArr[action.playerId].splice(activeIdx, 1, bet, bet);
          pendingActions.push({ type: 'debit', playerId: action.playerId, amount: bet, reason: 'split' });

          splitStood[action.playerId].splice(activeIdx, 1, false, false);
          splitBusted[action.playerId].splice(activeIdx, 1, false, false);

          const splitCountMap = newState.roundData.splitCount as Record<string, number>;
          splitCountMap[action.playerId] = (splitCountMap[action.playerId] ?? 1) + 1;

          // Auto-stand split aces hands that already have 2 cards
          if (splitAces[action.playerId]) {
            if (newHand1.length >= 2) splitStood[action.playerId][activeIdx] = true;
            if (newHand2.length >= 2) splitStood[action.playerId][activeIdx + 1] = true;
          }
        } else if (action.type === 'hit') {
          pendingActions.push({ type: 'deal-to-player', playerId: action.playerId, count: 1 });
          // H5: Note: bust check cannot be done here because the card hasn't been dealt yet
          // (deal-to-player is a pending action processed by the engine after applyAction returns).
          // The bust check happens in getValidActions/isGameOver based on actual hand state.
          // Split aces: auto-stand after receiving 1 card
          const hand = splitHands[action.playerId][activeIdx];
          if (splitAces[action.playerId] && hand.length >= 1) {
            // After the pending deal, hand will have 2 cards — mark as stood
            splitStood[action.playerId][activeIdx] = true;
          }
        }

        // Check if current split hand is done
        if (splitStood[action.playerId][activeIdx] || splitBusted[action.playerId][activeIdx]) {
          // Move to next unfinished split hand
          let nextIdx = activeIdx + 1;
          while (nextIdx < splitHands[action.playerId].length &&
                 (splitStood[action.playerId][nextIdx] || splitBusted[action.playerId][nextIdx])) {
            nextIdx++;
          }
          if (nextIdx < splitHands[action.playerId].length) {
            activeSplitIndex[action.playerId] = nextIdx;
          } else {
            // All split hands done - mark player as stood
            stood[action.playerId] = true;
          }
        }

        // Check if all normal players done
        const allDone = normalPlayerIds.every((pid) => stood[pid] || busted[pid] ||
          (newState.roundData.surrendered as Record<string, boolean>)[pid]);
        if (allDone) {
          newState.phase = 'banker-turn';
          stood[bankerId] = false;
        } else {
          this.advanceToNextNormalPlayer(newState, bankerId);
        }
        return { state: newState, pendingActions };
      }

      if (action.type === 'surrender') {
        const surrendered = newState.roundData.surrendered as Record<string, boolean>;
        surrendered[action.playerId] = true;
        stood[action.playerId] = true; // treat as done
      } else if (action.type === 'double-down') {
        const doubled = newState.roundData.doubled as Record<string, boolean>;
        doubled[action.playerId] = true;
        hasActed[action.playerId] = true;
        pendingActions.push({ type: 'debit', playerId: action.playerId, amount: bets[action.playerId], reason: 'double-down' });
        // Player gets exactly one more card (engine deals it before applyAction)
        // Then automatically stands
        const hand = newState.hands[action.playerId] ?? [];
        if (handValue(hand) > 21) {
          busted[action.playerId] = true;
        } else {
          stood[action.playerId] = true;
        }
      } else if (action.type === 'split') {
        hasActed[action.playerId] = true;
        const hand = newState.hands[action.playerId] ?? [];
        const card1 = hand[0];
        const card2 = hand[1];
        pendingActions.push({ type: 'debit', playerId: action.playerId, amount: bets[action.playerId], reason: 'split' });

        const payload = action.payload as { splitCards?: Card[] } | undefined;
        const splitCards = payload?.splitCards ?? [];

        const hand1 = [card1];
        const hand2 = [card2];
        if (splitCards.length >= 1) hand1.push(splitCards[0]);
        if (splitCards.length >= 2) hand2.push(splitCards[1]);

        splitHands[action.playerId] = [hand1, hand2];

        const splitBetsMap = newState.roundData.splitBets as Record<string, number[]>;
        const bet = bets[action.playerId];
        splitBetsMap[action.playerId] = [bet, bet];

        const splitStood = newState.roundData.splitStood as Record<string, boolean[]>;
        const splitBusted = newState.roundData.splitBusted as Record<string, boolean[]>;
        const activeSplitIndex = newState.roundData.activeSplitIndex as Record<string, number>;
        splitStood[action.playerId] = [false, false];
        splitBusted[action.playerId] = [false, false];
        activeSplitIndex[action.playerId] = 0;

        // Track split metadata
        const splitAces = newState.roundData.splitAces as Record<string, boolean>;
        const splitCountMap = newState.roundData.splitCount as Record<string, number>;
        const isSplitHandMap = newState.roundData.isSplitHand as Record<string, boolean>;
        isSplitHandMap[action.playerId] = true;
        splitCountMap[action.playerId] = (splitCountMap[action.playerId] ?? 0) + 1;

        // Detect if splitting aces
        if (card1.rank === 'A') {
          splitAces[action.playerId] = true;
          // Auto-stand each hand that already has 2 cards
          if (hand1.length >= 2) splitStood[action.playerId][0] = true;
          if (hand2.length >= 2) splitStood[action.playerId][1] = true;
          // If both auto-stood, mark player as done
          if (splitStood[action.playerId][0] && splitStood[action.playerId][1]) {
            stood[action.playerId] = true;
          } else if (splitStood[action.playerId][0]) {
            activeSplitIndex[action.playerId] = 1;
          }
        }

        // Clear the main hand (now tracked in splitHands)
        newState.hands[action.playerId] = [];
      } else if (action.type === 'stand') {
        stood[action.playerId] = true;
        hasActed[action.playerId] = true;
      } else if (action.type === 'hit') {
        hasActed[action.playerId] = true;
        pendingActions.push({ type: 'deal-to-player', playerId: action.playerId, count: 1 });
        // H5: Bust check deferred — card hasn't been dealt yet (pending action).
        // Bust is detected in getValidActions via refreshBustFlags().
      }

      // Refresh bust flags based on actual hand values (cards may have been dealt by engine)
      this.refreshBustFlags(newState);

      // Check if all normal players done
      const allDone = normalPlayerIds.every((pid) => stood[pid] || busted[pid] ||
        (newState.roundData.surrendered as Record<string, boolean>)[pid]);
      if (allDone) {
        newState.phase = 'banker-turn';
        stood[bankerId] = false;
      } else {
        this.advanceToNextNormalPlayer(newState, bankerId);
      }
      return { state: newState, pendingActions };
    }

    // === Banker phase ===
    if (newState.phase === 'banker-turn') {
      if (action.type === 'hit') {
        pendingActions.push({ type: 'deal-to-player', playerId: bankerId, count: 1 });
        // H5: Bust check deferred — card not dealt yet. Detected via refreshBustFlags.
        this.refreshBustFlags(newState);
        if (busted[bankerId]) {
          newState.phase = 'end';
        }
      } else if (action.type === 'stand') {
        newState.phase = 'end';
      }
      return { state: newState, pendingActions };
    }

    return { state: newState, pendingActions };
  }

  /**
   * Called after dealing to check dealer peek rule.
   * If dealerPeek is true and banker's face-up card is 10-value or Ace:
   *   - Ace face-up: go to insurance phase (existing behavior)
   *   - 10-value face-up with blackjack: go directly to 'end' (peek settled)
   *   - 10-value face-up without blackjack: go to 'playing'
   * If dealerPeek is false (European no-peek): skip straight to 'playing'
   */
  postDeal(state: GameState): GameState {
    const newState = deepCloneState(state);
    const bankerId = newState.roundData.bankerId as string;
    const bankerCards = newState.hands[bankerId] ?? [];
    const dealerPeek = newState.roundData.dealerPeek as boolean;

    if (dealerPeek && bankerCards.length >= 1) {
      const faceUpCard = bankerCards[0]; // first card is face-up per getDealPlan
      const isTenValue = ['10', 'J', 'Q', 'K'].includes(faceUpCard.rank);
      const isAce = faceUpCard.rank === 'A';

      if (isAce) {
        // Go to insurance phase (existing behavior)
        newState.phase = 'insurance';
        return newState;
      }

      if (isTenValue && isNatural21(bankerCards)) {
        // Dealer has blackjack with 10-value showing - settle immediately
        newState.phase = 'end';
        newState.roundData.peekSettled = true;
        return newState;
      }
    }

    // No peek trigger or no blackjack - proceed to playing
    newState.phase = 'playing';
    const bankerIndex = newState.roundData.bankerIndex as number;
    newState.currentPlayerIndex = bankerIndex === 0 ? 1 : 0;
    return newState;
  }

  /**
   * H5: Refresh bust flags by checking actual hand values.
   * This catches busts that happened from cards dealt by the engine
   * (via pending deal-to-player actions processed after applyAction).
   */
  private refreshBustFlags(state: GameState): void {
    const busted = state.roundData.busted as Record<string, boolean>;
    for (const p of state.players) {
      if (!busted[p.id]) {
        const hand = state.hands[p.id] ?? [];
        if (hand.length > 0 && handValue(hand) > 21) {
          busted[p.id] = true;
        }
      }
    }
    // Also check split hands
    const splitHands = state.roundData.splitHands as Record<string, Card[][]> | undefined;
    const splitBusted = state.roundData.splitBusted as Record<string, boolean[]> | undefined;
    if (splitHands && splitBusted) {
      for (const [pid, hands] of Object.entries(splitHands)) {
        for (let i = 0; i < hands.length; i++) {
          if (!splitBusted[pid]?.[i] && handValue(hands[i]) > 21) {
            if (!splitBusted[pid]) splitBusted[pid] = [];
            splitBusted[pid][i] = true;
          }
        }
      }
    }
  }

  private advanceToNextNormalPlayer(state: GameState, bankerId: string): void {
    const stood = state.roundData.stood as Record<string, boolean>;
    const busted = state.roundData.busted as Record<string, boolean>;
    const surrendered = state.roundData.surrendered as Record<string, boolean>;
    const n = state.players.length;
    let next = (state.currentPlayerIndex + 1) % n;
    let checked = 0;
    while (checked < n) {
      const pid = state.players[next].id;
      if (pid !== bankerId && !stood[pid] && !busted[pid] && !surrendered[pid]) break;
      next = (next + 1) % n;
      checked++;
    }
    state.currentPlayerIndex = next;
  }

  isGameOver(state: GameState): boolean {
    return state.phase === 'end';
  }

  getResult(state: GameState): GameResult {
    const bankerId = state.roundData.bankerId as string;
    const normalPlayerIds = state.roundData.normalPlayerIds as string[];
    const busted = state.roundData.busted as Record<string, boolean>;
    const bets = state.roundData.bets as Record<string, number>;
    const surrendered = state.roundData.surrendered as Record<string, boolean>;
    const doubled = state.roundData.doubled as Record<string, boolean>;
    const insurance = state.roundData.insurance as Record<string, number>;
    const splitHands = state.roundData.splitHands as Record<string, Card[][]>;
    const splitBets = state.roundData.splitBets as Record<string, number[]>;
    const splitBusted = state.roundData.splitBusted as Record<string, boolean[]>;

    const evenMoney = state.roundData.evenMoney as Record<string, boolean>;
    const bankerCards = state.hands[bankerId] ?? [];
    const bankerVal = handValue(bankerCards);
    const bankerBust = busted[bankerId] || bankerVal > 21;
    const bankerNatural = isNatural21(bankerCards);
    const peekSettled = state.roundData.peekSettled as boolean;

    const pointChanges: Record<string, number> = {};
    const winners: string[] = [];
    let bankerNet = 0;

    for (const pid of normalPlayerIds) {
      let netChange = 0;

      // Even money: player took guaranteed 1:1 payout, hand is settled
      if (evenMoney[pid]) {
        const bet = bets[pid] ?? 0;
        netChange = bet; // 1:1 payout
        winners.push(pid);
        pointChanges[pid] = netChange;
        bankerNet -= netChange;
        continue;
      }

      // Peek rule: if dealer peek ended the round, players only lose original bet
      if (peekSettled) {
        const bet = bets[pid] ?? 0;
        const playerCards = state.hands[pid] ?? [];
        const playerNatural = isNatural21(playerCards);
        if (playerNatural) {
          // Player also has natural: push
          netChange = 0;
        } else {
          // Player loses only original bet (not doubled/split amounts)
          netChange = -bet;
        }
        pointChanges[pid] = netChange;
        bankerNet -= netChange;
        continue;
      }

      // --- Insurance settlement ---
      const insuranceBet = insurance[pid] ?? 0;
      if (insuranceBet > 0) {
        if (bankerNatural) {
          // Insurance pays 2:1
          netChange += insuranceBet * 2;
        } else {
          // Insurance lost
          netChange -= insuranceBet;
        }
      }

      // --- Surrender ---
      if (surrendered[pid]) {
        const bet = bets[pid] ?? 0;
        netChange -= Math.floor(bet / 2); // lose half the bet
        pointChanges[pid] = netChange;
        bankerNet -= netChange;
        continue;
      }

      // --- Split hands ---
      if (splitHands[pid] && splitHands[pid].length > 0) {
        const hands = splitHands[pid];
        const sBets = splitBets[pid] ?? [];
        const sBusted = splitBusted[pid] ?? [];

        for (let i = 0; i < hands.length; i++) {
          const hand = hands[i];
          const bet = sBets[i] ?? 0;
          const playerVal = handValue(hand);
          const playerBust = sBusted[i] || playerVal > 21;

          if (playerBust) {
            netChange -= bet;
          } else if (bankerNatural) {
            // Banker natural beats all split hands (split-21 is NOT natural)
            netChange -= bet;
          } else if (bankerBust || playerVal > bankerVal) {
            // Split hand 21 pays 1:1, not 3:2 (not a natural blackjack)
            netChange += bet;
            if (!winners.includes(pid)) winners.push(pid);
          } else if (playerVal === bankerVal) {
            // push
          } else {
            netChange -= bet;
          }
        }

        pointChanges[pid] = netChange;
        bankerNet -= netChange;
        continue;
      }

      // --- Normal hand ---
      const hand = state.hands[pid] ?? [];
      const playerVal = handValue(hand);
      const playerBust = busted[pid] || playerVal > 21;
      const bet = bets[pid] ?? 0;
      const effectiveBet = doubled[pid] ? bet * 2 : bet;
      const playerNatural = isNatural21(hand);

      if (playerBust) {
        netChange -= effectiveBet;
      } else if (playerNatural && bankerNatural) {
        // Both natural 21: push (no change to main bet)
      } else if (playerNatural) {
        // Natural 21 pays 3:2
        netChange += Math.floor(effectiveBet * 1.5);
        winners.push(pid);
      } else if (bankerNatural) {
        // Banker natural beats non-natural 21
        netChange -= effectiveBet;
      } else if (bankerBust || playerVal > bankerVal) {
        netChange += effectiveBet;
        winners.push(pid);
      } else if (playerVal === bankerVal) {
        // push
      } else {
        netChange -= effectiveBet;
      }

      pointChanges[pid] = netChange;
      bankerNet -= netChange;
    }

    pointChanges[bankerId] = bankerNet;
    const commission = (state.roundData.commission as number) ?? 0;

    return { winners, pointChanges, commission, finalState: state };
  }

  getValidActions(state: GameState): PlayerAction[] {
    const bankerId = state.roundData.bankerId as string;

    if (state.phase === 'betting') {
      const currentPlayer = state.players[state.currentPlayerIndex];
      if (!currentPlayer || currentPlayer.id === bankerId) return [];
      const bets = state.roundData.bets as Record<string, number>;
      if (bets[currentPlayer.id] > 0) return [];
      const minBet = state.roundData.minBet as number;
      const maxBet = state.roundData.maxBet as number;
      return [
        { playerId: currentPlayer.id, type: 'bet', payload: { amount: minBet } },
        { playerId: currentPlayer.id, type: 'bet', payload: { amount: Math.floor((minBet + maxBet) / 2) } },
        { playerId: currentPlayer.id, type: 'bet', payload: { amount: maxBet } },
      ];
    }

    if (state.phase === 'insurance') {
      const actions: PlayerAction[] = [];
      const normalPlayerIds = state.roundData.normalPlayerIds as string[];
      const insurance = state.roundData.insurance as Record<string, number>;
      const bets = state.roundData.bets as Record<string, number>;
      for (const pid of normalPlayerIds) {
        if (insurance[pid] === undefined) {
          const maxInsurance = Math.floor(bets[pid] / 2);
          actions.push({ playerId: pid, type: 'insurance', payload: { amount: maxInsurance } });
          actions.push({ playerId: pid, type: 'decline-insurance' });
          // Even money: only available to players with natural blackjack
          const hand = state.hands[pid] ?? [];
          if (isNatural21(hand)) {
            actions.push({ playerId: pid, type: 'even-money' });
          }
        }
      }
      return actions;
    }

    if (state.phase === 'playing') {
      const currentPlayer = state.players[state.currentPlayerIndex];
      if (!currentPlayer || currentPlayer.id === bankerId) return [];
      const stood = state.roundData.stood as Record<string, boolean>;
      const busted = state.roundData.busted as Record<string, boolean>;
      const surrendered = state.roundData.surrendered as Record<string, boolean>;
      const splitHands = state.roundData.splitHands as Record<string, Card[][]>;

      const pid = currentPlayer.id;

      // Split hand play
      if (splitHands[pid] && splitHands[pid].length > 0) {
        const splitStood = state.roundData.splitStood as Record<string, boolean[]>;
        const splitBusted = state.roundData.splitBusted as Record<string, boolean[]>;
        const activeIdx = (state.roundData.activeSplitIndex as Record<string, number>)[pid] ?? 0;
        if (splitStood[pid]?.[activeIdx] || splitBusted[pid]?.[activeIdx]) return [];

        const splitAces = state.roundData.splitAces as Record<string, boolean>;
        const activeHand = splitHands[pid][activeIdx];

        // Split aces: no actions available (auto-stood after 1 card)
        if (splitAces[pid] && activeHand.length >= 2) return [];

        const actions: PlayerAction[] = [
          { playerId: pid, type: 'hit' },
          { playerId: pid, type: 'stand' },
        ];

        // Double after split (only on 2-card hands)
        if (activeHand.length === 2 && (state.roundData.doubleAfterSplit as boolean)) {
          actions.push({ playerId: pid, type: 'double-down' });
        }

        // Re-split (if same rank, under limit, not aces)
        if (!splitAces[pid] && activeHand.length === 2 && sameRank(activeHand)) {
          const maxSplitHands = state.roundData.maxSplitHands as number;
          if (splitHands[pid].length < maxSplitHands) {
            actions.push({ playerId: pid, type: 'split' });
          }
        }

        return actions;
      }

      if (stood[pid] || busted[pid] || surrendered[pid]) return [];

      const hand = state.hands[pid] ?? [];
      const hasActed = state.roundData.hasActed as Record<string, boolean>;
      const actions: PlayerAction[] = [
        { playerId: pid, type: 'hit' },
        { playerId: pid, type: 'stand' },
      ];

      // Double down: only on first two cards
      if (hand.length === 2) {
        actions.push({ playerId: pid, type: 'double-down' });
      }

      // Split: only on first two cards with same rank
      if (hand.length === 2 && sameRank(hand)) {
        actions.push({ playerId: pid, type: 'split' });
      }

      // Surrender: only before any action
      if (hand.length === 2 && !hasActed[pid]) {
        actions.push({ playerId: pid, type: 'surrender' });
      }

      return actions;
    }

    if (state.phase === 'banker-turn') {
      const bankerCards = state.hands[bankerId] ?? [];
      const val = handValue(bankerCards);
      const softHit17 = state.roundData.softHit17 as boolean;
      const mustHitSoft17 = softHit17 && isSoft17(bankerCards);

      if (val < 17 || mustHitSoft17) {
        return [{ playerId: bankerId, type: 'hit' }];
      }
      return [{ playerId: bankerId, type: 'stand' }];
    }

    return [];
  }

  getAutoAction(_state: GameState, playerId: string): PlayerAction {
    return { playerId, type: 'stand' };
  }

  getPublicState(state: GameState): Record<string, unknown> {
    const bankerId = state.roundData.bankerId as string;
    const normalPlayerIds = state.roundData.normalPlayerIds as string[];
    const stood = state.roundData.stood as Record<string, boolean>;
    const busted = state.roundData.busted as Record<string, boolean>;
    const bets = state.roundData.bets as Record<string, number>;

    // Banker's first card is face-up (public), second is hidden until banker-turn
    const bankerCards = state.hands[bankerId] ?? [];
    const bankerVisible = state.phase === 'end' || state.phase === 'banker-turn'
      ? bankerCards.map(c => c.id)
      : bankerCards.length > 0 ? [bankerCards[0].id, '???'] : [];

    return {
      gameType: 'blackjack',
      phase: state.phase,
      bankerId,
      bankerCards: bankerVisible,
      bankerValue: state.phase === 'end' || state.phase === 'banker-turn'
        ? handValue(bankerCards) : undefined,
      players: normalPlayerIds.map(pid => ({
        id: pid,
        bet: bets[pid] ?? 0,
        cardCount: (state.hands[pid] ?? []).length,
        stood: stood[pid] ?? false,
        busted: busted[pid] ?? false,
      })),
      currentPlayerIndex: state.currentPlayerIndex,
    };
  }
}
