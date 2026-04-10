# @game-claw/core

Core engine for the Game Claw platform. Provides cryptographic card dealing, WebSocket networking, chip management, and the plugin interface that game implementations build on.

## Architecture

Four layers, each only talks to the one below:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  DealerNode │ ──► │  GameEngine  │ ──► │  GamePlugin  │
│ (room mgmt) │     │(cards/crypto)│     │ (game rules) │
└─────────────┘     └─────────────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│ ChipProvider│
│(debit/credit)│
└─────────────┘
```

| Layer | Responsibility |
|-------|---------------|
| **GamePlugin** | Pure game rules. Validates actions, advances state, determines winners. Knows nothing about networking or chips. |
| **GameEngine** | Shuffles the deck, encrypts cards per player (X25519), creates SHA-256 commitments, executes deal plans. Calls the plugin for game logic. |
| **DealerNode** | Room lifecycle, WebSocket connections, player join/leave/reconnect, action timeouts, chip debit/credit, state broadcasting. Only talks to GameEngine. |
| **PlayerNode** | Client SDK. Connects to dealer, decrypts dealt cards, sends actions, receives turn notifications, queries room/table state. |

## Cryptographic Card Protocol

### Dealing

```
1. GameEngine shuffles deck (Fisher-Yates with crypto random)
2. Plugin provides DealPlan: who gets how many cards, face-up or hidden
3. For each card dealt to a player:
   a. Generate random 32-byte salt
   b. Commitment = SHA-256(cardId || salt)
   c. Encrypt {cardId, salt} with recipient's X25519 public key (NaCl box)
   d. Sign the commitment with dealer's Ed25519 key
4. All commitments broadcast to all players (everyone sees the hash)
5. Encrypted card data sent only to the target player
6. At game end: all salts revealed, every player can verify every commitment
```

Properties:
- **Dealer cannot cheat** — cards are committed before dealing. Changing a card would break the hash.
- **Players cannot see each other's cards** — encryption is per-player.
- **Full verifiability** — at game end, all secrets are revealed and anyone can recompute every hash.

### Community / Burn / House Cards

| Target | Encryption | Visibility |
|--------|-----------|------------|
| Player | X25519 box to that player | Only the target player |
| Community (face-up) | None | Revealed immediately to all |
| Community (face-down) | None | Hash only; revealed later |
| Burn | None | Hash only; revealed at game end |
| House | None | Hash; face-up house cards revealed immediately |

## Handshake Protocol

4-step mutual authentication when a player connects:

```
Player → Dealer:  HELLO  { playerPubKey, npmVersion, timestamp, signature }
Dealer → Player:  CHALLENGE  { random 32 bytes, dealerPubKey, roomConfig, signature }
Player → Dealer:  RESPONSE  { sign(challenge, playerPrivKey) }
Dealer → Player:  ACCEPTED / REJECTED
```

| Attack | Prevention |
|--------|-----------|
| Impersonation | Both sides prove private key ownership via signatures |
| Replay | Timestamp window (15 seconds) + random challenge per connection |
| MITM | Both parties verify signatures against known public keys |
| Version mismatch | npmVersion checked in HELLO step |

Timeout: 10 seconds per handshake. Stale connections are rejected.

## Room State Machine

```
idle → waiting → playing → settling → between-hands ─┐
                    ▲                                  │
                    └──────────────────────────────────┘
```

- **idle** — room created, not yet listening
- **waiting** — accepting players; auto-starts when `minPlayers` reached
- **playing** — active hand in progress, action timers running
- **settling** — chip credits/debits processed after hand completes
- **between-hands** — configurable delay (default 10s) before next hand
- **closed** — room shut down

## Player State Machine

```
joined → seated → playing → seated (next hand)
                     │
                     ├→ sit-out → seated
                     ├→ disconnected → (reconnect within 60s) → playing/seated
                     │                 (timeout) → left
                     └→ left
```

- **disconnected**: WebSocket close detected, 60-second reconnect window
- **sit-out**: voluntary, skips next hand but keeps seat
- **left**: permanently removed, credit score penalized if during active play

## Chip Protocol (Method B: Real-Time)

Chips are deducted at bet time and credited at win time. No escrow, no hold/release.

```
Bet:   chipProvider.debit({ gameId, playerId, amount, reason: 'call' })
Win:   chipProvider.credit({ gameId, playerId, amount, reason: 'pot' })
Batch: chipProvider.batchSettle({ gameId, settlements: [...] })
```

### Providers

| Type | Config | Use Case |
|------|--------|----------|
| `local` | `{ type: 'local' }` | In-memory, testing only |
| `http` | `{ type: 'http', url, authToken }` | REST server (see `examples/points-server`) |
| `evm` | `{ type: 'evm', rpcUrl, chainId, contractAddress }` | Ethereum / Polygon / BSC |
| `solana` | `{ type: 'solana', rpcUrl, programId }` | Solana mainnet / devnet |

All chip operations in DealerNode are `await`ed. Failures are logged, not silently swallowed.

### Commission

The dealer earns a per-player fee each hand:
1. At hand start: `debit(commission)` from each player
2. At hand end: `credit(totalCommission)` to the dealer's account

Commission is not taken from the pot — it is a separate charge.

## Query Protocol

Players can request information from the dealer over the existing WebSocket connection:

```
Player → Dealer:  { type: 'query', payload: { queryType, nonce }, from: playerId }
Dealer → Player:  { type: 'query-result', payload: { queryType, nonce, ...data } }
```

| Query | Returns |
|-------|---------|
| `my-balance` | Player's chip balance |
| `room-state` | Room phase, hand count, all players with status and chip balance |
| `table-state` | Current game's public state (pot, bets, community cards, etc.) |
| `room-config` | Room settings (game type, buy-in, min/max bet, commission) |
| `my-status` | Player's seat status, chip balance, credit score |

Security:
- Connection identity verified (spoofed playerIds rejected)
- Private data never exposed (no deck, no other players' hands, no secret keys)
- Rate limited (same as action rate limit)
- 5-second timeout per query
- Nonce-based request/response matching

## Message Types

### Dealer → Player

| Type | When | Payload |
|------|------|---------|
| `join-response` | After join request | `{ accepted, reason?, roomConfig?, players? }` |
| `game-start` | Hand begins | `{ playerCommitments, publicCommitments, allCommitments, dealerEncryptPubKey }` |
| `your-turn` | Player's turn | `{ validActions (with cost/affordable), chipBalance, phase, warning? }` |
| `action-result` | After any valid action | `{ action, accepted, phase, currentPlayerIndex, publicState }` |
| `action-rejected` | Invalid action (to sender only) | `{ action, reason }` |
| `phase-deal` | New community cards dealt | `{ phase, commitments, communityCards }` |
| `new-card` | Extra card dealt to player | `{ commitment }` |
| `game-end` | Hand complete | `{ result: { winners, pointChanges, commission }, reveals }` |
| `timeout-action` | Player timed out | `{ action, reason }` |
| `kicked` | Balance too low | `{ reason }` |
| `query-result` | Query response | `{ queryType, nonce, ...data }` |
| `query-error` | Query failed | `{ error, nonce }` |

### Player → Dealer

| Type | When | Payload |
|------|------|---------|
| `join-request` | Connecting | `{ playerInfo, npmVersion }` |
| `action` | Player's turn | PlayerAction (`{ playerId, type, payload? }`) |
| `query` | Anytime | `{ queryType, nonce }` |

## PendingAction System

Plugins return `pendingActions` from `applyAction()`. The engine and dealer process them:

| PendingAction | Processed By |
|--------------|-------------|
| `deal-phase` | GameEngine — deals the next phase (flop/turn/river) |
| `deal-to-player` | GameEngine — deals N cards to a specific player |
| `debit` | DealerNode — calls chipProvider.debit() |
| `credit` | DealerNode — calls chipProvider.credit() |

This keeps game logic clean: the plugin says "debit 50 from this player" and the infrastructure handles it.

## GamePlugin Interface

```typescript
interface GamePlugin {
  meta: { name, displayName, minPlayers, maxPlayers, version };

  createGame(players, options?): GameState;       // initial state
  createDeck(): Card[];                           // full deck for this game
  getDealPlan(state): DealPlan[];                 // who gets cards and when
  validateAction(state, action): boolean;         // is this action legal?
  applyAction(state, action): ApplyActionResult;  // apply and return new state + pendingActions
  isGameOver(state): boolean;                     // is the hand complete?
  getResult(state): GameResult;                   // winners, point changes, commission
  getValidActions(state): PlayerAction[];          // what can the current player do?
  getPublicState(state): Record<string, unknown>; // broadcast after every action

  // Optional:
  getAutoAction?(state, playerId): PlayerAction;  // default action on timeout
  getStartActions?(state): PendingAction[];       // blinds, antes at hand start
  postDeal?(state): GameState;                    // post-deal logic (e.g., blackjack peek)
}
```

## Security Summary

| Layer | Mechanism |
|-------|-----------|
| Card fairness | SHA-256 commit-then-reveal + X25519 per-player encryption |
| Identity | Ed25519 key pairs, 4-step signed handshake |
| Anti-replay | 15-second timestamp window + random 32-byte challenge |
| Transport | WSS via Cloudflare Tunnel (TLS) |
| Chip server | Bearer token auth, input validation, rate limiting, append-only audit log |
| Actions | Per-player rate limiting (default 10/sec), disconnected player rejection |
| Queries | Connection-identity verification, no private data exposure |
| URL validation | Block private IPs, require TLS for non-local, reject credentials in URLs |
