import type { GamePlugin, GameState, Card, DealPlan, PlayerAction, GameResult, PlayerInfo, ApplyActionResult, PendingAction } from '@game-claw/core';
import { deepCloneState } from '@game-claw/core';
import { identifyPattern, canBeat, getAllPlays, PatternType, type CardPattern } from './card-patterns.js';

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

export class DouDiZhuPlugin implements GamePlugin {
  meta = {
    name: 'dou-di-zhu',
    displayName: 'Dou Di Zhu',
    minPlayers: 3,
    maxPlayers: 3,
    version: '0.1.0',
  };

  createDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ id: `${suit}-${rank}`, suit, rank });
      }
    }
    deck.push({ id: 'joker-small', suit: 'joker', rank: 'small' });
    deck.push({ id: 'joker-big', suit: 'joker', rank: 'big' });
    return deck;
  }

  createGame(players: PlayerInfo[], options?: Record<string, unknown>): GameState {
    return {
      phase: 'pre-bidding',
      players,
      hands: {},
      communityCards: [],
      currentPlayerIndex: 0,
      roundData: {
        landlord: null as string | null,
        highestBid: 0,
        highestBidder: null as string | null,
        passedInBidding: {} as Record<string, boolean>,
        bids: {} as Record<string, number>,
        currentBid: 0,
        lastPlay: null as { playerId: string; cards: Card[]; pattern: CardPattern } | null,
        passCount: 0,
        landlordCards: [] as Card[],
        bombCount: 0,
        playCount: {} as Record<string, number>,
        showCardMultipliers: {} as Record<string, number>,
        personalMultiplier: {} as Record<string, number>,
        showCardsDone: {} as Record<string, boolean>,
        doublingDone: {} as Record<string, boolean>,
        commission: (options?.roomConfig as any)?.commission ?? 0,
      },
      deck: [],
      dealtCardMap: new Map(),
    };
  }

  getDealPlan(state: GameState): DealPlan[] {
    // Deal 17 cards to each player. The remaining 3 cards stay in the deck.
    // After landlord is determined, engine deals them to landlord via dealCardToPlayer().
    return [{
      phase: 'deal',
      deals: state.players.map((p) => ({ target: p.id, count: 17, faceUp: false })),
    }];
  }

  validateAction(state: GameState, action: PlayerAction): boolean {
    const currentPlayer = state.players[state.currentPlayerIndex];

    if (state.phase === 'pre-bidding') {
      if (action.type === 'show-cards') {
        // Any player can show cards during pre-bidding (if not already done)
        const showCardsDone = state.roundData.showCardsDone as Record<string, boolean>;
        return state.players.some((p) => p.id === action.playerId) && !showCardsDone[action.playerId];
      }
      if (action.type === 'ready') {
        // Current player signals ready to proceed to bidding
        return action.playerId === currentPlayer.id;
      }
      return false;
    }

    if (action.playerId !== currentPlayer.id) return false;

    if (state.phase === 'bidding') {
      if (action.type === 'show-cards') {
        // Can show cards during bidding (after seeing 17 cards) for x2
        const showCardsDone = state.roundData.showCardsDone as Record<string, boolean>;
        return !showCardsDone[action.playerId];
      }
      if (action.type !== 'bid') return false;
      const bid = (action.payload as { bid: number })?.bid;
      if (bid === undefined) return false;
      const passedInBidding = state.roundData.passedInBidding as Record<string, boolean>;
      if (passedInBidding[action.playerId]) return false; // already passed, can't bid again
      if (bid === 0) return true; // pass
      const highestBid = state.roundData.highestBid as number;
      return bid > highestBid && bid <= 3;
    }

    if (state.phase === 'dealing-landlord') {
      // Landlord can show cards after seeing bottom cards
      if (action.type === 'show-cards') {
        const landlordId = state.roundData.landlord as string;
        if (action.playerId !== landlordId) return false;
        const showCardsDone = state.roundData.showCardsDone as Record<string, boolean>;
        return !showCardsDone[action.playerId];
      }
      return false;
    }

    if (state.phase === 'doubling') {
      if (action.type === 'double' || action.type === 'pass-double') {
        const doublingDone = state.roundData.doublingDone as Record<string, boolean>;
        return !doublingDone[action.playerId];
      }
      return false;
    }

    if (state.phase === 'playing') {
      if (action.type === 'pass') {
        const lastPlay = state.roundData.lastPlay as { playerId: string } | null;
        // Can't pass if you must lead (no previous play or you were the last to play)
        return lastPlay !== null && lastPlay.playerId !== action.playerId;
      }

      if (action.type === 'play-cards') {
        const cardIds = (action.payload as { cardIds: string[] })?.cardIds;
        if (!cardIds || cardIds.length === 0) return false;

        const hand = state.hands[action.playerId] ?? [];
        const cards = cardIds.map((id) => hand.find((c) => c.id === id)).filter(Boolean) as Card[];
        if (cards.length !== cardIds.length) return false;

        const pattern = identifyPattern(cards);
        if (!pattern) return false;

        const lastPlay = state.roundData.lastPlay as { pattern: CardPattern; playerId: string } | null;
        if (!lastPlay || lastPlay.playerId === action.playerId) return true; // free play
        return canBeat(pattern, lastPlay.pattern);
      }
    }

    return false;
  }

  applyAction(state: GameState, action: PlayerAction): ApplyActionResult {
    const newState = deepCloneState(state);
    const pendingActions: PendingAction[] = [];

    // Handle show-cards in any applicable phase
    if (action.type === 'show-cards') {
      const showCardMultipliers = newState.roundData.showCardMultipliers as Record<string, number>;
      showCardMultipliers[action.playerId] = (showCardMultipliers[action.playerId] ?? 1) * 2;
      const showCardsDone = newState.roundData.showCardsDone as Record<string, boolean>;
      showCardsDone[action.playerId] = true;
      return { state: newState, pendingActions };
    }

    if (newState.phase === 'pre-bidding') {
      if (action.type === 'ready') {
        // Transition to bidding phase
        newState.phase = 'bidding';
      }
      return { state: newState, pendingActions };
    }

    if (newState.phase === 'bidding') {
      const bid = (action.payload as { bid: number })?.bid ?? 0;
      (newState.roundData.bids as Record<string, number>)[action.playerId] = bid;

      if (bid === 0) {
        // Player passes — they cannot bid again
        (newState.roundData.passedInBidding as Record<string, boolean>)[action.playerId] = true;
      } else {
        // Player bids higher
        newState.roundData.highestBid = bid;
        newState.roundData.highestBidder = action.playerId;
        newState.roundData.currentBid = bid;
      }

      // Check if bidding is over
      const passedInBidding = newState.roundData.passedInBidding as Record<string, boolean>;
      const highestBid = newState.roundData.highestBid as number;
      const highestBidder = newState.roundData.highestBidder as string | null;

      // Bidding ends when: someone bids 3 (instant win), OR all others passed after a bid
      const allPlayerIds = newState.players.map((p) => p.id);
      const allPassed = allPlayerIds.every((id) => passedInBidding[id]);
      const othersAllPassed = highestBidder !== null &&
        allPlayerIds.filter((id) => id !== highestBidder).every((id) => passedInBidding[id]);

      if (allPassed && highestBidder === null) {
        // No one bid at all — redeal
        newState.phase = 'redeal';
        return { state: newState, pendingActions };
      }

      if (highestBid === 3 || othersAllPassed) {
        // Bidding done — highest bidder becomes landlord
        const landlordId = highestBidder!;
        newState.roundData.landlord = landlordId;
        newState.phase = 'dealing-landlord';
        newState.currentPlayerIndex = newState.players.findIndex((p) => p.id === landlordId);
        pendingActions.push({ type: 'deal-to-player', playerId: landlordId, count: 3 });
        return { state: newState, pendingActions };
      }

      // Move to next non-passed player
      let nextIndex = (newState.currentPlayerIndex + 1) % 3;
      for (let i = 0; i < 3; i++) {
        const nextPlayerId = newState.players[nextIndex].id;
        if (!passedInBidding[nextPlayerId]) break;
        nextIndex = (nextIndex + 1) % 3;
      }
      newState.currentPlayerIndex = nextIndex;

      return { state: newState, pendingActions };
    }

    if (newState.phase === 'doubling') {
      const doublingDone = newState.roundData.doublingDone as Record<string, boolean>;
      const personalMultiplier = newState.roundData.personalMultiplier as Record<string, number>;

      if (action.type === 'double') {
        personalMultiplier[action.playerId] = 2;
      } else {
        personalMultiplier[action.playerId] = 1;
      }
      doublingDone[action.playerId] = true;

      // Check if all players have decided
      const allDone = newState.players.every((p) => doublingDone[p.id]);
      if (allDone) {
        newState.phase = 'playing';
        const landlordId = newState.roundData.landlord as string;
        newState.currentPlayerIndex = newState.players.findIndex((p) => p.id === landlordId);
      } else {
        // Move to next player who hasn't decided
        let nextIndex = (newState.currentPlayerIndex + 1) % 3;
        for (let i = 0; i < 3; i++) {
          const nextPlayerId = newState.players[nextIndex].id;
          if (!doublingDone[nextPlayerId]) break;
          nextIndex = (nextIndex + 1) % 3;
        }
        newState.currentPlayerIndex = nextIndex;
      }
      return { state: newState, pendingActions };
    }

    if (newState.phase === 'playing') {
      if (action.type === 'pass') {
        newState.roundData.passCount = (newState.roundData.passCount as number) + 1;
        if ((newState.roundData.passCount as number) >= 2) {
          // Both others passed — round ends, last player leads
          const lastPlayer = (newState.roundData.lastPlay as { playerId: string }).playerId;
          newState.roundData.lastPlay = null;
          newState.roundData.passCount = 0;
          newState.currentPlayerIndex = newState.players.findIndex((p) => p.id === lastPlayer);
          return { state: newState, pendingActions };
        }
      } else if (action.type === 'play-cards') {
        const cardIds = (action.payload as { cardIds: string[] }).cardIds;
        const hand = newState.hands[action.playerId];
        const playedCards = cardIds.map((id) => hand.find((c) => c.id === id)!);
        const pattern = identifyPattern(playedCards)!;

        // Remove played cards from hand
        newState.hands[action.playerId] = hand.filter((c) => !cardIds.includes(c.id));
        newState.roundData.lastPlay = { playerId: action.playerId, cards: playedCards, pattern };
        newState.roundData.passCount = 0;

        // Track bomb/rocket count for multiplier
        if (pattern.type === PatternType.Bomb || pattern.type === PatternType.Rocket) {
          newState.roundData.bombCount = ((newState.roundData.bombCount as number) ?? 0) + 1;
        }

        // Track play count per player
        const playCount = (newState.roundData.playCount ?? {}) as Record<string, number>;
        playCount[action.playerId] = (playCount[action.playerId] ?? 0) + 1;
        newState.roundData.playCount = playCount;

        // Check win
        if (newState.hands[action.playerId].length === 0) {
          newState.phase = 'end';
          return { state: newState, pendingActions };
        }
      }

      // Next player
      newState.currentPlayerIndex = (newState.currentPlayerIndex + 1) % 3;
    }

    return { state: newState, pendingActions };
  }

  isGameOver(state: GameState): boolean {
    return state.phase === 'end' || state.phase === 'redeal';
  }

  getResult(state: GameState): GameResult {
    // Redeal: no money changes hands
    if (state.phase === 'redeal') {
      const pointChanges: Record<string, number> = {};
      for (const p of state.players) {
        pointChanges[p.id] = 0;
      }
      return {
        winners: [],
        pointChanges,
        commission: 0,
        finalState: state,
      };
    }

    const landlordId = state.roundData.landlord as string;
    const winner = state.players.find((p) => (state.hands[p.id]?.length ?? 0) === 0);
    const winnerId = winner?.id ?? landlordId;
    const landlordWins = winnerId === landlordId;

    const bidMultiplier = (state.roundData.currentBid as number) || 1;
    const bombCount = (state.roundData.bombCount as number) ?? 0;
    const bombMultiplier = Math.pow(2, bombCount);

    // Spring / Reverse Spring detection
    const playCount = (state.roundData.playCount ?? {}) as Record<string, number>;
    const peasantIds = state.players.filter((p) => p.id !== landlordId).map((p) => p.id);

    const isSpring = landlordWins && peasantIds.every((id) => (playCount[id] ?? 0) === 0);
    const isReverseSpring = !landlordWins && (playCount[landlordId] ?? 0) <= 1;
    // Landlord always leads first (1 play). Reverse spring = landlord only played the initial lead.

    const springMultiplier = (isSpring || isReverseSpring) ? 4 : 1;

    // Show cards multiplier: product of all show card multipliers
    const showCardMultipliers = (state.roundData.showCardMultipliers ?? {}) as Record<string, number>;
    let showCardMultiplier = 1;
    for (const p of state.players) {
      showCardMultiplier *= (showCardMultipliers[p.id] ?? 1);
    }

    const baseMultiplier = bidMultiplier * bombMultiplier * springMultiplier * showCardMultiplier;

    // Personal multipliers (from doubling phase)
    const personalMultiplier = (state.roundData.personalMultiplier ?? {}) as Record<string, number>;

    const pointChanges: Record<string, number> = {};

    // M8: Each peasant settles independently with landlord.
    // Payment = 10 * base * landlordMul * peasantMul (ensures zero-sum)
    const landlordMul = personalMultiplier[landlordId] ?? 1;
    let landlordTotal = 0;
    for (const p of state.players) {
      if (p.id === landlordId) continue;
      const peasantMul = personalMultiplier[p.id] ?? 1;
      const payment = 10 * baseMultiplier * landlordMul * peasantMul;
      if (landlordWins) {
        pointChanges[p.id] = -payment;
        landlordTotal += payment;
      } else {
        pointChanges[p.id] = payment;
        landlordTotal -= payment;
      }
    }
    pointChanges[landlordId] = landlordTotal;
    const commission = (state.roundData.commission as number) ?? 0;

    return {
      winners: landlordWins ? [landlordId] : state.players.filter((p) => p.id !== landlordId).map((p) => p.id),
      pointChanges,
      commission,
      finalState: state,
    };
  }

  getValidActions(state: GameState): PlayerAction[] {
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer) return [];

    if (state.phase === 'pre-bidding') {
      const actions: PlayerAction[] = [];
      // Any player can show cards
      for (const p of state.players) {
        const showCardsDone = state.roundData.showCardsDone as Record<string, boolean>;
        if (!showCardsDone[p.id]) {
          actions.push({ playerId: p.id, type: 'show-cards' });
        }
      }
      // Current player can signal ready
      actions.push({ playerId: currentPlayer.id, type: 'ready' });
      return actions;
    }

    if (state.phase === 'bidding') {
      const highestBid = state.roundData.highestBid as number;
      const passedInBidding = state.roundData.passedInBidding as Record<string, boolean>;

      if (passedInBidding[currentPlayer.id]) return [];

      const actions: PlayerAction[] = [];

      // Show cards option (if not already done)
      const showCardsDone = state.roundData.showCardsDone as Record<string, boolean>;
      if (!showCardsDone[currentPlayer.id]) {
        actions.push({ playerId: currentPlayer.id, type: 'show-cards' });
      }

      // Pass
      actions.push({ playerId: currentPlayer.id, type: 'bid', payload: { bid: 0 } });

      // Bid higher
      for (let b = highestBid + 1; b <= 3; b++) {
        actions.push({ playerId: currentPlayer.id, type: 'bid', payload: { bid: b } });
      }
      return actions;
    }

    if (state.phase === 'dealing-landlord') {
      const actions: PlayerAction[] = [];
      const landlordId = state.roundData.landlord as string;
      const showCardsDone = state.roundData.showCardsDone as Record<string, boolean>;
      if (!showCardsDone[landlordId]) {
        actions.push({ playerId: landlordId, type: 'show-cards' });
      }
      return actions;
    }

    if (state.phase === 'doubling') {
      const doublingDone = state.roundData.doublingDone as Record<string, boolean>;
      if (doublingDone[currentPlayer.id]) return [];
      return [
        { playerId: currentPlayer.id, type: 'double' },
        { playerId: currentPlayer.id, type: 'pass-double' },
      ];
    }

    if (state.phase === 'playing') {
      const actions: PlayerAction[] = [];
      const lastPlay = state.roundData.lastPlay as { playerId: string; pattern: CardPattern } | null;

      // Can pass if not starting a new round
      if (lastPlay && lastPlay.playerId !== currentPlayer.id) {
        actions.push({ playerId: currentPlayer.id, type: 'pass' });
      }

      // Find all valid plays from hand
      const hand = state.hands[currentPlayer.id] ?? [];
      const allCombos = getAllPlays(hand);
      for (const combo of allCombos) {
        const pattern = identifyPattern(combo);
        if (!pattern) continue;
        if (!lastPlay || lastPlay.playerId === currentPlayer.id || canBeat(pattern, lastPlay.pattern)) {
          actions.push({
            playerId: currentPlayer.id,
            type: 'play-cards',
            payload: { cardIds: combo.map((c) => c.id) },
          });
        }
      }

      return actions;
    }

    return [];
  }

  getAutoAction(state: GameState, playerId: string): PlayerAction {
    if (state.phase === 'bidding' || state.phase === 'pre-bidding') {
      return { playerId, type: 'bid', payload: { bid: 0 } };
    }
    if (state.phase === 'doubling') {
      return { playerId, type: 'pass-double' };
    }
    // Playing phase: pass if possible, otherwise play smallest card
    const lastPlay = state.roundData.lastPlay as { playerId: string } | null;
    if (lastPlay && lastPlay.playerId !== playerId) {
      return { playerId, type: 'pass' };
    }
    // Must lead — play smallest single card
    const hand = state.hands[playerId] ?? [];
    if (hand.length > 0) {
      return { playerId, type: 'play-cards', payload: { cardIds: [hand[0].id] } };
    }
    return { playerId, type: 'pass' };
  }

  getPublicState(state: GameState): Record<string, unknown> {
    const landlordId = state.roundData.landlord as string | null;
    const lastPlay = state.roundData.lastPlay as { playerId: string; cards: { id: string }[]; pattern: { type: string; rank: number } } | null;
    const playCount = (state.roundData.playCount ?? {}) as Record<string, number>;
    const bombCount = state.roundData.bombCount as number ?? 0;
    const currentBid = state.roundData.currentBid as number ?? 0;

    // Build play history from what's publicly visible
    return {
      gameType: 'dou-di-zhu',
      phase: state.phase,
      landlord: landlordId,
      currentBid,
      bombCount,
      currentPlayerIndex: state.currentPlayerIndex,
      lastPlay: lastPlay ? {
        playerId: lastPlay.playerId,
        cards: lastPlay.cards.map(c => c.id),
        pattern: lastPlay.pattern.type,
      } : null,
      players: state.players.map(p => ({
        id: p.id,
        cardsRemaining: (state.hands[p.id] ?? []).length,
        isLandlord: p.id === landlordId,
        playCount: playCount[p.id] ?? 0,
      })),
    };
  }
}
