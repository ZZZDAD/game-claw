# Game Claw Platform - Decentralized Poker Game Platform Design

## Overview

A fully decentralized card game platform built for OpenCloud. No central server — all game logic runs on players' own machines. The platform provides cryptographic infrastructure for fair card dealing, and game developers build specific card games (Texas Hold'em, Blackjack, Dou Di Zhu) as plugins on top.

The project is an open-source monorepo published to NPM. Developers contribute games via PR, users `npm update` to get the latest game list.

## Core Principles

1. **No central server**: All game sessions run on participant nodes
2. **Cryptographic fairness**: Cards cannot be tampered with, verified by all players
3. **Open plugin system**: Any developer can build a card game using the core engine
4. **Version consistency**: All players in a session must run the same NPM version

---

## 1. Identity System

### Key Generation
- **Ed25519** keypair for digital signatures (identity, game events)
- **X25519** keypair for encryption (receiving encrypted cards)
- Both derived from the same seed for simplicity
- Private keys stored locally at `~/.game-claw/keystore.json`, encrypted with user-provided password via AES-256-GCM (password → key via scrypt)

### Identity
- Public key = player identity (no email, no KYC)
- Players share only their public key when joining games

---

## 2. Cryptographic Card Dealing Protocol

### Game Session Setup
1. Dealer generates a **game keypair** (Ed25519) — used to sign all game events
2. Game public key shared with all players as session identifier

### Dealing Hidden Cards (e.g., hole cards in poker)
1. Dealer generates random `salt` (32 bytes) per card
2. Dealer publishes **commitment**: `commitment = SHA-256(cardId || salt)`
3. Dealer encrypts card for target player: `encrypted = X25519_encrypt(playerPubKey, {cardId, salt})`
4. Dealer signs the deal event: `sig = Ed25519_sign(gamePrivKey, {commitment, encrypted, targetPlayer})`
5. Broadcast `{commitment, encrypted, sig, targetPlayer}` to all players
   - All players see the commitment (can verify later)
   - Only the target player can decrypt to see cardId + salt

### Dealing Public Cards (e.g., community cards, face-up cards)
1. Dealer generates `salt` per card
2. Dealer broadcasts `{cardId, salt}` in plaintext, signed by game key
3. All players compute commitment for verification record

### Revealing Cards (playing a card / showdown)
1. Player publishes `{cardId, salt}`
2. All players verify: `SHA-256(cardId || salt) === commitment` from dealing phase
3. Match confirmed → card is authentic

### End-of-Game Verification
1. Dealer publishes all remaining salts for all dealt cards
2. All players verify every card's commitment matches
3. Any mismatch → dealer flagged as cheating, reputation penalty

### Anti-Cheat Summary

| Attack | Defense |
|--------|---------|
| Dealer peeks at player hands | Dealer only generates encrypted data; doesn't see player decisions |
| Dealer swaps cards | Commitment hash already broadcast; swap causes hash mismatch |
| Player swaps cards | Player doesn't know salt; can't forge matching commitment |
| Dealer-player collusion | End-of-game full verification detects anomalies |

---

## 3. Communication Layer

### Transport Interface (Pluggable)

```typescript
interface Transport {
  start(port: number): Promise<string>  // Returns accessible URL
  connect(url: string): Promise<Connection>
  stop(): Promise<void>
}

interface Connection {
  send(event: GameEvent): void
  onMessage(handler: (event: GameEvent) => void): void
  close(): void
}
```

### Implementations
- **LocalTransport**: Direct localhost with different ports. For testing.
- **CloudflareTransport**: Auto-launches `cloudflared tunnel` for NAT traversal. Free, no registration needed (Quick Tunnel mode). Auto HTTPS.

### Topology: Star (Dealer-Centric)
- Dealer is the hub; all players connect to dealer
- Players do NOT connect to each other directly
- Dealer broadcasts public events, routes private events
- Natural fit: dealer already manages game state

### Join Protocol (Version Check)
1. Dealer creates room → broadcasts `{roomId, gameType, npmVersion, dealerTunnelUrl}`
2. Player requests join → sends `{playerPubKey, npmVersion}`
3. Dealer verifies `player.npmVersion === dealer.npmVersion`
   - Match → accept, add to game
   - Mismatch → reject with required version info

### Room Discovery
- **Invite mode**: Dealer generates room URL, shares directly with players
- **Public mode**: Dealer registers room in a lobby (lightweight broadcast)
- Both modes supported; dealer chooses per session

---

## 4. Points / Ledger System

### Settlement Protocol
1. Game ends → dealer computes `settlement = {winners, losers, pointChanges, gameLog}`
2. Dealer signs: `dealerSig = sign(gamePrivKey, settlement)`
3. Broadcast settlement to all players
4. Each player verifies result correctness, then signs: `playerSig = sign(playerPrivKey, settlement)`
5. Collect all signatures → `SignedSettlement`
6. Each player appends to local ledger: `~/.game-claw/ledger.json`

### Dealer Incentive
- Successful game completion → dealer earns fixed point reward
- Caught cheating (verification failure) → large point deduction
- Ledger records are cross-verifiable between any two players

### Ledger Structure
```json
{
  "entries": [
    {
      "gameId": "...",
      "timestamp": "...",
      "gameType": "texas-holdem",
      "players": ["pubkey1", "pubkey2"],
      "dealer": "pubkey3",
      "pointChanges": {"pubkey1": +50, "pubkey2": -30, "pubkey3": +5},
      "signatures": {"pubkey1": "sig1", "pubkey2": "sig2", "pubkey3": "sig3"}
    }
  ]
}
```

---

## 5. Game Plugin Interface

```typescript
interface GamePlugin {
  meta: {
    name: string          // "texas-holdem"
    displayName: string   // "Texas Hold'em"
    minPlayers: number
    maxPlayers: number
    version: string       // from package.json
  }

  createGame(players: PlayerInfo[]): GameState
  createDeck(): Card[]
  getDealPlan(state: GameState): DealPlan[]
  validateAction(state: GameState, action: PlayerAction): boolean
  applyAction(state: GameState, action: PlayerAction): GameState
  isGameOver(state: GameState): boolean
  getResult(state: GameState): GameResult
}

interface Card {
  id: string      // unique identifier, e.g. "hearts-A", "spades-10"
  suit: string
  rank: string
}

interface DealPlan {
  phase: string
  deals: {
    target: string       // playerId or "community"
    count: number
    faceUp: boolean
  }[]
}

interface PlayerAction {
  playerId: string
  type: string           // game-specific: "bet", "fold", "hit", "stand", "play-cards"
  payload?: unknown      // game-specific data
}

interface GameResult {
  winners: string[]
  pointChanges: Record<string, number>
  finalState: GameState
}
```

### Engine Flow (Core Platform Handles This)
```
1. Plugin.createGame(players) → initial state
2. Plugin.createDeck() → deck
3. Loop:
   a. Plugin.getDealPlan(state) → deal instructions
   b. Engine encrypts & deals cards per plan
   c. Wait for player action
   d. Plugin.validateAction(state, action) → legal?
   e. Plugin.applyAction(state, action) → new state
   f. Plugin.isGameOver(state) → continue or end
4. Plugin.getResult(state) → settlement
5. Engine runs settlement protocol
```

---

## 6. Project Structure

```
game-claw-platform/
├── packages/
│   ├── core/                        # @game-claw/core
│   │   ├── src/
│   │   │   ├── crypto/
│   │   │   │   ├── keys.ts          # Key generation, storage, loading
│   │   │   │   ├── encrypt.ts       # X25519 encrypt/decrypt
│   │   │   │   ├── sign.ts          # Ed25519 sign/verify
│   │   │   │   └── commitment.ts    # Hash commitment scheme
│   │   │   ├── transport/
│   │   │   │   ├── types.ts         # Transport, Connection interfaces
│   │   │   │   ├── local.ts         # LocalTransport (testing)
│   │   │   │   └── cloudflare.ts    # CloudflareTransport (production)
│   │   │   ├── engine/
│   │   │   │   ├── game-engine.ts   # Game lifecycle, orchestrates plugin
│   │   │   │   ├── dealer.ts        # Dealer role logic
│   │   │   │   └── player.ts        # Player role logic
│   │   │   ├── ledger/
│   │   │   │   └── ledger.ts        # Points ledger management
│   │   │   ├── cli/
│   │   │   │   └── index.ts         # CLI entry point
│   │   │   └── types/
│   │   │       └── index.ts         # Shared type definitions
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── texas-holdem/                # @game-claw/texas-holdem
│   │   ├── src/
│   │   │   ├── plugin.ts            # GamePlugin implementation
│   │   │   ├── rules.ts             # Betting rounds, phases
│   │   │   └── hand-eval.ts         # Poker hand evaluation
│   │   ├── __tests__/
│   │   │   └── simulation.test.ts   # Multi-bot simulation test
│   │   └── package.json
│   ├── blackjack/                   # @game-claw/blackjack
│   │   ├── src/
│   │   │   ├── plugin.ts
│   │   │   └── rules.ts
│   │   ├── __tests__/
│   │   │   └── simulation.test.ts
│   │   └── package.json
│   └── dou-di-zhu/                  # @game-claw/dou-di-zhu
│       ├── src/
│       │   ├── plugin.ts
│       │   ├── rules.ts
│       │   └── card-patterns.ts     # Pattern recognition (bombs, straights, etc.)
│       ├── __tests__/
│       │   └── simulation.test.ts
│       └── package.json
├── package.json                     # pnpm workspace root
├── tsconfig.base.json
└── pnpm-workspace.yaml
```

---

## 7. CLI Commands

```bash
# Identity
game-claw identity create              # Generate keypair
game-claw identity show                # Show public key

# Dealer mode
game-claw deal <game-type>             # Create a game session
game-claw deal --invite                # Invite-only room
game-claw deal --public                # Public room

# Player mode
game-claw join <room-url>              # Join via invite link
game-claw list                         # Browse public rooms
game-claw play <action> [payload]      # In-game action

# Ledger
game-claw ledger show                  # View point history
game-claw ledger verify <pubkey>       # Cross-verify with another player
```

---

## 8. Game Implementations

### 8.1 Texas Hold'em
- 2-10 players
- Standard 52-card deck
- Phases: preflop (2 hole cards each), flop (3 community), turn (1), river (1)
- Actions: fold, check, call, raise, all-in
- Hand evaluation: royal flush → high card ranking

### 8.2 Blackjack (21 Points)
- 1-7 players vs dealer (dealer is also the game dealer in this case)
- Standard 52-card deck
- Each player gets 2 cards, dealer gets 1 face-up + 1 face-down
- Actions: hit, stand, double-down, split
- Goal: closest to 21 without going over

### 8.3 Dou Di Zhu (Fight the Landlord)
- Exactly 3 players
- 54-card deck (52 + 2 jokers)
- Bidding phase to determine landlord (gets 3 extra cards)
- Actions: play-cards (must beat previous play or pass)
- Card patterns: single, pair, triple, bomb, straight, airplane, etc.
- Landlord wins if plays all cards first; farmers win if either finishes first

---

## 9. Testing Strategy

Each game includes a multi-bot simulation test that:
1. Creates dealer + N bot players (each with own keypair)
2. Uses LocalTransport (localhost, different ports)
3. Bots make random legal moves
4. Runs multiple full games
5. Verifies:
   - All card commitments match at game end
   - Settlement signatures are valid
   - Point ledger is consistent across all participants
   - No invalid game states reached
   - Version check works correctly
