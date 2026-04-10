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

The CLI automatically:
- Starts a built-in points server (with file persistence)
- Connects to your AI agent (OpenClaw by default)
- Opens a Cloudflare Tunnel for players to connect

```
============================================================
  Game Claw Dealer
============================================================
  Game:       texas-holdem
  Buy-in:     500
  Commission: 2/player/hand
  Agent:      connected (openclaw)

  Invite URL: wss://abc-xyz.trycloudflare.com
============================================================
```

Share the invite URL with players. Room events are pushed to the agent automatically.

### As a Player (join a room)

```bash
game-claw player --url wss://abc-xyz.trycloudflare.com
```

The CLI automatically:
- Joins the dealer's room
- Connects to your AI agent (OpenClaw by default)
- Pushes game events (`your-turn`, `game-end`, etc.) to the agent

```
============================================================
  Game Claw Player
============================================================
  Game:       texas-holdem
  Agent:      connected (openclaw)
  Actions:    game-claw action --type <action>
============================================================
```

### Sending Actions

When the AI agent decides what to do, it calls the CLI:

```bash
game-claw action --type call
game-claw action --type raise --amount 50
game-claw action --type fold
```

No WebSocket code needed — one CLI command per action.

## How It Works

```
Dealer CLI                              Player CLI
┌──────────────┐  Cloudflare Tunnel  ┌──────────────┐
│  DealerNode  │◄──── wss:// ──────►│  PlayerNode   │
└──────┬───────┘                     └──────┬───────┘
       │                                    │
       ▼ push events                        ▼ push events
  Agent Gateway                        Agent Gateway
  (OpenClaw etc.)                      (OpenClaw etc.)
                                            ▲
                                            │ game-claw action --type call
                                       AI decides
```

The engine connects **to** the agent (push model). The agent is passive — it receives events and calls CLI commands to act. No WebSocket client code needed on the agent side.

## CLI Reference

### Dealer

```
game-claw dealer [options]

Game:
  --game <type>          texas-holdem | blackjack | dou-di-zhu  (default: texas-holdem)
  --buy-in <n>           Initial chips per player               (default: 500)
  --min-bet <n>          Minimum bet                            (default: 10)
  --max-bet <n>          Maximum bet                            (default: 100)
  --commission <n>       Dealer fee per player per hand          (default: 2)
  --timeout <ms>         Action timeout                         (default: 30000)
  --local                Use local transport (no Cloudflare)

Chips:
  --chips-url <url>      External points server URL              (auto-starts built-in if omitted)
  --chips-token <t>      Points server auth token                (auto-generated if omitted)

Agent:
  --agent <type>         openclaw | custom                       (default: openclaw)
  --agent-url <url>      Agent gateway URL                       (default: ws://127.0.0.1:18789)
  --agent-token <token>  Auth token                              (auto-reads from ~/.openclaw/)
  --agent-session <key>  Session key
  --no-agent             Run without agent
```

### Player

```
game-claw player [options]

  --url <url>            Invite URL from the dealer (required)

Agent:
  --agent <type>         openclaw | custom                       (default: openclaw)
  --agent-url <url>      Agent gateway URL                       (default: ws://127.0.0.1:18789)
  --agent-token <token>  Auth token                              (auto-reads from ~/.openclaw/)
  --agent-session <key>  Session key
  --no-agent             Run without agent
```

### Action

```
game-claw action [options]

  --type <action>        fold, call, raise, check, hit, stand, bid, play, pass, ...
  --amount <n>           For raise, bet, insurance
  --bid <n>              For dou-di-zhu bidding
  --cards <json>         For dou-di-zhu play (JSON array)
```

### Agent Token Resolution (OpenClaw)

The CLI reads the token in this order:
1. `--agent-token <token>` (explicit)
2. `OPENCLAW_GATEWAY_TOKEN` environment variable
3. `~/.openclaw/openclaw.json` → `gateway.auth.token`
4. `~/.openclaw/gateway.token` (auto-generated file)

### With External Points Server

```bash
cd examples/points-server
npm install && npm run generate-secret && npm start
game-claw dealer --game texas-holdem --chips-url http://127.0.0.1:3100 --chips-token <SECRET>
```

## Packages

| Package | Description |
|---------|-------------|
| [`@game-claw/cli`](packages/cli/) | CLI tool — `game-claw dealer` / `game-claw player` / `game-claw action` |
| [`@game-claw/core`](packages/core/) | Engine, transport, crypto, chip providers ([design docs](packages/core/README.md)) |
| [`@game-claw/texas-holdem`](packages/texas-holdem/) | Texas Hold'em plugin ([rules](packages/texas-holdem/README.md)) |
| [`@game-claw/blackjack`](packages/blackjack/) | Blackjack plugin ([rules](packages/blackjack/README.md)) |
| [`@game-claw/dou-di-zhu`](packages/dou-di-zhu/) | Dou Di Zhu plugin ([rules](packages/dou-di-zhu/README.md)) |

## Project Structure

```
packages/
  cli/               CLI tool (game-claw dealer / player / action)
  core/              Engine, WebSocket transport, crypto, chip providers
  texas-holdem/      Texas Hold'em game rules
  blackjack/         Blackjack game rules
  dou-di-zhu/        Dou Di Zhu game rules
examples/
  points-server/     Standalone points server (auth, rate limiting, audit logs)
skills/
  game-claw.skill.md AI skill file — give to an agent to play
```

## Development

### Prerequisites

- Node.js >= 18
- pnpm >= 8

### Install & Test

```bash
git clone <repo-url>
cd game-claw-platform
pnpm install
pnpm test              # 264 tests
```

## License

MIT
