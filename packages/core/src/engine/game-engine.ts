import type {
  GamePlugin, GameState, PlayerInfo, PlayerAction, GameResult,
  CardCommitment, CardReveal, Identity, Card, PendingAction,
} from '../types/index.js';
import { generateSalt, createCommitment } from '../crypto/commitment.js';
import { encryptForPlayer, decryptFromDealer } from '../crypto/encrypt.js';
import { signData } from '../crypto/sign.js';

export class GameEngine {
  private state!: GameState;
  private commitments: CardCommitment[] = [];
  private reveals: CardReveal[] = [];
  private cardSecrets = new Map<number, { cardId: string; salt: string }>();
  private globalCardIndex = 0;
  private originalPlayers: PlayerInfo[] = []; // preserved Uint8Arrays

  constructor(
    private plugin: GamePlugin,
    private dealerIdentity: Identity,
  ) {}

  startGame(players: PlayerInfo[], options?: Record<string, unknown>): { state: GameState; commitments: CardCommitment[] } {
    this.originalPlayers = players;
    this.state = this.plugin.createGame(players, options);
    const deck = this.plugin.createDeck();
    // Shuffle deck using Fisher-Yates
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    this.state.deck = [...deck];

    // Execute initial deal plan
    const dealPlans = this.plugin.getDealPlan(this.state);
    const initialPlan = dealPlans[0]; // First plan is always the initial deal
    if (initialPlan) {
      this.executeDealPlan(initialPlan, players);
    }

    // C3: Call postDeal if plugin implements it (e.g., blackjack peek rule)
    if (this.plugin.postDeal) {
      this.state = this.plugin.postDeal(this.state);
    }

    return { state: this.state, commitments: [...this.commitments] };
  }

  private executeDealPlan(plan: { deals: { target: string; count: number; faceUp: boolean }[] }, players: PlayerInfo[]): CardCommitment[] {
    const newCommitments: CardCommitment[] = [];
    const deck = this.state.deck;

    for (const deal of plan.deals) {
      for (let i = 0; i < deal.count; i++) {
        if (deck.length === 0) break;
        const card = deck.shift()!;

        // Burn card: discard from deck, still tracked with commitment for full verification
        if (deal.target === 'burn') {
          const salt = generateSalt();
          const commitment = createCommitment(card.id, salt);
          const cardIndex = this.globalCardIndex++;
          this.cardSecrets.set(cardIndex, { cardId: card.id, salt });
          const cc: CardCommitment = {
            cardIndex,
            commitment,
            encrypted: '',
            nonce: '',
            targetPlayerId: 'burn',
            signature: signData({ commitment, targetPlayer: 'burn' }, this.dealerIdentity.signKeyPair.secretKey),
          };
          newCommitments.push(cc);
          this.commitments.push(cc);
          continue;
        }

        // House card: virtual player, no encryption (no real keypair)
        // Commitment ensures card can't be changed; revealed at showdown
        if (deal.target === 'house') {
          const salt = generateSalt();
          const commitment = createCommitment(card.id, salt);
          const cardIndex = this.globalCardIndex++;
          this.cardSecrets.set(cardIndex, { cardId: card.id, salt });

          if (!this.state.hands['house']) this.state.hands['house'] = [];
          this.state.hands['house'].push(card);

          if (deal.faceUp) {
            // Face-up house card: revealed immediately to all
            this.reveals.push({ cardIndex, cardId: card.id, salt });
          }
          // Hidden house card: commitment only, revealed at game end

          const cc: CardCommitment = {
            cardIndex,
            commitment,
            encrypted: '',
            nonce: '',
            targetPlayerId: 'house',
            signature: signData({ commitment, targetPlayer: 'house' }, this.dealerIdentity.signKeyPair.secretKey),
          };
          newCommitments.push(cc);
          this.commitments.push(cc);
          continue;
        }

        const salt = generateSalt();
        const commitment = createCommitment(card.id, salt);
        const cardIndex = this.globalCardIndex++;

        this.cardSecrets.set(cardIndex, { cardId: card.id, salt });

        if (deal.target === 'community') {
          if (deal.faceUp) {
            this.state.communityCards.push(card);
            this.reveals.push({ cardIndex, cardId: card.id, salt });
          }
          const cc: CardCommitment = {
            cardIndex,
            commitment,
            encrypted: '',
            nonce: '',
            targetPlayerId: 'community',
            signature: signData({ commitment, targetPlayer: 'community' }, this.dealerIdentity.signKeyPair.secretKey),
          };
          newCommitments.push(cc);
          this.commitments.push(cc);
        } else {
          // Player card — encrypted to the target player
          const targetPlayer = players.find((p) => p.id === deal.target)!;
          const { encrypted, nonce } = encryptForPlayer(
            { cardId: card.id, salt },
            targetPlayer.encryptPubKey,
            this.dealerIdentity.encryptKeyPair.secretKey,
          );

          // If faceUp: card is also publicly revealed (e.g., banker's face-up card in blackjack)
          if (deal.faceUp) {
            this.reveals.push({ cardIndex, cardId: card.id, salt });
          }

          const cc: CardCommitment = {
            cardIndex,
            commitment,
            encrypted,
            nonce,
            targetPlayerId: deal.target,
            signature: signData({ commitment, encrypted, targetPlayer: deal.target }, this.dealerIdentity.signKeyPair.secretKey),
          };
          newCommitments.push(cc);
          this.commitments.push(cc);

          if (!this.state.hands[deal.target]) {
            this.state.hands[deal.target] = [];
          }
          this.state.hands[deal.target].push(card);
        }
      }
    }

    return newCommitments;
  }

  decryptCard(commitment: CardCommitment, playerEncryptSecretKey: Uint8Array): { cardId: string; salt: string } {
    return decryptFromDealer(
      commitment.encrypted,
      commitment.nonce,
      this.dealerIdentity.encryptKeyPair.publicKey,
      playerEncryptSecretKey,
    );
  }

  submitAction(action: PlayerAction): { accepted: boolean; state: GameState; pendingActions: PendingAction[] } {
    if (!this.plugin.validateAction(this.state, action)) {
      return { accepted: false, state: this.state, pendingActions: [] };
    }
    const result = this.plugin.applyAction(this.state, action);
    this.state = result.state;

    // Process deal-related pending actions within the engine
    const remainingActions: PendingAction[] = [];
    for (const pa of result.pendingActions) {
      if (pa.type === 'deal-phase') {
        this.dealNextPhase();
      } else if (pa.type === 'deal-to-player') {
        for (let i = 0; i < pa.count; i++) {
          this.dealCardToPlayer(pa.playerId);
        }
      } else {
        // debit/credit pass through to caller (DealerNode)
        remainingActions.push(pa);
      }
    }

    return { accepted: true, state: this.state, pendingActions: remainingActions };
  }

  getStartActions(): PendingAction[] {
    if (this.plugin.getStartActions) {
      return this.plugin.getStartActions(this.state);
    }
    return [];
  }

  dealNextPhase(): CardCommitment[] {
    const dealPlans = this.plugin.getDealPlan(this.state);
    const phasePlan = dealPlans.find((p) => p.phase === this.state.phase);
    if (!phasePlan) return [];
    return this.executeDealPlan(phasePlan, this.originalPlayers);
  }

  // Deal a single extra card to a player (for hit in blackjack, etc.)
  dealCardToPlayer(playerId: string): CardCommitment | null {
    const deck = this.state.deck;
    if (deck.length === 0) return null;

    const card = deck.shift()!;
    const salt = generateSalt();
    const commitment = createCommitment(card.id, salt);
    const cardIndex = this.globalCardIndex++;

    this.cardSecrets.set(cardIndex, { cardId: card.id, salt });

    const targetPlayer = this.originalPlayers.find((p) => p.id === playerId)!;
    const { encrypted, nonce } = encryptForPlayer(
      { cardId: card.id, salt },
      targetPlayer.encryptPubKey,
      this.dealerIdentity.encryptKeyPair.secretKey,
    );

    const cc: CardCommitment = {
      cardIndex,
      commitment,
      encrypted,
      nonce,
      targetPlayerId: playerId,
      signature: signData({ commitment, encrypted, targetPlayer: playerId }, this.dealerIdentity.signKeyPair.secretKey),
    };

    this.commitments.push(cc);
    if (!this.state.hands[playerId]) this.state.hands[playerId] = [];
    this.state.hands[playerId].push(card);

    return cc;
  }

  // Deal a community card (face up)
  dealCommunityCard(): { card: Card; commitment: CardCommitment } | null {
    const deck = this.state.deck;
    if (deck.length === 0) return null;

    const card = deck.shift()!;
    const salt = generateSalt();
    const commitment = createCommitment(card.id, salt);
    const cardIndex = this.globalCardIndex++;

    this.cardSecrets.set(cardIndex, { cardId: card.id, salt });
    this.state.communityCards.push(card);
    this.reveals.push({ cardIndex, cardId: card.id, salt });

    const cc: CardCommitment = {
      cardIndex,
      commitment,
      encrypted: '',
      nonce: '',
      targetPlayerId: 'community',
      signature: signData({ commitment, targetPlayer: 'community' }, this.dealerIdentity.signKeyPair.secretKey),
    };
    this.commitments.push(cc);

    return { card, commitment: cc };
  }

  // Deal a card to the house (virtual player, no encryption)
  dealHouseCard(): { card: Card; commitment: CardCommitment } | null {
    const deck = this.state.deck;
    if (deck.length === 0) return null;

    const card = deck.shift()!;
    const salt = generateSalt();
    const commitment = createCommitment(card.id, salt);
    const cardIndex = this.globalCardIndex++;

    this.cardSecrets.set(cardIndex, { cardId: card.id, salt });
    if (!this.state.hands['house']) this.state.hands['house'] = [];
    this.state.hands['house'].push(card);
    // House cards dealt during play are revealed immediately (face up)
    this.reveals.push({ cardIndex, cardId: card.id, salt });

    const cc: CardCommitment = {
      cardIndex,
      commitment,
      encrypted: '',
      nonce: '',
      targetPlayerId: 'house',
      signature: signData({ commitment, targetPlayer: 'house' }, this.dealerIdentity.signKeyPair.secretKey),
    };
    this.commitments.push(cc);

    return { card, commitment: cc };
  }

  isOver(): boolean {
    return this.plugin.isGameOver(this.state);
  }

  getResult(): GameResult {
    return this.plugin.getResult(this.state);
  }

  getAllReveals(): CardReveal[] {
    for (const [cardIndex, secret] of this.cardSecrets) {
      if (!this.reveals.find((r) => r.cardIndex === cardIndex)) {
        this.reveals.push({ cardIndex, cardId: secret.cardId, salt: secret.salt });
      }
    }
    return [...this.reveals];
  }

  verifyReveal(reveal: CardReveal, commitment: string): boolean {
    return createCommitment(reveal.cardId, reveal.salt) === commitment;
  }

  getState(): GameState {
    return this.state;
  }

  getCommitments(): CardCommitment[] {
    return [...this.commitments];
  }

  getValidActions(): PlayerAction[] {
    return this.plugin.getValidActions(this.state);
  }

  getAutoAction(playerId: string): PlayerAction | null {
    if (this.plugin.getAutoAction) {
      return this.plugin.getAutoAction(this.state, playerId);
    }
    return null;
  }

  getMeta(): { name: string; minPlayers: number; maxPlayers: number; version: string } {
    return this.plugin.meta;
  }

  getPublicState(): Record<string, unknown> {
    return this.plugin.getPublicState(this.state);
  }
}
