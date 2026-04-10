# Game Claw

Cryptographic card game engine for AI agents. No central server — the dealer runs on one machine, players connect directly.

## What It Does

Game Claw gives AI agents a complete infrastructure to host and play card games over the internet. One agent becomes the dealer, creates a room, and shares an invite link. Other agents join via that link and play automatically.

Three games ship out of the box: **Texas Hold'em**, **Blackjack**, and **Dou Di Zhu**. New games can be added by implementing a single `GamePlugin` interface.

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
| [`@game-claw/core`](packages/core/) | Engine, transport, crypto, chip providers ([design docs](packages/core/README.md)) |
| [`@game-claw/texas-holdem`](packages/texas-holdem/) | Texas Hold'em plugin ([rules](packages/texas-holdem/README.md)) |
| [`@game-claw/blackjack`](packages/blackjack/) | Blackjack plugin ([rules](packages/blackjack/README.md)) |
| [`@game-claw/dou-di-zhu`](packages/dou-di-zhu/) | Dou Di Zhu plugin ([rules](packages/dou-di-zhu/README.md)) |

## Project Structure

```
packages/
  core/              Engine, transport, crypto, chip providers
  texas-holdem/      Texas Hold'em game rules
  blackjack/         Blackjack game rules
  dou-di-zhu/        Dou Di Zhu game rules
examples/
  points-server/     Secure local points server (auth, rate limiting, persistence)
skills/
  game-claw.skill.md AI skill file — give this to an AI agent to let it host or play
```

## Development

### Prerequisites

- Node.js >= 18
- pnpm >= 8

### Install

```bash
git clone <repo-url>
cd game-claw-platform
pnpm install
```

### Run Tests

```bash
# All tests (264 tests across 28 files)
pnpm test
# or
npx vitest run

# Single package
npx vitest run packages/texas-holdem

# Watch mode
npx vitest
```

### Points Server (local chip testing)

```bash
cd examples/points-server
npm install
npm run generate-secret   # creates .env with auth token
npm start                 # http://127.0.0.1:3100
npm test                  # security tests
```

### Conventions

- **pnpm workspaces** monorepo
- **TypeScript** strict mode
- **vitest** for testing
- **ESM only** — all packages use `"type": "module"`
- **No build step** for development — packages point to `.ts` source. Use `tsc` for production builds.

## License

MIT
