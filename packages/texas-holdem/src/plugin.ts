import type { GamePlugin, GameState, Card, DealPlan, PlayerAction, GameResult, PlayerInfo, RoomConfig, ApplyActionResult, PendingAction } from '@game-claw/core';
import { deepCloneState } from '@game-claw/core';
import { compareHands } from './hand-eval.js';

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Default blind values
const SMALL_BLIND = 5;
const BIG_BLIND = 10;

export class TexasHoldemPlugin implements GamePlugin {
  meta = {
    name: 'texas-holdem',
    displayName: 'Texas Hold\'em',
    minPlayers: 2,
    maxPlayers: 10,
    version: '0.1.0',
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

  // Support multi-hand: pass buttonIndex to rotate dealer each hand
  createGame(players: PlayerInfo[], options?: { buttonIndex?: number; roomConfig?: RoomConfig }): GameState {
    const roomConfig = options?.roomConfig;
    const n = players.length;
    const bets: Record<string, number> = {};
    const folded: Record<string, boolean> = {};
    const acted: Record<string, boolean> = {};
    const allIn: Record<string, boolean> = {};
    const totalContributions: Record<string, number> = {};
    const stacks: Record<string, number> = {};
    const defaultBuyIn = roomConfig?.buyIn ?? 1000;
    players.forEach((p) => { bets[p.id] = 0; folded[p.id] = false; acted[p.id] = false; allIn[p.id] = false; totalContributions[p.id] = 0; stacks[p.id] = defaultBuyIn; });

    // Position assignment:
    //   buttonIndex rotates each hand (0 → 1 → 2 → ...)
    //   SB = (buttonIndex + 1) % n
    //   BB = (buttonIndex + 2) % n
    //   UTG (preflop first to act) = (buttonIndex + 3) % n  (or SB in heads-up)
    //   Post-flop first to act = SB (buttonIndex + 1) % n
    const buttonIndex = (options?.buttonIndex ?? 0) % n;
    const sbIndex = (buttonIndex + 1) % n;
    const bbIndex = (buttonIndex + 2) % n;

    // Heads-up special case: button=SB, other=BB
    const sbPlayer = n === 2 ? players[buttonIndex].id : players[sbIndex].id;
    const bbPlayer = n === 2 ? players[(buttonIndex + 1) % n].id : players[bbIndex].id;

    // Post small blind
    bets[sbPlayer] = SMALL_BLIND;
    totalContributions[sbPlayer] = SMALL_BLIND;
    stacks[sbPlayer] -= SMALL_BLIND;
    // Post big blind
    bets[bbPlayer] = BIG_BLIND;
    totalContributions[bbPlayer] = BIG_BLIND;
    stacks[bbPlayer] -= BIG_BLIND;

    // UTG is first to act preflop
    // Heads-up: SB (button) acts first preflop
    // 3+ players: player after BB
    let utgIndex: number;
    if (n === 2) {
      utgIndex = buttonIndex; // SB/button acts first in heads-up
    } else {
      utgIndex = (bbIndex + 1) % n;
    }

    return {
      phase: 'preflop',
      players,
      hands: {},
      communityCards: [],
      currentPlayerIndex: utgIndex,
      roundData: {
        pot: SMALL_BLIND + BIG_BLIND,
        bets,
        folded,
        currentBet: BIG_BLIND,
        lastRaiseSize: BIG_BLIND, // initial raise size = big blind
        lastRaiser: bbPlayer,
        actedInRound: acted,
        allIn,
        totalContributions,
        stacks,
        commission: (roomConfig?.commission as number) ?? 0,
        buttonIndex,
        sbIndex: n === 2 ? buttonIndex : sbIndex,
        bbIndex: n === 2 ? (buttonIndex + 1) % n : bbIndex,
        smallBlind: SMALL_BLIND,
        bigBlind: BIG_BLIND,
      },
      deck: [],
      dealtCardMap: new Map(),
    };
  }

  getDealPlan(state: GameState): DealPlan[] {
    const n = state.players.length;
    const sbIdx = state.roundData.sbIndex as number;

    // Deal order: starting from SB, one card each, then second card each
    // This matches real Texas Hold'em dealing order
    const dealOrder: string[] = [];
    for (let i = 0; i < n; i++) {
      dealOrder.push(state.players[(sbIdx + i) % n].id);
    }

    // Round 1: 1 card to each player in order (SB → BB → UTG → ...)
    // Round 2: 1 card to each player in order again
    const round1 = dealOrder.map((pid) => ({ target: pid, count: 1, faceUp: false }));
    const round2 = dealOrder.map((pid) => ({ target: pid, count: 1, faceUp: false }));

    // Burn card: target='burn' — engine discards 1 card before dealing community cards
    // Real Texas Hold'em: burn 1 before flop, burn 1 before turn, burn 1 before river
    return [
      {
        phase: 'preflop',
        deals: [...round1, ...round2], // SB→...→Button, then SB→...→Button again
      },
      {
        phase: 'flop',
        deals: [
          { target: 'burn', count: 1, faceUp: false }, // burn 1
          { target: 'community', count: 3, faceUp: true },
        ],
      },
      {
        phase: 'turn',
        deals: [
          { target: 'burn', count: 1, faceUp: false }, // burn 1
          { target: 'community', count: 1, faceUp: true },
        ],
      },
      {
        phase: 'river',
        deals: [
          { target: 'burn', count: 1, faceUp: false }, // burn 1
          { target: 'community', count: 1, faceUp: true },
        ],
      },
    ];
  }

  validateAction(state: GameState, action: PlayerAction): boolean {
    if (state.phase === 'end') return false;

    const currentPlayer = state.players[state.currentPlayerIndex];
    if (action.playerId !== currentPlayer.id) return false;
    if ((state.roundData.folded as Record<string, boolean>)[action.playerId]) return false;
    if ((state.roundData.allIn as Record<string, boolean>)[action.playerId]) return false;

    const currentBet = state.roundData.currentBet as number;
    const playerBet = (state.roundData.bets as Record<string, number>)[action.playerId] ?? 0;
    const bigBlind = state.roundData.bigBlind as number;
    const stacks = state.roundData.stacks as Record<string, number> | undefined;
    const playerStack = stacks?.[action.playerId] ?? Infinity;

    // lastRaiseSize tracks the increment of the last raise (for min-raise calculation)
    const lastRaiseSize = (state.roundData.lastRaiseSize as number) ?? bigBlind;

    switch (action.type) {
      case 'fold': return true;
      case 'check': return playerBet >= currentBet;
      case 'call': return currentBet > playerBet;
      case 'raise': {
        const amount = (action.payload as { amount: number })?.amount ?? 0;
        const diff = amount - playerBet;
        // Min raise = current bet + last raise size (typically 2x the previous bet)
        // e.g., BB=10, someone raises to 30 (raise size=20),
        //        next min raise = 30 + 20 = 50
        // Also: raise amount cannot exceed player's remaining stack (table stakes)
        if (diff > playerStack) return false;
        return amount >= currentBet + lastRaiseSize;
      }
      case 'all-in': {
        // All-in is always allowed regardless of amount.
        // If all-in amount < min raise, it does NOT reopen betting
        // (handled in applyAction via reopenBetting flag)
        return true;
      }
      default: return false;
    }
  }

  applyAction(state: GameState, action: PlayerAction): ApplyActionResult {
    const newState = deepCloneState(state);
    const bets = newState.roundData.bets as Record<string, number>;
    const folded = newState.roundData.folded as Record<string, boolean>;
    const acted = newState.roundData.actedInRound as Record<string, boolean>;
    const allIn = newState.roundData.allIn as Record<string, boolean>;
    const totalContributions = newState.roundData.totalContributions as Record<string, number>;
    const stacks = newState.roundData.stacks as Record<string, number> | undefined;
    const pendingActions: PendingAction[] = [];

    switch (action.type) {
      case 'fold':
        folded[action.playerId] = true;
        break;
      case 'check':
        break;
      case 'call': {
        const diff = (newState.roundData.currentBet as number) - (bets[action.playerId] ?? 0);
        bets[action.playerId] = newState.roundData.currentBet as number;
        newState.roundData.pot = (newState.roundData.pot as number) + diff;
        totalContributions[action.playerId] = (totalContributions[action.playerId] ?? 0) + diff;
        if (stacks) stacks[action.playerId] = (stacks[action.playerId] ?? 0) - diff;
        if (diff > 0) pendingActions.push({ type: 'debit', playerId: action.playerId, amount: diff, reason: 'call' });
        break;
      }
      case 'raise': {
        const amount = (action.payload as { amount: number }).amount;
        const raiseSize = amount - (newState.roundData.currentBet as number);
        const diff = amount - (bets[action.playerId] ?? 0);
        bets[action.playerId] = amount;
        newState.roundData.currentBet = amount;
        newState.roundData.lastRaiseSize = raiseSize; // track for min-raise calc
        newState.roundData.pot = (newState.roundData.pot as number) + diff;
        totalContributions[action.playerId] = (totalContributions[action.playerId] ?? 0) + diff;
        if (stacks) stacks[action.playerId] = (stacks[action.playerId] ?? 0) - diff;
        newState.roundData.lastRaiser = action.playerId;
        if (diff > 0) pendingActions.push({ type: 'debit', playerId: action.playerId, amount: diff, reason: 'raise' });
        for (const p of newState.players) {
          if (p.id !== action.playerId && !folded[p.id] && !allIn[p.id]) acted[p.id] = false;
        }
        break;
      }
      case 'all-in': {
        const allInAmount = (action.payload as { amount: number })?.amount ?? 0;
        const diff = allInAmount - (bets[action.playerId] ?? 0);
        bets[action.playerId] = allInAmount;
        newState.roundData.pot = (newState.roundData.pot as number) + diff;
        totalContributions[action.playerId] = (totalContributions[action.playerId] ?? 0) + diff;
        if (stacks) stacks[action.playerId] = 0;
        allIn[action.playerId] = true;
        if (diff > 0) pendingActions.push({ type: 'debit', playerId: action.playerId, amount: diff, reason: 'all-in' });

        const currentBet = newState.roundData.currentBet as number;
        const lastRaiseSize = (newState.roundData.lastRaiseSize as number) ?? (newState.roundData.bigBlind as number);
        const minRaise = currentBet + lastRaiseSize;

        if (allInAmount >= minRaise) {
          // Valid raise — reopens betting
          const raiseSize = allInAmount - currentBet;
          newState.roundData.currentBet = allInAmount;
          newState.roundData.lastRaiseSize = raiseSize;
          newState.roundData.lastRaiser = action.playerId;
          for (const p of newState.players) {
            if (p.id !== action.playerId && !folded[p.id] && !allIn[p.id]) acted[p.id] = false;
          }
        } else if (allInAmount > currentBet) {
          // All-in > current bet but < min raise — does NOT reopen betting
          newState.roundData.currentBet = allInAmount;
          // Other players who already acted do NOT need to re-act
        }
        // If allInAmount <= currentBet: just a short call, no change to betting
        break;
      }
    }

    acted[action.playerId] = true;

    const activePlayers = newState.players.filter((p) => !folded[p.id]);
    // Players who can still act (not folded, not all-in)
    const canActPlayers = activePlayers.filter((p) => !allIn[p.id]);

    // Only 1 player left — everyone else folded
    if (activePlayers.length === 1) {
      newState.phase = 'end';
      return { state: newState, pendingActions };
    }

    // If 0 or 1 players can still act (rest are all-in), skip to end
    if (canActPlayers.length <= 1) {
      // Check if the one remaining player has acted and matched the bet
      const allDone = canActPlayers.every((p) => acted[p.id] && bets[p.id] >= (newState.roundData.currentBet as number));
      if (canActPlayers.length === 0 || allDone) {
        newState.phase = 'end';
        return { state: newState, pendingActions };
      }
    }

    // Check if betting round is complete
    // Only players who can act need to have acted and matched the bet
    const allActed = canActPlayers.every((p) => acted[p.id]);
    const allEqualBet = canActPlayers.every((p) =>
      bets[p.id] === (newState.roundData.currentBet as number)
    );

    if (allActed && allEqualBet) {
      // Advance phase
      const phases = ['preflop', 'flop', 'turn', 'river', 'showdown'];
      const currentIdx = phases.indexOf(newState.phase);
      const nextPhase = phases[currentIdx + 1] ?? 'end';

      if (nextPhase === 'showdown') {
        newState.phase = 'end';
      } else {
        newState.phase = nextPhase;
        // Add deal-phase pending action for community card dealing
        if (['flop', 'turn', 'river'].includes(nextPhase)) {
          pendingActions.push({ type: 'deal-phase', phase: nextPhase });
        }
      }

      // Post-flop: action starts from SB (or first active non-allin player after SB)
      const sbIdx = newState.roundData.sbIndex as number;
      let startIdx = sbIdx;
      // Find first player who can act (not folded, not all-in)
      let loopGuard = 0;
      while ((folded[newState.players[startIdx].id] || allIn[newState.players[startIdx].id]) && loopGuard < newState.players.length) {
        startIdx = (startIdx + 1) % newState.players.length;
        loopGuard++;
      }
      newState.currentPlayerIndex = startIdx;

      // If all remaining active players are all-in, go straight to end
      if (canActPlayers.length <= 1) {
        newState.phase = 'end';
        return { state: newState, pendingActions };
      }

      // Reset round
      newState.roundData.currentBet = 0;
      for (const p of newState.players) {
        bets[p.id] = 0;
        acted[p.id] = false;
      }
    } else {
      // Next active player (skip folded and all-in), with loop guard
      let next = (newState.currentPlayerIndex + 1) % newState.players.length;
      let guard = 0;
      while ((folded[newState.players[next].id] || allIn[newState.players[next].id]) && guard < newState.players.length) {
        next = (next + 1) % newState.players.length;
        guard++;
      }
      if (guard >= newState.players.length) {
        // All players folded or all-in — end the hand
        newState.phase = 'end';
        return { state: newState, pendingActions };
      }
      newState.currentPlayerIndex = next;
    }

    return { state: newState, pendingActions };
  }

  isGameOver(state: GameState): boolean {
    return state.phase === 'end';
  }

  getResult(state: GameState): GameResult {
    const folded = state.roundData.folded as Record<string, boolean>;
    const activePlayers = state.players.filter((p) => !folded[p.id]);
    const totalContributions = state.roundData.totalContributions as Record<string, number>;
    const perPlayerCommission = state.roundData.commission as number ?? 0;
    // Total commission = per-player fee × number of players in this hand
    const totalCommission = perPlayerCommission * state.players.length;

    const pointChanges: Record<string, number> = {};
    // Each player's loss = their pot contribution + their commission fee
    for (const p of state.players) {
      pointChanges[p.id] = -(totalContributions[p.id] ?? 0) - perPlayerCommission;
    }

    let allWinners: string[] = [];

    if (activePlayers.length === 1) {
      // Everyone else folded — winner takes the entire pot (commission is separate, not from pot)
      const winnerId = activePlayers[0].id;
      allWinners = [winnerId];
      const pot = state.roundData.pot as number;
      pointChanges[winnerId] += pot;
    } else {
      // Calculate side pots based on total contributions
      const sidePots = this.calculateSidePots(activePlayers, totalContributions, state.players, folded);

      for (const sidePot of sidePots) {
        // Find best hand among eligible players
        let bestPlayers: string[] = [];
        let bestCards: Card[] | null = null;

        for (const pid of sidePot.eligible) {
          const hand = state.hands[pid] ?? [];
          const allCards = [...hand, ...state.communityCards];
          if (allCards.length < 5) continue;
          if (!bestCards) {
            bestCards = allCards;
            bestPlayers = [pid];
          } else {
            const cmp = compareHands(allCards, bestCards);
            if (cmp > 0) { bestCards = allCards; bestPlayers = [pid]; }
            else if (cmp === 0) bestPlayers.push(pid);
          }
        }

        // Distribute this pot among winners
        if (bestPlayers.length > 0) {
          const share = Math.floor(sidePot.amount / bestPlayers.length);
          const remainder = sidePot.amount - share * bestPlayers.length;
          for (const pid of bestPlayers) {
            pointChanges[pid] += share;
            if (!allWinners.includes(pid)) allWinners.push(pid);
          }
          // Odd chip goes to the winner closest to the dealer button in clockwise order
          if (remainder > 0) {
            const buttonIdx = state.roundData.buttonIndex as number;
            const n = state.players.length;
            let oddChipWinner = bestPlayers[0];
            let bestDistance = n; // larger than any real distance
            for (const pid of bestPlayers) {
              const seatIdx = state.players.findIndex((p) => p.id === pid);
              if (seatIdx === -1) continue; // M9: guard against missing player
              // Clockwise distance from button: SB=1, BB=2, ...
              // Button itself wraps to distance n (lowest priority)
              const dist = ((seatIdx - buttonIdx + n) % n) || n;
              if (dist < bestDistance) {
                bestDistance = dist;
                oddChipWinner = pid;
              }
            }
            pointChanges[oddChipWinner] += remainder;
          }
        }
      }

      // Commission already deducted per-player above (not from pot)
    }

    return { winners: allWinners, pointChanges, commission: totalCommission, finalState: state };
  }

  private calculateSidePots(
    activePlayers: { id: string }[],
    totalContributions: Record<string, number>,
    allPlayers: { id: string }[],
    folded: Record<string, boolean>,
  ): { amount: number; eligible: string[] }[] {
    // Get unique sorted contribution levels from active (non-folded) players
    const activeContributions = activePlayers.map((p) => totalContributions[p.id] ?? 0);
    const uniqueLevels = [...new Set(activeContributions)].sort((a, b) => a - b);

    // Also include contributions from folded players (they contributed but can't win)
    const allContributions: Record<string, number> = {};
    for (const p of allPlayers) {
      allContributions[p.id] = totalContributions[p.id] ?? 0;
    }

    const pots: { amount: number; eligible: string[] }[] = [];
    let prevLevel = 0;

    for (const level of uniqueLevels) {
      const increment = level - prevLevel;
      if (increment <= 0) continue;

      // Calculate how much goes into this pot:
      // Each player contributes min(their total contribution - prevLevel, increment)
      let potAmount = 0;
      for (const p of allPlayers) {
        const contrib = allContributions[p.id];
        const availableAbovePrev = Math.max(0, contrib - prevLevel);
        potAmount += Math.min(availableAbovePrev, increment);
      }

      // Eligible players: active players who contributed at least this level
      const eligible = activePlayers
        .filter((p) => (allContributions[p.id] ?? 0) >= level)
        .map((p) => p.id);

      if (potAmount > 0 && eligible.length > 0) {
        pots.push({ amount: potAmount, eligible });
      }

      prevLevel = level;
    }

    return pots;
  }

  getValidActions(state: GameState): PlayerAction[] {
    if (state.phase === 'end') return [];
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer) return [];
    const folded = state.roundData.folded as Record<string, boolean>;
    if (folded[currentPlayer.id]) return [];
    const allInMap = state.roundData.allIn as Record<string, boolean>;
    if (allInMap[currentPlayer.id]) return [];

    const currentBet = state.roundData.currentBet as number;
    const playerBet = (state.roundData.bets as Record<string, number>)[currentPlayer.id] ?? 0;
    const bigBlind = state.roundData.bigBlind as number;
    const stacks = state.roundData.stacks as Record<string, number> | undefined;
    const playerStack = stacks?.[currentPlayer.id] ?? Infinity;

    const actions: PlayerAction[] = [{ playerId: currentPlayer.id, type: 'fold' }];

    if (playerBet >= currentBet) {
      actions.push({ playerId: currentPlayer.id, type: 'check' });
    }
    if (currentBet > playerBet) {
      actions.push({ playerId: currentPlayer.id, type: 'call' });
    }
    // Min raise = current bet + last raise size
    const lastRaiseSize = (state.roundData.lastRaiseSize as number) ?? bigBlind;
    const minRaise = currentBet + lastRaiseSize;
    const minRaiseDiff = minRaise - playerBet;

    // Only offer raise if player has enough chips for the minimum raise
    if (playerStack >= minRaiseDiff) {
      actions.push({ playerId: currentPlayer.id, type: 'raise', payload: { amount: minRaise } });
    }

    // Offer all-in with the player's remaining stack (total bet = playerBet + playerStack)
    if (playerStack > 0) {
      actions.push({ playerId: currentPlayer.id, type: 'all-in', payload: { amount: playerBet + playerStack } });
    }

    return actions;
  }

  getStartActions(state: GameState): PendingAction[] {
    const sbIdx = state.roundData.sbIndex as number;
    const bbIdx = state.roundData.bbIndex as number;
    const sbPlayer = state.players[sbIdx].id;
    const bbPlayer = state.players[bbIdx].id;
    const smallBlind = state.roundData.smallBlind as number;
    const bigBlind = state.roundData.bigBlind as number;
    return [
      { type: 'debit', playerId: sbPlayer, amount: smallBlind, reason: 'blind:sb' },
      { type: 'debit', playerId: bbPlayer, amount: bigBlind, reason: 'blind:bb' },
    ];
  }

  getAutoAction(state: GameState, playerId: string): PlayerAction {
    const currentBet = state.roundData.currentBet as number;
    const playerBet = (state.roundData.bets as Record<string, number>)[playerId] ?? 0;
    if (playerBet >= currentBet) return { playerId, type: 'check' };
    return { playerId, type: 'fold' };
  }

  getPublicState(state: GameState): Record<string, unknown> {
    const bets = state.roundData.bets as Record<string, number>;
    const folded = state.roundData.folded as Record<string, boolean>;
    const allIn = state.roundData.allIn as Record<string, boolean>;
    return {
      gameType: 'texas-holdem',
      phase: state.phase,
      pot: state.roundData.pot,
      currentBet: state.roundData.currentBet,
      communityCards: state.communityCards.map(c => c.id),
      currentPlayerIndex: state.currentPlayerIndex,
      buttonIndex: state.roundData.buttonIndex,
      players: state.players.map(p => ({
        id: p.id,
        bet: bets[p.id] ?? 0,
        folded: folded[p.id] ?? false,
        allIn: allIn[p.id] ?? false,
      })),
    };
  }
}
