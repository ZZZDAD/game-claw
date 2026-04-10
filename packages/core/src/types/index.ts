// === Identity ===
export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface Identity {
  signKeyPair: KeyPair;    // Ed25519
  encryptKeyPair: KeyPair; // X25519
}

export interface PlayerInfo {
  id: string; // hex-encoded sign public key
  signPubKey: Uint8Array;
  encryptPubKey: Uint8Array;
}

// === Cards ===
export interface Card {
  id: string;   // e.g. "hearts-A", "spades-10", "joker-big"
  suit: string;
  rank: string;
}

// === Crypto Protocol ===
export interface CardCommitment {
  cardIndex: number;
  commitment: string; // hex SHA-256
  encrypted: string;  // base64 nacl.box output
  nonce: string;      // base64 nonce
  targetPlayerId: string;
  signature: string;  // base64 Ed25519 sig
}

export interface CardReveal {
  cardIndex: number;
  cardId: string;
  salt: string; // hex
}

// === Transport ===
export interface GameEvent {
  type: string;
  payload: unknown;
  from: string;         // sender playerId
  signature?: string;   // Ed25519 sig by the sender — others can verify
}

export interface Connection {
  send(event: GameEvent): void;
  onMessage(handler: (event: GameEvent) => void): void;
  onClose(handler: () => void): void;   // triggered when connection drops
  close(): void;
  readonly isAlive: boolean;             // false after close/disconnect
  remoteId?: string;
}

export interface Transport {
  start(port: number): Promise<string>;
  connect(url: string): Promise<Connection>;
  stop(): Promise<void>;
  onConnection(handler: (conn: Connection) => void): void;
}

// === Room Config (defined by dealer at createRoom time) ===
export interface RoomConfig {
  gameType: string;
  chipProvider: ChipProviderConfig;
  chipUnit: string;          // display unit: 'ETH', 'USDT', 'points'
  minBet: number;
  maxBet: number;
  buyIn: number;
  commission: number;        // dealer commission: per-player fee per hand (e.g. 2)
  // Game-specific settings (e.g., blackjack: bankerIndex)
  settings?: Record<string, unknown>;
}

// === Game Plugin ===
export interface DealPlan {
  phase: string;
  deals: {
    target: string;   // playerId, "community", "burn", or "hold" (dealt but not revealed)
    count: number;
    faceUp: boolean;
  }[];
}

export interface PlayerAction {
  playerId: string;
  type: string;
  payload?: unknown;
  signature?: string; // player signs their own action for verification
}

export interface GameResult {
  winners: string[];
  pointChanges: Record<string, number>;
  commission: number;     // dealer commission
  finalState: GameState;
}

export interface GameState {
  phase: string;
  players: PlayerInfo[];
  hands: Record<string, Card[]>;
  communityCards: Card[];
  currentPlayerIndex: number;
  roundData: Record<string, unknown>;
  deck: Card[];
  dealtCardMap: Map<number, { cardId: string; salt: string; target: string }>;
  [key: string]: unknown;
}

export type PendingAction =
  | { type: 'deal-phase'; phase: string }
  | { type: 'deal-to-player'; playerId: string; count: number }
  | { type: 'debit'; playerId: string; amount: number; reason: string }
  | { type: 'credit'; playerId: string; amount: number; reason: string };

export interface ApplyActionResult {
  state: GameState;
  pendingActions: PendingAction[];
}

export interface GamePlugin {
  meta: {
    name: string;
    displayName: string;
    minPlayers: number;
    maxPlayers: number;
    version: string;
  };

  createGame(players: PlayerInfo[], options?: Record<string, unknown>): GameState;
  createDeck(): Card[];
  getDealPlan(state: GameState): DealPlan[];
  validateAction(state: GameState, action: PlayerAction): boolean;
  applyAction(state: GameState, action: PlayerAction): ApplyActionResult;
  isGameOver(state: GameState): boolean;
  getResult(state: GameState): GameResult;
  getValidActions(state: GameState): PlayerAction[];
  getAutoAction?(state: GameState, playerId: string): PlayerAction;
  getStartActions?(state: GameState): PendingAction[];
  // Called after initial deal — for games that need post-deal logic (e.g., blackjack peek rule)
  postDeal?(state: GameState): GameState;
  // Public state visible to all players — broadcast after every action
  getPublicState(state: GameState): Record<string, unknown>;
}

// === Chip Provider Config ===
export type ChipProviderConfig =
  | HttpChipProviderConfig
  | EvmChipProviderConfig
  | SolanaChipProviderConfig
  | LocalChipProviderConfig;

export interface HttpChipProviderConfig {
  type: 'http';
  url: string;
  authToken?: string;
}

export interface EvmChipProviderConfig {
  type: 'evm';
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
  tokenAddress?: string;
}

export interface SolanaChipProviderConfig {
  type: 'solana';
  rpcUrl: string;
  programId: string;
  tokenMint?: string;
  discriminators?: {
    debit: number[];
    credit: number[];
    batchSettle: number[];
  };
}

export interface LocalChipProviderConfig {
  type: 'local';
}

// === Chip Provider Interface ===
// Method B: Real-time debit/credit. Chips are deducted the moment you bet,
// and credited the moment you win. No hold/release needed.
export interface ChipProvider {
  // Query balance
  getBalance(playerId: string): Promise<BalanceResponse>;

  // Debit: deduct chips immediately (when placing a bet, posting blinds, etc.)
  // Returns false if insufficient balance.
  debit(request: DebitRequest): Promise<DebitResponse>;

  // Credit: add chips immediately (when winning a pot, receiving refund, etc.)
  credit(request: CreditRequest): Promise<CreditResponse>;

  // Batch settle: convenience for end-of-hand (multiple credits at once)
  // Used to distribute pot to winner(s) + commission to dealer
  batchSettle(request: BatchSettleRequest): Promise<BatchSettleResponse>;
}

export interface BalanceResponse {
  playerId: string;
  balance: number;
}

export interface DebitRequest {
  gameId: string;
  playerId: string;
  amount: number;     // positive number to deduct
  reason: string;     // 'blind:sb', 'blind:bb', 'bet', 'call', 'raise', 'commission'
}

export interface DebitResponse {
  success: boolean;
  reason?: string;    // 'insufficient_balance'
  balance: number;    // balance after debit
  txId: string;
}

export interface CreditRequest {
  gameId: string;
  playerId: string;
  amount: number;     // positive number to add
  reason: string;     // 'pot:main', 'pot:side', 'refund', 'commission'
}

export interface CreditResponse {
  success: boolean;
  balance: number;    // balance after credit
  txId: string;
}

export interface BatchSettleRequest {
  gameId: string;
  settlements: {
    playerId: string;
    amount: number;     // positive = credit, negative = debit
    reason: string;
  }[];
}

export interface BatchSettleResponse {
  success: boolean;
  txId: string;
  balances: Record<string, number>;
}

// === Room State Machine ===
export type RoomPhase = 'idle' | 'waiting' | 'playing' | 'settling' | 'between-hands' | 'closed';

// === Player State Machine ===
export type PlayerStatus = 'joined' | 'seated' | 'playing' | 'sit-out' | 'disconnected' | 'left';

export interface SeatInfo {
  playerId: string;
  playerInfo: PlayerInfo;
  status: PlayerStatus;
  chipBalance: number;      // current chips at table
  disconnectedAt?: number;  // timestamp when disconnected
  creditScore: number;      // trust/reliability score
}

export interface RoomState {
  phase: RoomPhase;
  seats: Map<string, SeatInfo>;
  handCount: number;         // number of hands played
  currentHandId?: string;
}

// === Version ===
export interface JoinRequest {
  playerInfo: PlayerInfo;
  npmVersion: string;
}

export interface JoinResponse {
  accepted: boolean;
  reason?: string;
  roomConfig?: RoomConfig;   // player sees room config on join
  players?: PlayerInfo[];
}
