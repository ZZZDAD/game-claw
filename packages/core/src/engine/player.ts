import { LocalTransport } from '../transport/local.js';
import { identityToPlayerInfo } from '../crypto/keys.js';
import { decryptFromDealer } from '../crypto/encrypt.js';
import { verifyCommitment } from '../crypto/commitment.js';
import type {
  Identity, Connection, GameEvent, PlayerAction, Card,
  CardCommitment, CardReveal, PlayerInfo, Transport,
} from '../types/index.js';

export interface TurnInfo {
  validActions: (PlayerAction & { cost: number; affordable: boolean })[];
  chipBalance: number;
  phase: string;
  gameType: string;
  warning?: string;
}

export interface GameHistoryEntry {
  handId: number;
  gameType: string;
  hand: { cardId: string; salt: string }[];
  result?: unknown;
  timestamp: number;
}

export class PlayerNode {
  private transport: Transport;
  private connection?: Connection;
  private hand: { cardId: string; salt: string }[] = [];
  private playerInfo: PlayerInfo;
  private allCommitments: { cardIndex: number; commitment: string; targetPlayerId: string }[] = [];
  private dealerEncryptPubKey?: Uint8Array;
  private gameResult?: unknown;
  private onGameEnd?: (result: unknown) => void;
  private onMyTurnCallback?: (turnInfo: TurnInfo) => void;
  private onActionRejectedCallback?: (reason: string) => void;
  private onTimeoutCallback?: (action: PlayerAction) => void;
  private currentPhase = '';
  private currentPlayerIndex = 0;
  private communityCards: Card[] = [];
  private chipBalance = 0;
  private gameType = '';

  // P2-8: Game history
  private history: GameHistoryEntry[] = [];
  private handCounter = 0;

  constructor(
    private identity: Identity,
    private npmVersion: string,
    transport?: Transport,
  ) {
    this.transport = transport ?? new LocalTransport();
    this.playerInfo = identityToPlayerInfo(identity);
  }

  getPlayerId(): string {
    return this.playerInfo.id;
  }

  getHand(): { cardId: string; salt: string }[] {
    return this.hand;
  }

  getPhase(): string {
    return this.currentPhase;
  }

  getCurrentPlayerIndex(): number {
    return this.currentPlayerIndex;
  }

  getCommunityCards(): Card[] {
    return this.communityCards;
  }

  async join(roomUrl: string): Promise<{ accepted: boolean; reason?: string }> {
    // P2-10: Catch connection failures gracefully
    try {
      this.connection = await this.transport.connect(roomUrl);
    } catch (err) {
      return { accepted: false, reason: `Connection failed: ${(err as Error).message}` };
    }

    return new Promise((resolve) => {
      this.connection!.onMessage((event: GameEvent) => {
        switch (event.type) {
          case 'join-response': {
            const payload = event.payload as { accepted: boolean; reason?: string; roomConfig?: { gameType?: string } };
            if (payload.roomConfig?.gameType) {
              this.gameType = payload.roomConfig.gameType;
            }
            resolve(payload);
            break;
          }
          case 'game-start':
            this.handleGameStart(event);
            break;
          case 'new-card':
            this.handleNewCard(event);
            break;
          case 'action-result':
            this.handleActionResult(event);
            break;
          case 'phase-deal':
            this.handlePhaseDeal(event);
            break;
          case 'game-end':
            this.handleGameEnd(event);
            break;
          case 'your-turn':
            this.handleYourTurn(event);
            break;
          case 'action-rejected':
            this.onActionRejectedCallback?.((event.payload as any)?.reason ?? 'Unknown');
            break;
          case 'timeout-action':
            this.handleTimeoutAction(event);
            break;
          case 'kicked':
            resolve({ accepted: false, reason: (event.payload as any)?.reason ?? 'Kicked' });
            break;
          case 'query-result':
          case 'query-error':
            this.handleQueryResponse(event);
            break;
        }
      });

      this.connection!.send({
        type: 'join-request',
        payload: { playerInfo: this.playerInfo, npmVersion: this.npmVersion },
        from: this.playerInfo.id,
      });
    });
  }

  private handleGameStart(event: GameEvent): void {
    const payload = event.payload as {
      playerCommitments: CardCommitment[];
      publicCommitments: CardCommitment[];
      allCommitments: { cardIndex: number; commitment: string; targetPlayerId: string }[];
      dealerEncryptPubKey: number[];
      communityCards?: Card[];
    };

    this.dealerEncryptPubKey = new Uint8Array(payload.dealerEncryptPubKey);
    this.allCommitments = payload.allCommitments;
    if (payload.communityCards) {
      this.communityCards = payload.communityCards;
    }

    // Decrypt our cards
    for (const cc of payload.playerCommitments) {
      const decrypted = decryptFromDealer(
        cc.encrypted,
        cc.nonce,
        this.dealerEncryptPubKey,
        this.identity.encryptKeyPair.secretKey,
      );
      this.hand.push(decrypted);
    }
  }

  private handleNewCard(event: GameEvent): void {
    const payload = event.payload as { commitment: CardCommitment };
    const cc = payload.commitment;
    const decrypted = decryptFromDealer(
      cc.encrypted,
      cc.nonce,
      this.dealerEncryptPubKey!,
      this.identity.encryptKeyPair.secretKey,
    );
    this.hand.push(decrypted);
    this.allCommitments.push({
      cardIndex: cc.cardIndex,
      commitment: cc.commitment,
      targetPlayerId: cc.targetPlayerId,
    });
  }

  private handleActionResult(event: GameEvent): void {
    const payload = event.payload as {
      accepted: boolean;
      phase: string;
      currentPlayerIndex: number;
    };
    this.currentPhase = payload.phase;
    this.currentPlayerIndex = payload.currentPlayerIndex;
  }

  private handlePhaseDeal(event: GameEvent): void {
    const payload = event.payload as {
      phase: string;
      commitments: CardCommitment[];
      communityCards: Card[];
    };
    this.communityCards = payload.communityCards;
    for (const cc of payload.commitments) {
      this.allCommitments.push({
        cardIndex: cc.cardIndex,
        commitment: cc.commitment,
        targetPlayerId: cc.targetPlayerId,
      });
    }
  }

  private handleYourTurn(event: GameEvent): void {
    const payload = event.payload as TurnInfo;
    this.chipBalance = payload.chipBalance;
    // Attach gameType so AI knows what game it's playing
    payload.gameType = this.gameType;
    this.onMyTurnCallback?.(payload);
  }

  // P2-8: Game end handler — records history
  private handleGameEnd(event: GameEvent): void {
    this.gameResult = event.payload;

    // Record in history
    this.handCounter++;
    this.history.push({
      handId: this.handCounter,
      gameType: this.gameType,
      hand: [...this.hand],
      result: event.payload,
      timestamp: Date.now(),
    });

    // Reset hand for next game
    this.hand = [];

    this.onGameEnd?.(event.payload);
  }

  // Handle query responses from dealer
  private handleQueryResponse(event: GameEvent): void {
    const payload = event.payload as { nonce?: string; error?: string; [key: string]: unknown };
    const nonce = payload.nonce;
    if (nonce && this.pendingQueries.has(nonce)) {
      const resolve = this.pendingQueries.get(nonce)!;
      if (event.type === 'query-error') {
        // Still resolve (let caller handle error), don't reject to avoid unhandled promises
        resolve({ error: payload.error });
      } else {
        resolve(payload);
      }
    }
  }

  // P2-11: Handle timeout auto-action notification
  private handleTimeoutAction(event: GameEvent): void {
    const payload = event.payload as { action: PlayerAction; reason: string };
    this.onTimeoutCallback?.(payload.action);
  }

  // === Public API for AI / UI ===

  /**
   * Register callback for when it's your turn.
   * The callback receives: valid actions (with cost + affordable flag),
   * your chip balance, current phase, and warning if chips are low.
   */
  onMyTurn(callback: (turnInfo: TurnInfo) => void): void {
    this.onMyTurnCallback = callback;
  }

  /**
   * Register callback for when your action is rejected.
   */
  onActionRejected(callback: (reason: string) => void): void {
    this.onActionRejectedCallback = callback;
  }

  /**
   * Register callback for when you time out and an auto-action is taken.
   */
  onTimeout(callback: (action: PlayerAction) => void): void {
    this.onTimeoutCallback = callback;
  }

  getChipBalance(): number {
    return this.chipBalance;
  }

  getGameType(): string {
    return this.gameType;
  }

  /** P2-8: Get full game history */
  getHistory(): GameHistoryEntry[] {
    return [...this.history];
  }

  async sendAction(action: PlayerAction): Promise<void> {
    this.connection?.send({
      type: 'action',
      payload: action,
      from: this.playerInfo.id,
    });
  }

  // ============================================================
  // Query Protocol — request info from dealer
  // ============================================================

  private queryNonce = 0;
  private pendingQueries = new Map<string, (result: unknown) => void>();

  /**
   * Send a query to the dealer and wait for the response.
   * Times out after 5 seconds.
   */
  private async query(queryType: string, timeoutMs = 5000): Promise<unknown> {
    if (!this.connection) throw new Error('Not connected');
    const nonce = `q-${++this.queryNonce}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingQueries.delete(nonce);
        reject(new Error(`Query ${queryType} timed out`));
      }, timeoutMs);

      this.pendingQueries.set(nonce, (result) => {
        clearTimeout(timer);
        this.pendingQueries.delete(nonce);
        resolve(result);
      });

      this.connection!.send({
        type: 'query',
        payload: { queryType, nonce },
        from: this.playerInfo.id,
      });
    });
  }

  /** Query my current chip balance from the dealer */
  async queryBalance(): Promise<number> {
    const result = await this.query('my-balance') as { balance: number };
    this.chipBalance = result.balance;
    return result.balance;
  }

  /** Query the full room state (all players, their status and chip balances) */
  async queryRoomState(): Promise<{
    phase: string;
    handCount: number;
    currentHandId?: string;
    players: { playerId: string; status: string; chipBalance: number }[];
  }> {
    return await this.query('room-state') as any;
  }

  /** Query the current table/game public state (pot, bets, community cards, etc.) */
  async queryTableState(): Promise<{
    state: Record<string, unknown> | null;
    phase?: string;
    currentPlayerIndex?: number;
  }> {
    return await this.query('table-state') as any;
  }

  /** Query the room configuration */
  async queryRoomConfig(): Promise<Record<string, unknown>> {
    const result = await this.query('room-config') as { roomConfig: Record<string, unknown> };
    return result.roomConfig;
  }

  /** Query my own status (seat status, chip balance, credit score) */
  async queryMyStatus(): Promise<{
    status: string;
    chipBalance: number;
    creditScore: number;
  }> {
    return await this.query('my-status') as any;
  }

  verifyReveals(reveals: CardReveal[]): boolean {
    for (const reveal of reveals) {
      const matching = this.allCommitments.find((c) => c.cardIndex === reveal.cardIndex);
      if (!matching) return false;
      if (!verifyCommitment(reveal.cardId, reveal.salt, matching.commitment)) return false;
    }
    return true;
  }

  waitForGameEnd(): Promise<unknown> {
    if (this.gameResult) return Promise.resolve(this.gameResult);
    return new Promise((resolve) => { this.onGameEnd = resolve; });
  }

  async disconnect(): Promise<void> {
    this.connection?.close();
    await this.transport.stop();
  }
}
