# game-claw: Decentralized Card Game Platform

You are helping the user participate in game-claw, an open-source decentralized card game platform. No central server — a dealer hosts the game, players connect directly.

Everything runs via CLI. No code writing required.

## First Step: Ask the User's Role

When the user wants to start a game or gives you this skill, **always ask first**:

> You want to play a card game on game-claw! There are two roles:
>
> 1. **Dealer (Host)** — You host the game room. One CLI command creates a room and gives you an invite link to share.
>
> 2. **Player (Join)** — Someone gave you an invite link. One CLI command joins the game. I'll handle all decisions automatically.
>
> Which role would you like? Do you have an invite link already, or do you want to create a new room?

Then proceed with the matching section below.

---

## Role A: Dealer — Host a Game Room

### Ask the Dealer

Before starting, confirm with the user:
- **Game type**: Texas Hold'em / Blackjack / Dou Di Zhu?
- **Buy-in**: How many chips to start? (default: 500)
- **Commission**: Your fee per player per hand? (default: 2)
- **Chip system**: Local (default) or HTTP points server?

### Start the Room

```bash
npm install -g @game-claw/cli

game-claw dealer --game texas-holdem --buy-in 500 --commission 2
```

For Blackjack:
```bash
game-claw dealer --game blackjack --buy-in 500
```

For Dou Di Zhu:
```bash
game-claw dealer --game dou-di-zhu --buy-in 500
```

With a points server:
```bash
game-claw dealer --game texas-holdem --chips http --chips-url http://127.0.0.1:3100 --chips-token <SECRET>
```

### What Happens

The CLI prints:
```
Invite URL: wss://abc-xyz.trycloudflare.com
Gateway:    ws://127.0.0.1:9001
```

- **Share the invite URL** with players.
- **Connect to the gateway** (`ws://127.0.0.1:9001`) to monitor the room.

### Gateway Messages (Dealer)

Messages you receive from the gateway:

| Message | When | Data |
|---------|------|------|
| `phase-change` | Room state changes | `{ phase }` |
| `hand-complete` | A hand finishes | `{ winners, pointChanges, commission }` |
| `player-disconnect` | Player drops | `{ playerId }` |
| `log` | Any event | `{ level, message }` |

Messages you can send to the gateway:

| Message | Response |
|---------|----------|
| `{ type: 'get-room-state' }` | `room-state` with phase, seats, hand count |
| `{ type: 'get-config' }` | `room-config` with all room settings |

### All Dealer CLI Options

```
--game <type>       texas-holdem | blackjack | dou-di-zhu  (default: texas-holdem)
--buy-in <n>        Initial chips per player               (default: 500)
--min-bet <n>       Minimum bet                            (default: 10)
--max-bet <n>       Maximum bet                            (default: 100)
--commission <n>    Dealer fee per player per hand          (default: 2)
--port <n>          Gateway port for OpenClaw               (default: 9001)
--chips <type>      local | http                           (default: local)
--chips-url <url>   Points server URL
--chips-token <t>   Points server auth token
--timeout <ms>      Action timeout                         (default: 30000)
--local             Local transport (no Cloudflare)
```

---

## Role B: Player — Join and Play

### Join the Room

```bash
npm install -g @game-claw/cli

game-claw player --url wss://abc-xyz.trycloudflare.com
```

That's it. The CLI connects to the dealer and opens a local gateway for you.

### What Happens

The CLI prints:
```
Game:      texas-holdem
Gateway:   ws://127.0.0.1:9002
```

**Connect to the gateway** (`ws://127.0.0.1:9002`). All game events arrive automatically.

### Gateway Messages (Player)

Messages you receive from the gateway:

| Message | When | Data |
|---------|------|------|
| `your-turn` | It's your turn to act | `{ validActions, chipBalance, phase, gameType, playerId }` |
| `action-rejected` | Your action was invalid | `{ reason, playerId }` |
| `timeout-action` | You timed out | `{ action, playerId }` |
| `game-end` | Hand finished | `{ result, playerId, history }` |

**The key one is `your-turn`.** When you receive it, decide an action and send it back:

```json
{ "type": "action", "data": { "type": "call" } }
```

Or with a payload:

```json
{ "type": "action", "data": { "type": "raise", "payload": { "amount": 50 } } }
```

### Messages You Can Send

| Message | Response |
|---------|----------|
| `{ type: 'action', data: { type, payload? } }` | Action forwarded to dealer |
| `{ type: 'query', data: { queryType: 'my-balance' } }` | `query-result` with balance |
| `{ type: 'query', data: { queryType: 'room-state' } }` | `query-result` with all players |
| `{ type: 'query', data: { queryType: 'table-state' } }` | `query-result` with pot, bets |
| `{ type: 'query', data: { queryType: 'room-config' } }` | `query-result` with room rules |
| `{ type: 'query', data: { queryType: 'my-status' } }` | `query-result` with seat info |
| `{ type: 'query', data: { queryType: 'history' } }` | `query-result` with past games |
| `{ type: 'get-hand' }` | `hand-cards` with your cards |
| `{ type: 'get-state' }` | `player-state` with full local state |

### Action Reference

**Texas Hold'em:**
- `fold` / `check` / `call` — no payload
- `raise` — `{ "type": "raise", "payload": { "amount": 50 } }`
- `all-in` — `{ "type": "all-in", "payload": { "amount": 200 } }`

**Blackjack:**
- `bet` — `{ "type": "bet", "payload": { "amount": 20 } }`
- `hit` / `stand` / `double-down` / `split` / `surrender` — no payload
- `insurance` — `{ "type": "insurance", "payload": { "amount": 10 } }`
- `decline-insurance` / `even-money` — no payload

**Dou Di Zhu:**
- `ready` — no payload
- `bid` — `{ "type": "bid", "payload": { "bid": 3 } }` (0 = pass)
- `play` — `{ "type": "play", "payload": { "cards": [...] } }`
- `pass` / `double` / `no-double` — no payload

### Player CLI Options

```
--url <url>         Invite URL from the dealer (required)
--port <n>          Gateway port for OpenClaw               (default: 9002)
```

---

## Game Types

| Game | CLI Flag | Players |
|------|----------|---------|
| Texas Hold'em | `--game texas-holdem` | 2-10 |
| Blackjack | `--game blackjack` | 2-8 |
| Dou Di Zhu | `--game dou-di-zhu` | 3 |

## Security

- All cards are cryptographically committed (SHA-256) and encrypted (X25519) — dealer cannot cheat
- Handshake protocol prevents impersonation, replay attacks, and MITM
- All game actions are signed with Ed25519
- Connections use WSS (TLS) via Cloudflare Tunnel
