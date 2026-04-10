import { LocalTransport } from '../transport/local.js';
import { GameEngine } from './game-engine.js';
import { createChipProvider } from '../chip/factory.js';
import { identityToPlayerInfo } from '../crypto/keys.js';
import type {
  GamePlugin, Identity, PlayerInfo, Connection, GameEvent, PlayerAction,
  CardCommitment, RoomConfig, Transport, ChipProvider, PendingAction,
  RoomPhase, PlayerStatus, SeatInfo, RoomState, GameResult, DebitResponse,
} from '../types/index.js';

export interface DealerLogger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

const defaultLogger: DealerLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface DealerNodeConfig {
  actionTimeout?: number;       // default 30000
  betweenHandsDelay?: number;   // default 10000
  reconnectTimeout?: number;    // default 60000
  autoStart?: boolean;          // default true — auto-start when minPlayers reached
  logger?: DealerLogger;
  actionRateLimit?: number;     // max actions per second per player (default 10)
}

export class DealerNode {
  private transport: Transport;
  private connections = new Map<string, Connection>();
  private playerInfos: PlayerInfo[] = [];
  private engine!: GameEngine;
  private npmVersion: string;
  private roomConfig: RoomConfig;
  private gameStarted = false;
  private chipProvider?: ChipProvider;
  private gameId: string;

  // === Room management state (merged from RoomManager) ===
  private phase: RoomPhase = 'idle';
  private seats = new Map<string, SeatInfo>();
  private handCount = 0;
  private currentHandId?: string;
  private actionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private betweenHandsTimer?: ReturnType<typeof setTimeout>;
  private playerInfoMap = new Map<string, PlayerInfo>();

  private actionTimeout: number;
  private betweenHandsDelay: number;
  private reconnectTimeout: number;
  private minPlayers: number;
  private maxPlayers: number;
  private autoStart: boolean;

  // Event callbacks
  private onHandCompleteCallbacks: Array<(result: GameResult) => void> = [];
  private onPhaseChangeCallbacks: Array<(phase: RoomPhase) => void> = [];
  private onPlayerDisconnectCallbacks: Array<(playerId: string) => void> = [];

  // Logger
  private logger: DealerLogger;

  // Rate limiting: playerId -> timestamps of recent actions
  private actionRateLimit: number;
  private actionTimestamps = new Map<string, number[]>();

  // Lock to prevent concurrent state mutations
  private processingAction = false;

  /**
   * @param plugin - Game rules (only used internally to create GameEngine instances per hand)
   * @param identity - Dealer's cryptographic identity
   * @param npmVersion - Version for compatibility check
   * @param roomConfig - Room settings (chips, blinds, commission)
   * @param transport - Network transport (default: LocalTransport)
   * @param config - Timeout and auto-start settings
   */
  constructor(
    private readonly _plugin: GamePlugin, // only used to create engine — DealerNode never calls plugin methods directly
    private identity: Identity,
    npmVersion: string,
    roomConfig: RoomConfig,
    transport?: Transport,
    config?: DealerNodeConfig,
  ) {
    this.npmVersion = npmVersion;
    this.roomConfig = roomConfig;
    this.transport = transport ?? new LocalTransport();
    this.gameId = `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (roomConfig?.chipProvider) {
      this.chipProvider = createChipProvider(roomConfig.chipProvider);
    }
    this.actionTimeout = config?.actionTimeout ?? 30000;
    this.betweenHandsDelay = config?.betweenHandsDelay ?? 10000;
    this.reconnectTimeout = config?.reconnectTimeout ?? 60000;
    // Read meta once from plugin, then never touch plugin again
    this.minPlayers = _plugin.meta.minPlayers;
    this.maxPlayers = _plugin.meta.maxPlayers;
    this.autoStart = config?.autoStart ?? true;
    this.logger = config?.logger ?? defaultLogger;
    this.actionRateLimit = config?.actionRateLimit ?? 10;
  }

  // === Lifecycle ===

  async createRoom(port = 0): Promise<string> {
    const url = await this.transport.start(port);
    this.transport.onConnection((conn) => this.handleConnection(conn));
    this.setPhase('waiting');
    return url;
  }

  getRoomConfig(): RoomConfig {
    return this.roomConfig;
  }

  getPlayerCount(): number {
    return this.playerInfos.length;
  }

  private handleConnection(conn: Connection): void {
    conn.onMessage((event: GameEvent) => {
      if (event.type === 'join-request') {
        this.handleJoin(conn, event);
      } else if (event.type === 'action') {
        this.handleAction(event);
      } else if (event.type === 'query') {
        this.handleQuery(conn, event);
      }
    });
  }

  private handleJoin(conn: Connection, event: GameEvent): void {
    const { playerInfo, npmVersion } = event.payload as { playerInfo: PlayerInfo; npmVersion: string };

    // P3-14: Validate Uint8Array format before reconstruction
    let pi: PlayerInfo;
    try {
      pi = deserializePlayerInfo(playerInfo);
    } catch (err) {
      conn.send({ type: 'join-response', payload: { accepted: false, reason: `Invalid player info: ${(err as Error).message}` }, from: 'dealer' });
      return;
    }

    if (npmVersion !== this.npmVersion) {
      conn.send({ type: 'join-response', payload: { accepted: false, reason: `Version mismatch: need ${this.npmVersion}` }, from: 'dealer' });
      return;
    }
    if (this.gameStarted) {
      conn.send({ type: 'join-response', payload: { accepted: false, reason: 'Game already started' }, from: 'dealer' });
      return;
    }
    // C2: Reject duplicate players
    if (this.playerInfos.some(p => p.id === pi.id)) {
      conn.send({ type: 'join-response', payload: { accepted: false, reason: 'Player already joined' }, from: 'dealer' });
      return;
    }

    this.playerInfos.push(pi);
    this.connections.set(pi.id, conn);
    conn.remoteId = pi.id;

    // Player sees room config on join, so they can decide to stay or leave
    conn.send({
      type: 'join-response',
      payload: {
        accepted: true,
        roomConfig: this.roomConfig,
        players: this.playerInfos,
      },
      from: 'dealer',
    });
  }

  async startGame(options?: Record<string, unknown>): Promise<void> {
    this.gameStarted = true;
    this.engine = new GameEngine(this._plugin, this.identity);
    const gameOptions = { ...options, roomConfig: this.roomConfig };
    const { commitments } = this.engine.startGame(this.playerInfos, gameOptions);

    // Process start actions (blind debits, commission debits) via chipProvider
    if (this.chipProvider) {
      // P0-3: Check balances before starting
      const commission = this.roomConfig.commission ?? 0;
      for (const pi of this.playerInfos) {
        try {
          const bal = await this.chipProvider.getBalance(pi.id);
          if (bal.balance < (this.roomConfig.minBet + commission)) {
            this.logger.warn(`Player ${pi.id} has insufficient balance (${bal.balance}), removing from game`);
            const conn = this.connections.get(pi.id);
            if (conn) {
              conn.send({ type: 'kicked', payload: { reason: 'Insufficient balance' }, from: 'dealer' });
            }
          }
        } catch (err) {
          this.logger.error(`Failed to check balance for ${pi.id}:`, err);
        }
      }

      // Debit per-player commission (await each)
      if (commission > 0) {
        for (const pi of this.playerInfos) {
          try {
            const result = await this.chipProvider.debit({
              gameId: this.gameId, playerId: pi.id, amount: commission, reason: 'commission',
            });
            if (!result.success) {
              this.logger.error(`Commission debit failed for ${pi.id}: ${result.reason}`);
            }
          } catch (err) {
            this.logger.error(`Commission debit error for ${pi.id}:`, err);
          }
        }
      }

      const startActions = this.engine.getStartActions();
      // Debit blinds etc. (await)
      await this.processPendingActions(startActions);
    }

    for (const [playerId, conn] of this.connections) {
      const playerCommitments = commitments.filter((c) => c.targetPlayerId === playerId);
      const publicCommitments = commitments.filter((c) =>
        c.targetPlayerId === 'community' || c.targetPlayerId === 'burn'
      );
      conn.send({
        type: 'game-start',
        payload: {
          playerCommitments,
          publicCommitments,
          allCommitments: commitments.map((c) => ({
            cardIndex: c.cardIndex,
            commitment: c.commitment,
            targetPlayerId: c.targetPlayerId,
          })),
          dealerEncryptPubKey: Array.from(this.identity.encryptKeyPair.publicKey),
          communityCards: this.engine.getState().communityCards,
        },
        from: 'dealer',
      });
    }

    // Notify the first player it's their turn
    this.notifyCurrentPlayer();
  }

  private async handleAction(event: GameEvent): Promise<void> {
    const action = event.payload as PlayerAction;

    // H4: Reject actions from disconnected players
    const seat = this.seats.get(action.playerId);
    if (seat && seat.status === 'disconnected') {
      this.logger.warn(`Rejected action from disconnected player ${action.playerId}`);
      return;
    }

    // P3-15: Rate limiting
    if (!this.checkRateLimit(action.playerId)) {
      const senderConn = this.connections.get(action.playerId);
      if (senderConn) {
        senderConn.send({
          type: 'action-rejected',
          payload: { action, reason: 'Rate limit exceeded' },
          from: 'dealer',
        });
      }
      return;
    }

    const result = this.engine.submitAction(action);

    // === Validation failed -> only reply to the sender, do NOT broadcast ===
    if (!result.accepted) {
      const senderConn = this.connections.get(action.playerId);
      if (senderConn) {
        senderConn.send({
          type: 'action-rejected',
          payload: { action, reason: 'Invalid action' },
          from: 'dealer',
        });
      }
      return; // stop here -- other players don't need to know about invalid actions
    }

    // === Validation passed -> process chip actions (await) and broadcast ===
    if (this.chipProvider) {
      await this.processPendingActions(result.pendingActions);
    }

    // Broadcast to ALL players — action + full public table state
    this.broadcast({
      type: 'action-result',
      payload: {
        action,
        accepted: true,
        phase: result.state.phase,
        currentPlayerIndex: result.state.currentPlayerIndex,
        publicState: this.engine.getPublicState(),
      },
      from: 'dealer',
    });

    // === Notify next player it's their turn ===
    if (!this.engine.isOver()) {
      this.notifyCurrentPlayer();
    }

    if (this.engine.isOver()) {
      const gameResult = this.engine.getResult();
      const reveals = this.engine.getAllReveals();

      // === Credit winners + dealer commission via chipProvider (await) ===
      if (this.chipProvider) {
        const dealerPlayerId = identityToPlayerInfo(this.identity).id;
        const totalContributions = this.engine.getState().roundData.totalContributions as Record<string, number> ?? {};

        for (const [playerId, netChange] of Object.entries(gameResult.pointChanges)) {
          const contribution = totalContributions[playerId] ?? 0;
          const perPlayerCommission = this.roomConfig.commission ?? 0;
          const creditAmount = netChange + contribution + perPlayerCommission;
          if (creditAmount > 0) {
            try {
              const creditResult = await this.chipProvider.credit({
                gameId: this.gameId, playerId, amount: creditAmount, reason: 'pot',
              });
              if (!creditResult.success) {
                this.logger.error(`Credit failed for ${playerId}: amount=${creditAmount}`);
              }
            } catch (err) {
              this.logger.error(`Credit error for ${playerId}:`, err);
            }
          }
        }

        // Credit total commission to dealer
        if (gameResult.commission > 0) {
          try {
            const creditResult = await this.chipProvider.credit({
              gameId: this.gameId, playerId: dealerPlayerId,
              amount: gameResult.commission, reason: 'commission',
            });
            if (!creditResult.success) {
              this.logger.error(`Commission credit failed for dealer`);
            }
          } catch (err) {
            this.logger.error(`Commission credit error for dealer:`, err);
          }
        }
      }

      this.broadcast({
        type: 'game-end',
        payload: { result: gameResult, reveals },
        from: 'dealer',
      });
    }
  }

  // ============================================================
  // Query Protocol — players can request info from dealer
  // ============================================================

  /**
   * Handle query requests from players.
   *
   * Security:
   *   - Only connected players with a known playerId can query
   *   - Each player can only see their own private data (balance, hand status)
   *   - Public data (room state, table state) visible to all connected players
   *   - Rate limited via the same checkRateLimit mechanism
   *   - Private fields (deck, other players' hands, secret keys) NEVER exposed
   */
  private async handleQuery(conn: Connection, event: GameEvent): Promise<void> {
    const payload = event.payload as { queryType: string; nonce?: string };
    const playerId = event.from;

    // Verify the requester is a connected player
    if (!this.connections.has(playerId) || this.connections.get(playerId) !== conn) {
      conn.send({
        type: 'query-error',
        payload: { error: 'Unauthorized: not a connected player', nonce: payload.nonce },
        from: 'dealer',
      });
      return;
    }

    // Rate limit queries (same as actions)
    if (!this.checkRateLimit(playerId)) {
      conn.send({
        type: 'query-error',
        payload: { error: 'Rate limit exceeded', nonce: payload.nonce },
        from: 'dealer',
      });
      return;
    }

    const nonce = payload.nonce; // echo back so client can match request/response

    switch (payload.queryType) {
      case 'my-balance': {
        // Player's own chip balance — from seat info or chipProvider
        let balance = 0;
        const seat = this.seats.get(playerId);
        if (seat) {
          balance = seat.chipBalance;
        } else if (this.chipProvider) {
          try {
            const bal = await this.chipProvider.getBalance(playerId);
            balance = bal.balance;
          } catch {
            balance = 0;
          }
        }
        conn.send({
          type: 'query-result',
          payload: { queryType: 'my-balance', balance, nonce },
          from: 'dealer',
        });
        break;
      }

      case 'room-state': {
        // Public room info: phase, player list (id + status + chipBalance), hand count
        // Does NOT expose: secret keys, deck, private hands
        const players = [...this.seats.values()].map(s => ({
          playerId: s.playerId,
          status: s.status,
          chipBalance: s.chipBalance,
        }));
        conn.send({
          type: 'query-result',
          payload: {
            queryType: 'room-state',
            phase: this.phase,
            handCount: this.handCount,
            currentHandId: this.currentHandId,
            players,
            nonce,
          },
          from: 'dealer',
        });
        break;
      }

      case 'table-state': {
        // Current game's public state (pot, bets, community cards, etc.)
        if (!this.engine) {
          conn.send({
            type: 'query-result',
            payload: { queryType: 'table-state', state: null, reason: 'No active game', nonce },
            from: 'dealer',
          });
        } else {
          conn.send({
            type: 'query-result',
            payload: {
              queryType: 'table-state',
              state: this.engine.getPublicState(),
              phase: this.engine.getState().phase,
              currentPlayerIndex: this.engine.getState().currentPlayerIndex,
              nonce,
            },
            from: 'dealer',
          });
        }
        break;
      }

      case 'room-config': {
        // Room configuration — safe to share (player already got it on join)
        conn.send({
          type: 'query-result',
          payload: {
            queryType: 'room-config',
            roomConfig: this.roomConfig,
            nonce,
          },
          from: 'dealer',
        });
        break;
      }

      case 'my-status': {
        // Player's own seat info
        const seat = this.seats.get(playerId);
        conn.send({
          type: 'query-result',
          payload: {
            queryType: 'my-status',
            status: seat?.status ?? 'unknown',
            chipBalance: seat?.chipBalance ?? 0,
            creditScore: seat?.creditScore ?? 0,
            nonce,
          },
          from: 'dealer',
        });
        break;
      }

      default: {
        conn.send({
          type: 'query-error',
          payload: { error: `Unknown query type: ${payload.queryType}`, nonce },
          from: 'dealer',
        });
      }
    }
  }

  private async processPendingActions(pendingActions: PendingAction[]): Promise<void> {
    if (!this.chipProvider) return;
    for (const pa of pendingActions) {
      if (pa.type === 'debit') {
        try {
          const result = await this.chipProvider.debit({
            gameId: this.gameId,
            playerId: pa.playerId,
            amount: pa.amount,
            reason: pa.reason,
          });
          if (!result.success) {
            this.logger.error(`Debit failed for ${pa.playerId}: ${result.reason} (amount=${pa.amount}, reason=${pa.reason})`);
          } else {
            this.logger.info(`Debit OK: ${pa.playerId} -${pa.amount} (${pa.reason})`);
          }
        } catch (err) {
          this.logger.error(`Debit error for ${pa.playerId}:`, err);
        }
      } else if (pa.type === 'credit') {
        try {
          const result = await this.chipProvider.credit({
            gameId: this.gameId,
            playerId: pa.playerId,
            amount: pa.amount,
            reason: pa.reason,
          });
          if (!result.success) {
            this.logger.error(`Credit failed for ${pa.playerId}: amount=${pa.amount}, reason=${pa.reason}`);
          } else {
            this.logger.info(`Credit OK: ${pa.playerId} +${pa.amount} (${pa.reason})`);
          }
        } catch (err) {
          this.logger.error(`Credit error for ${pa.playerId}:`, err);
        }
      }
    }
  }

  /**
   * Notify the current player that it's their turn.
   * Sends: valid actions, their chip balance, and whether they can afford each action.
   */
  private notifyCurrentPlayer(): void {
    const state = this.engine.getState();
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer) return;

    const conn = this.connections.get(currentPlayer.id);
    if (!conn) return;

    // Get valid actions from the game plugin
    const validActions = this.engine.getValidActions();

    // Get player's chip balance from seat info
    const seat = this.seats.get(currentPlayer.id);
    const chipBalance = seat?.chipBalance ?? 0;

    // Annotate each action with whether the player can afford it
    const annotatedActions = validActions.map(action => {
      let cost = 0;
      const bets = state.roundData.bets as Record<string, number> | undefined;
      const playerBet = bets?.[currentPlayer.id] ?? 0;

      if (action.type === 'call') {
        cost = (state.roundData.currentBet as number ?? 0) - playerBet;
      } else if (action.type === 'raise') {
        cost = ((action.payload as any)?.amount ?? 0) - playerBet;
      } else if (action.type === 'all-in') {
        cost = ((action.payload as any)?.amount ?? 0) - playerBet;
      } else if (action.type === 'bet') {
        cost = (action.payload as any)?.amount ?? 0;
      }

      return {
        ...action,
        cost,
        affordable: cost <= chipBalance,
      };
    });

    const affordable = annotatedActions.filter(a => a.affordable);
    const tooExpensive = annotatedActions.filter(a => !a.affordable);

    conn.send({
      type: 'your-turn',
      payload: {
        validActions: annotatedActions,
        chipBalance,
        phase: state.phase,
        // Warn if no affordable actions except fold/pass
        warning: affordable.length <= 1 && tooExpensive.length > 0
          ? 'Insufficient chips for most actions'
          : undefined,
      },
      from: 'dealer',
    });
  }

  private broadcast(event: GameEvent): void {
    for (const conn of this.connections.values()) {
      conn.send(event);
    }
  }

  isGameOver(): boolean {
    return this.engine?.isOver() ?? false;
  }

  getEngine(): GameEngine {
    return this.engine;
  }

  async stop(): Promise<void> {
    this.clearAllTimers();
    this.setPhase('closed');
    // Mark all players as left
    for (const seat of this.seats.values()) {
      if (seat.status !== 'left') {
        seat.status = 'left';
      }
    }
    await this.transport.stop();
  }

  // ============================================================
  // Room management (merged from RoomManager)
  // ============================================================

  // === Player Management ===

  handlePlayerJoin(playerInfo: PlayerInfo, conn: Connection): { accepted: boolean; reason?: string } {
    if (this.phase !== 'waiting' && this.phase !== 'between-hands') {
      return { accepted: false, reason: `Cannot join during '${this.phase}' phase` };
    }

    if (this.seats.has(playerInfo.id)) {
      const seat = this.seats.get(playerInfo.id)!;
      if (seat.status === 'left') {
        // Re-joining after leaving -- treat as new join
        seat.status = 'seated';
        seat.chipBalance = this.roomConfig.buyIn;
        seat.disconnectedAt = undefined;
        this.connections.set(playerInfo.id, conn);
        this.playerInfoMap.set(playerInfo.id, playerInfo);
        this.tryAutoStart();
        return { accepted: true };
      }
      return { accepted: false, reason: 'Already in room' };
    }

    const activeSeats = this.getActiveSeats();
    if (activeSeats.length >= this.maxPlayers) {
      return { accepted: false, reason: 'Room is full' };
    }

    const seat: SeatInfo = {
      playerId: playerInfo.id,
      playerInfo,
      status: 'seated',
      chipBalance: this.roomConfig.buyIn,
      creditScore: 100,
    };
    this.seats.set(playerInfo.id, seat);
    this.connections.set(playerInfo.id, conn);
    this.playerInfoMap.set(playerInfo.id, playerInfo);

    // === Auto-detect disconnect via WebSocket close ===
    conn.onClose(() => {
      this.onConnectionLost(playerInfo.id);
    });

    // Auto-start when enough players join
    this.tryAutoStart();

    return { accepted: true };
  }

  handlePlayerLeave(playerId: string): void {
    const seat = this.seats.get(playerId);
    if (!seat) return;

    // If leaving during active play, penalize credit score
    if (this.phase === 'playing') {
      seat.creditScore = Math.max(0, seat.creditScore - 5);
    }

    seat.status = 'left';
    this.connections.delete(playerId);
    this.clearActionTimer(playerId);
    // L10: Clean up rate limit timestamps for left player
    this.actionTimestamps.delete(playerId);
  }

  /**
   * Called automatically when a player's WebSocket connection drops.
   * Also can be called manually for testing.
   */
  handlePlayerDisconnect(playerId: string): void {
    this.onConnectionLost(playerId);
  }

  private onConnectionLost(playerId: string): void {
    const seat = this.seats.get(playerId);
    if (!seat || seat.status === 'left') return;
    if (seat.status === 'disconnected') return; // already disconnected

    seat.status = 'disconnected';
    seat.disconnectedAt = Date.now();
    this.connections.delete(playerId);

    // Notify listeners
    this.onPlayerDisconnectCallbacks.forEach((cb) => cb(playerId));

    // Start reconnect countdown
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(playerId);
      this.onReconnectExpired(playerId);
    }, this.reconnectTimeout);
    this.reconnectTimers.set(playerId, timer);
  }

  private onReconnectExpired(playerId: string): void {
    const seat = this.seats.get(playerId);
    if (!seat || seat.status !== 'disconnected') return;

    // Reconnect window expired -- force leave
    seat.creditScore = Math.max(0, seat.creditScore - 5); // flee penalty
    seat.status = 'left';
    this.logger.info(`Reconnect expired for ${playerId}, forced leave`);
  }

  /**
   * Player reconnects with a new connection.
   * Must be within the reconnect timeout window.
   */
  handlePlayerReconnect(playerId: string, conn: Connection): { accepted: boolean; reason?: string } {
    const seat = this.seats.get(playerId);
    if (!seat) {
      return { accepted: false, reason: 'Not in room' };
    }
    if (seat.status !== 'disconnected') {
      return { accepted: false, reason: `Player status is '${seat.status}', not disconnected` };
    }

    // Cancel the reconnect expiry timer
    const timer = this.reconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(playerId);
    }

    // Restore status
    seat.status = this.phase === 'playing' ? 'playing' : 'seated';
    seat.disconnectedAt = undefined;
    this.connections.set(playerId, conn);

    // Wire up close detection on the new connection
    conn.onClose(() => {
      this.onConnectionLost(playerId);
    });

    return { accepted: true };
  }

  handlePlayerSitOut(playerId: string): void {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    if (seat.status === 'left' || seat.status === 'disconnected') return;
    seat.status = 'sit-out';
  }

  handlePlayerSitIn(playerId: string): void {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    if (seat.status !== 'sit-out') return;
    seat.status = 'seated';
  }

  // === Game Flow ===

  /**
   * Auto-start: when enough players have joined, automatically start the game.
   */
  private tryAutoStart(): void {
    if (!this.autoStart) return;
    if (this.phase !== 'waiting') return;
    const playable = this.getPlayablePlayers();
    if (playable.length >= this.minPlayers) {
      this.startNextHand();
    }
  }

  async startNextHand(): Promise<void> {
    const playablePlayers = this.getPlayablePlayers();
    if (playablePlayers.length < this.minPlayers) {
      // Not enough players -- stay in waiting or go to waiting
      this.setPhase('waiting');
      return;
    }

    // Mark playing players
    for (const pi of playablePlayers) {
      const seat = this.seats.get(pi.id)!;
      seat.status = 'playing';
    }

    this.handCount++;
    this.currentHandId = `hand-${this.handCount}`;
    this.setPhase('playing');

    // Fresh game ID for each hand
    this.gameId = `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Create a fresh engine for each hand
    this.engine = new GameEngine(this._plugin, this.identity);
    this.playerInfos = playablePlayers;

    // Start the game
    const options: Record<string, unknown> = {
      buttonIndex: (this.handCount - 1) % playablePlayers.length,
    };
    await this.startGame(options);

    // Start action timer for the current player
    const state = this.engine.getState();
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (currentPlayer) {
      this.startActionTimer(currentPlayer.id);
    }
  }

  /**
   * Submit an action from a player (room-managed path).
   * Validates the player is active, forwards to the engine,
   * handles timeouts, and detects hand completion.
   */
  submitAction(action: PlayerAction): { accepted: boolean } {
    if (this.phase !== 'playing') {
      return { accepted: false };
    }

    const seat = this.seats.get(action.playerId);
    if (!seat || (seat.status !== 'playing' && seat.status !== 'disconnected')) {
      return { accepted: false };
    }

    const engine = this.engine;
    const result = engine.submitAction(action);
    if (!result.accepted) {
      return { accepted: false };
    }

    // Clear the timer for the player who just acted
    this.clearActionTimer(action.playerId);

    // Update credit score: completed action = +1
    seat.creditScore = Math.min(200, seat.creditScore + 1);

    // Check for game over
    if (engine.isOver()) {
      const gameResult = engine.getResult();
      this.onHandComplete(gameResult);
      return { accepted: true };
    }

    // Start timer for next player
    const state = engine.getState();
    const nextPlayer = state.players[state.currentPlayerIndex];
    if (nextPlayer) {
      this.startActionTimer(nextPlayer.id);
    }

    return { accepted: true };
  }

  private onHandComplete(result: GameResult): void {
    this.setPhase('settling');

    // Apply point changes to chip balances
    for (const [playerId, change] of Object.entries(result.pointChanges)) {
      const seat = this.seats.get(playerId);
      if (seat) {
        seat.chipBalance += change;
      }
    }

    this.clearAllTimers();

    // Notify callbacks
    for (const cb of this.onHandCompleteCallbacks) {
      cb(result);
    }

    // Transition to between-hands
    this.setPhase('between-hands');

    // Reset player statuses for next hand
    for (const seat of this.seats.values()) {
      if (seat.status === 'playing') {
        seat.status = 'seated';
      }
    }

    // Mark game as not started so new hands can begin
    this.gameStarted = false;

    // Schedule next hand (P1-4: re-check seat status atomically before starting)
    this.betweenHandsTimer = setTimeout(() => {
      this.betweenHandsTimer = undefined;
      // Snapshot playable players AFTER all reconnect timeouts may have fired
      const playable = this.getPlayablePlayers();
      this.logger.info(`Between-hands: ${playable.length} playable players (need ${this.minPlayers})`);
      if (playable.length >= this.minPlayers) {
        this.startNextHand();
      } else {
        this.setPhase('waiting');
      }
    }, this.betweenHandsDelay);
  }

  startActionTimer(playerId: string): void {
    this.clearActionTimer(playerId);
    const timer = setTimeout(() => {
      this.handleTimeout(playerId);
    }, this.actionTimeout);
    this.actionTimers.set(playerId, timer);
  }

  private handleTimeout(playerId: string): void {
    this.actionTimers.delete(playerId);

    if (this.phase !== 'playing') return;

    const engine = this.engine;
    const state = engine.getState();
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) return;

    // Use engine's getAutoAction (delegates to plugin internally)
    let autoAction: PlayerAction;
    const auto = engine.getAutoAction(playerId);
    if (auto) {
      autoAction = auto;
    } else {
      autoAction = { playerId, type: 'fold' };
    }

    this.logger.info(`Action timeout for ${playerId}, auto-action: ${autoAction.type}`);

    // P2-11: Notify the player that they timed out and an auto-action was taken
    const conn = this.connections.get(playerId);
    if (conn) {
      conn.send({
        type: 'timeout-action',
        payload: { action: autoAction, reason: 'Action timeout' },
        from: 'dealer',
      });
    }

    this.submitAction(autoAction);
  }

  // === State Accessors ===

  getRoomState(): RoomState {
    return {
      phase: this.phase,
      seats: new Map(this.seats),
      handCount: this.handCount,
      currentHandId: this.currentHandId,
    };
  }

  getPlayerStatus(playerId: string): PlayerStatus | undefined {
    return this.seats.get(playerId)?.status;
  }

  getPhase(): RoomPhase {
    return this.phase;
  }

  getHandCount(): number {
    return this.handCount;
  }

  getSeatInfo(playerId: string): SeatInfo | undefined {
    return this.seats.get(playerId);
  }

  // === Event Registration ===

  onHandComplete_cb(callback: (result: GameResult) => void): void {
    this.onHandCompleteCallbacks.push(callback);
  }

  onPhaseChange(callback: (phase: RoomPhase) => void): void {
    this.onPhaseChangeCallbacks.push(callback);
  }

  onPlayerDisconnect(callback: (playerId: string) => void): void {
    this.onPlayerDisconnectCallbacks.push(callback);
  }

  // === Rate Limiting ===

  private checkRateLimit(playerId: string): boolean {
    const now = Date.now();
    const timestamps = this.actionTimestamps.get(playerId) ?? [];
    // Remove timestamps older than 1 second
    const recent = timestamps.filter(t => now - t < 1000);
    if (recent.length >= this.actionRateLimit) {
      this.logger.warn(`Rate limit exceeded for ${playerId}: ${recent.length} actions in last 1s`);
      return false;
    }
    recent.push(now);
    this.actionTimestamps.set(playerId, recent);
    return true;
  }

  // === Helpers ===

  /** Skip the between-hands delay and proceed immediately */
  skipBetweenHandsDelay(): void {
    if (this.betweenHandsTimer) {
      clearTimeout(this.betweenHandsTimer);
      this.betweenHandsTimer = undefined;
    }
  }

  private setPhase(phase: RoomPhase): void {
    this.phase = phase;
    for (const cb of this.onPhaseChangeCallbacks) {
      cb(phase);
    }
  }

  private getActiveSeats(): SeatInfo[] {
    return [...this.seats.values()].filter(
      (s) => s.status !== 'left',
    );
  }

  private getPlayablePlayers(): PlayerInfo[] {
    return [...this.seats.values()]
      .filter((s) => s.status === 'seated' || s.status === 'playing')
      .map((s) => s.playerInfo);
  }

  private clearActionTimer(playerId: string): void {
    const timer = this.actionTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.actionTimers.delete(playerId);
    }
  }

  private clearAllTimers(): void {
    for (const timer of this.actionTimers.values()) {
      clearTimeout(timer);
    }
    this.actionTimers.clear();
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    if (this.betweenHandsTimer) {
      clearTimeout(this.betweenHandsTimer);
      this.betweenHandsTimer = undefined;
    }
  }
}

/** Safely reconstruct PlayerInfo from JSON-transported data */
function deserializePlayerInfo(raw: PlayerInfo): PlayerInfo {
  const signPubKey = reconstructUint8Array(raw.signPubKey, 'signPubKey');
  const encryptPubKey = reconstructUint8Array(raw.encryptPubKey, 'encryptPubKey');
  return { id: raw.id, signPubKey, encryptPubKey };
}

function reconstructUint8Array(value: unknown, fieldName: string): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) {
    if (!value.every(v => typeof v === 'number' && v >= 0 && v <= 255)) {
      throw new Error(`${fieldName} contains invalid byte values`);
    }
    return new Uint8Array(value);
  }
  if (typeof value === 'object' && value !== null) {
    const vals = Object.values(value as Record<string, unknown>);
    if (!vals.every(v => typeof v === 'number' && (v as number) >= 0 && (v as number) <= 255)) {
      throw new Error(`${fieldName} contains invalid byte values`);
    }
    return new Uint8Array(vals as number[]);
  }
  throw new Error(`${fieldName} must be Uint8Array, Array, or object of byte values`);
}
