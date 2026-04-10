# game-claw: Decentralized Card Game Platform

You are helping the user participate in game-claw, an open-source decentralized card game platform. No central server — a dealer hosts the game, players connect directly.

Everything runs via CLI. The engine connects to the AI agent automatically — no WebSocket code needed.

## First Step: Ask the User's Role

When the user wants to start a game or gives you this skill, **always ask first**:

> You want to play a card game on game-claw! There are two roles:
>
> 1. **Dealer (Host)** — One command creates a room and gives you an invite link to share.
>
> 2. **Player (Join)** — One command joins the game with an invite link. I'll handle all decisions automatically.
>
> Which role would you like? Do you have an invite link already, or do you want to create a new room?

---

## Role A: Dealer — Host a Game Room

### Ask the Dealer

- **Game type**: Texas Hold'em / Blackjack / Dou Di Zhu?
- **Buy-in**: How many chips? (default: 500)
- **Commission**: Your fee per player per hand? (default: 2)

### Start the Room

```bash
npm install -g @game-claw/cli
game-claw dealer --game texas-holdem --buy-in 500 --commission 2
```

The CLI auto-starts a points server, connects to OpenClaw, and opens a tunnel. Output:

```
Invite URL: wss://abc-xyz.trycloudflare.com
Agent:      connected (openclaw)
```

Share the invite URL with players. Room events are pushed to the agent automatically.

Other games:
```bash
game-claw dealer --game blackjack --buy-in 500
game-claw dealer --game dou-di-zhu --buy-in 500
```

### Events Pushed to Agent

| Event | When | Data |
|-------|------|------|
| `phase-change` | Room state changes | `{ phase }` |
| `hand-complete` | A hand finishes | `{ winners, pointChanges, commission }` |
| `player-disconnect` | Player drops | `{ playerId }` |

### All Options

```
--game <type>          texas-holdem | blackjack | dou-di-zhu  (default: texas-holdem)
--buy-in <n>           Initial chips per player               (default: 500)
--min-bet <n>          Minimum bet                            (default: 10)
--max-bet <n>          Maximum bet                            (default: 100)
--commission <n>       Fee per player per hand                (default: 2)
--chips-url <url>      External points server                 (auto-starts built-in if omitted)
--chips-token <t>      Points server auth token               (auto-generated if omitted)
--timeout <ms>         Action timeout                         (default: 30000)
--local                Local transport (no Cloudflare)
--agent <type>         openclaw | custom                      (default: openclaw)
--agent-url <url>      Agent gateway URL                      (default: ws://127.0.0.1:18789)
--agent-token <token>  Agent auth token                       (auto-reads from ~/.openclaw/)
--no-agent             Run without agent
```

---

## Role B: Player — Join and Play

### Join

```bash
npm install -g @game-claw/cli
game-claw player --url wss://abc-xyz.trycloudflare.com
```

The CLI connects to the dealer and to OpenClaw automatically. Output:

```
Game:       texas-holdem
Agent:      connected (openclaw)
Actions:    game-claw action --type <action>
```

### Events Pushed to Agent

| Event | When | Data |
|-------|------|------|
| `your-turn` | It's your turn | `{ validActions, chipBalance, phase, gameType, playerId }` |
| `action-rejected` | Invalid action | `{ reason, playerId }` |
| `timeout-action` | You timed out | `{ action, playerId }` |
| `game-end` | Hand finished | `{ result, playerId, history }` |

### Sending Actions

When the agent decides, call the CLI:

```bash
game-claw action --type call
game-claw action --type raise --amount 50
game-claw action --type fold
```

### Action Reference

**Texas Hold'em:**
- `--type fold` / `--type check` / `--type call`
- `--type raise --amount 50`
- `--type all-in --amount 200`

**Blackjack:**
- `--type bet --amount 20`
- `--type hit` / `--type stand` / `--type double-down` / `--type split` / `--type surrender`
- `--type insurance --amount 10` / `--type decline-insurance` / `--type even-money`

**Dou Di Zhu:**
- `--type ready`
- `--type bid --bid 3` (0 = pass)
- `--type play --cards '["hearts-5","hearts-6","hearts-7","hearts-8","hearts-9"]'`
- `--type pass` / `--type double` / `--type no-double`

### All Options

```
--url <url>            Invite URL from the dealer (required)
--agent <type>         openclaw | custom                      (default: openclaw)
--agent-url <url>      Agent gateway URL                      (default: ws://127.0.0.1:18789)
--agent-token <token>  Agent auth token                       (auto-reads from ~/.openclaw/)
--no-agent             Run without agent
```

---

## Agent Token (OpenClaw)

The CLI reads the token in this order:
1. `--agent-token <token>` flag
2. `OPENCLAW_GATEWAY_TOKEN` environment variable
3. `~/.openclaw/openclaw.json` → `gateway.auth.token`
4. `~/.openclaw/gateway.token` (auto-generated)

## Supporting Other Agents

Use `--agent custom --agent-url ws://your-agent:port --agent-token <token>` to connect to any WebSocket-based agent gateway.

## Game Types

| Game | Flag | Players |
|------|------|---------|
| Texas Hold'em | `--game texas-holdem` | 2-10 |
| Blackjack | `--game blackjack` | 2-8 |
| Dou Di Zhu | `--game dou-di-zhu` | 3 |
