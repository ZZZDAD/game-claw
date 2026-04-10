# Game Claw

Cryptographic card game engine for AI agents. No central server — the dealer runs on one machine, players connect directly.

## What It Does

Game Claw gives AI agents (like OpenClaw) a complete infrastructure to host and play card games over the internet. One agent becomes the dealer, creates a room, and shares an invite link. Other agents join via that link and play automatically. Humans never need to touch anything during gameplay.

**Three games ship out of the box:**

- **Texas Hold'em** — 2-10 players, community cards, blinds, side pots
- **Blackjack** — 2-8 players, real-player banker, split/double/insurance
- **Dou Di Zhu** — 3 players, landlord bidding, bombs, spring multipliers

## How It Works

```
Dealer                          Players
┌──────────────┐    Cloudflare Tunnel    ┌─────────────┐
│  DealerNode  │◄────── wss:// ────────►│  PlayerNode  │
│  + GameEngine│    (NAT traversal)      │  (AI agent)  │
│  + ChipProv  │                         └─────────────┘
└──────────────┘                         ┌─────────────┐
                                    ────►│  PlayerNode  │
                                         └─────────────┘
```

- **Cryptographic fairness** — Cards committed with SHA-256 before dealing, encrypted with X25519 per player. Dealer cannot see your cards or change them after the fact.
- **Ed25519 signatures** — Every action is signed. Impersonation and tampering are impossible.
- **Pluggable chips** — Local testing, HTTP points server, or on-chain (EVM / Solana).
- **Zero config networking** — Cloudflare Quick Tunnel for NAT traversal. No port forwarding, no accounts.

## Quick Start

### As a Dealer (host a room)

```bash
npm install @game-claw/core @game-claw/texas-holdem
```

```typescript
import { DealerNode, generateIdentity, CloudflareTransport } from '@game-claw/core';
import { TexasHoldemPlugin } from '@game-claw/texas-holdem';

const dealer = new DealerNode(
  new TexasHoldemPlugin(),
  generateIdentity(),
  '0.1.0',
  { gameType: 'texas-holdem', chipProvider: { type: 'local' },
    chipUnit: 'pts', minBet: 10, maxBet: 100, buyIn: 500, commission: 2 },
  new CloudflareTransport(),
);
const url = await dealer.createRoom();
console.log('Share this link:', url);
```

### As a Player (join a room)

```bash
npm install @game-claw/core
```

```typescript
import { PlayerNode, generateIdentity } from '@game-claw/core';

const player = new PlayerNode(generateIdentity(), '0.1.0');
await player.join('wss://abc-xyz.trycloudflare.com');

player.onMyTurn(async (turn) => {
  const action = turn.validActions.find(a => a.type === 'call' && a.affordable)
    ?? turn.validActions.find(a => a.type === 'check')
    ?? turn.validActions[0];
  await player.sendAction(action);
});
```

## Packages

| Package | Description |
|---------|-------------|
| `@game-claw/core` | Engine, transport, crypto, chip providers |
| `@game-claw/texas-holdem` | Texas Hold'em plugin |
| `@game-claw/blackjack` | Blackjack plugin |
| `@game-claw/dou-di-zhu` | Dou Di Zhu plugin |

## Project Structure

```
packages/
  core/            Engine, WebSocket transport, crypto, chip providers
  texas-holdem/    Texas Hold'em game rules
  blackjack/       Blackjack game rules
  dou-di-zhu/      Dou Di Zhu game rules
examples/
  points-server/   Secure local points server with auth, rate limiting, persistence
skills/
  game-claw.skill.md   AI skill file — give this to an AI agent to let it play
```

## Architecture

**Layered design — dealer never touches game rules directly:**

```
DealerNode  →  GameEngine  →  GamePlugin
(room mgmt)    (cards/crypto)  (game rules)
```

- **GamePlugin** — Implements one game's rules (validate, apply, result). Stateless.
- **GameEngine** — Shuffles, encrypts, deals cards. Manages commitments and reveals.
- **DealerNode** — Room lifecycle, player connections, chip operations, timeouts.
- **PlayerNode** — Client SDK. Decrypts cards, sends actions, queries dealer.

## Security

| Layer | Mechanism |
|-------|-----------|
| Card fairness | SHA-256 commit-then-reveal + X25519 encryption per player |
| Identity | Ed25519 key pairs, signed handshake |
| Anti-replay | Timestamp window (15s) + random challenge |
| Transport | WSS via Cloudflare Tunnel (TLS) |
| Chips (HTTP) | Bearer token auth, input validation, rate limiting, audit log |
| Actions | Per-player rate limiting, disconnected player rejection |

## Building a New Game

Implement the `GamePlugin` interface:

```typescript
interface GamePlugin {
  meta: { name, displayName, minPlayers, maxPlayers, version };
  createGame(players, options?): GameState;
  createDeck(): Card[];
  getDealPlan(state): DealPlan[];
  validateAction(state, action): boolean;
  applyAction(state, action): { state, pendingActions };
  isGameOver(state): boolean;
  getResult(state): { winners, pointChanges, commission };
  getValidActions(state): PlayerAction[];
  getPublicState(state): Record<string, unknown>;
}
```

The engine handles everything else — shuffling, encryption, networking, chips.

## License

MIT
