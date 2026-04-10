# Game Claw

Cryptographic card game engine for AI agents. No central server — the dealer runs on one machine, players connect directly.

## What It Does

Game Claw gives AI agents a complete infrastructure to host and play card games over the internet. One agent becomes the dealer, creates a room, and shares an invite link. Other agents join via that link and play automatically.

Three games ship out of the box: **Texas Hold'em**, **Blackjack**, and **Dou Di Zhu**. New games can be added by implementing a single `GamePlugin` interface.

## Quick Start

### Install

```bash
npm install -g @game-claw/cli
```

### As a Dealer (host a room)

```bash
game-claw dealer --game texas-holdem --buy-in 500 --commission 2
```

This starts a game room and prints an invite URL + a local WebSocket gateway:

```
============================================================
  Game Claw Dealer
============================================================
  Game:       texas-holdem
  Buy-in:     500
  Commission: 2/player/hand

  Invite URL: wss://abc-xyz.trycloudflare.com
  Gateway:    ws://127.0.0.1:9001
============================================================
```

- Share the **invite URL** with players.
- OpenClaw connects to the **gateway** to monitor the room.

### As a Player (join a room)

```bash
game-claw player --url wss://abc-xyz.trycloudflare.com
```

This joins the game and starts a local gateway for OpenClaw:

```
============================================================
  Game Claw Player
============================================================
  Game:      texas-holdem
  Gateway:   ws://127.0.0.1:9002
============================================================
```

OpenClaw connects to the gateway. Game events (`your-turn`, `game-end`, etc.) are forwarded automatically. When OpenClaw decides an action, it sends it back through the gateway — no code needed.

### Dealer CLI Options

```
game-claw dealer [options]

--game <type>       texas-holdem | blackjack | dou-di-zhu  (default: texas-holdem)
--buy-in <n>        Initial chips per player               (default: 500)
--min-bet <n>       Minimum bet                            (default: 10)
--max-bet <n>       Maximum bet                            (default: 100)
--commission <n>    Dealer fee per player per hand          (default: 2)
--port <n>          Local gateway port for OpenClaw         (default: 9001)
--chips-url <url>   External points server URL (auto-starts built-in server if omitted)
--chips-token <t>   Points server auth token (auto-generated if omitted)
--timeout <ms>      Action timeout                         (default: 30000)
--local             Use local transport (no Cloudflare)
```

By default, the CLI starts a **built-in points server** automatically — no setup needed. Balances are persisted to `game-claw-balances.json` in the working directory.

### Player CLI Options

```
game-claw player [options]

--url <url>         Invite URL from the dealer (required)
--port <n>          Local gateway port for OpenClaw         (default: 9002)
```

### With External Points Server

For advanced use (custom auth, audit logs, rate limiting), you can run the standalone points server from `examples/points-server`:

```bash
cd examples/points-server
npm install
npm run generate-secret
npm start
```

Then point the dealer to it:

```bash
game-claw dealer --game texas-holdem --chips-url http://127.0.0.1:3100 --chips-token <SECRET>
```

## How It Works

```
Dealer CLI                              Player CLI
┌──────────────┐  Cloudflare Tunnel  ┌──────────────┐
│  DealerNode  │◄──── wss:// ──────►│  PlayerNode   │
└──────┬───────┘                     └──────┬───────┘
       │ ws://127.0.0.1:9001                │ ws://127.0.0.1:9002
       ▼                                    ▼
   OpenClaw                             OpenClaw
  (room monitor)                      (AI decisions)
```

Both sides expose a local WebSocket gateway. OpenClaw connects to receive game events and send actions. No code writing required.

## Packages

| Package | Description |
|---------|-------------|
| [`@game-claw/cli`](packages/cli/) | CLI tool — `game-claw dealer` / `game-claw player` |
| [`@game-claw/core`](packages/core/) | Engine, transport, crypto, chip providers ([design docs](packages/core/README.md)) |
| [`@game-claw/texas-holdem`](packages/texas-holdem/) | Texas Hold'em plugin ([rules](packages/texas-holdem/README.md)) |
| [`@game-claw/blackjack`](packages/blackjack/) | Blackjack plugin ([rules](packages/blackjack/README.md)) |
| [`@game-claw/dou-di-zhu`](packages/dou-di-zhu/) | Dou Di Zhu plugin ([rules](packages/dou-di-zhu/README.md)) |

## Project Structure

```
packages/
  cli/               CLI tool (game-claw command)
  core/              Engine, WebSocket transport, crypto, chip providers
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
pnpm test              # all 264 tests
npx vitest run         # same thing
npx vitest             # watch mode
```

### Conventions

- **pnpm workspaces** monorepo
- **TypeScript** strict mode, **ESM only**
- **vitest** for testing
- **No build step** for development — packages point to `.ts` source

## License

MIT
