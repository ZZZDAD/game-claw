# game-claw: Decentralized Card Game Platform

You are helping the user participate in game-claw, an open-source decentralized card game platform. No central server — a dealer hosts the game, players connect directly.

## First Step: Ask the User's Role

When the user wants to start a game or gives you this skill, **always ask first**:

> You want to play a card game on game-claw! There are two roles:
>
> 1. **Dealer (Host)** — You host the game room. You run the server, set the rules (game type, buy-in, commission), and share an invite link for others to join. You earn commission per hand.
>
> 2. **Player (Join)** — Someone gave you an invite link. You join their room and play. I'll handle all the game decisions for you automatically.
>
> Which role would you like? Do you have an invite link already, or do you want to create a new room?

Then proceed with the matching section below.

---

## Role A: Dealer — Host a Game Room

### Prerequisites

```bash
npm install @game-claw/core @game-claw/texas-holdem @game-claw/blackjack @game-claw/dou-di-zhu
```

If using the local points system (recommended for beginners):
```bash
cd examples/points-server
npm install
npm run generate-secret   # creates .env with DEALER_SECRET
npm start                 # starts on http://127.0.0.1:3100
```

### Ask the Dealer

Before creating the room, confirm with the user:
- **Game type**: Texas Hold'em / Blackjack / Dou Di Zhu?
- **Chip system**: Local points server (easiest) / Blockchain (EVM/Solana)?
- **Buy-in**: How many chips to start? (default: 500)
- **Commission**: Your fee per player per hand? (default: 2)
- **Min/Max bet**: (default: 10/100)

### Create the Room

```typescript
import { DealerNode, generateIdentity, CloudflareTransport } from '@game-claw/core';
import { TexasHoldemPlugin } from '@game-claw/texas-holdem';
// Or: import { BlackjackPlugin } from '@game-claw/blackjack';
// Or: import { DouDiZhuPlugin } from '@game-claw/dou-di-zhu';

const identity = generateIdentity();
const plugin = new TexasHoldemPlugin();  // change per game type

const roomConfig = {
  gameType: 'texas-holdem',
  chipProvider: {
    type: 'http',                         // or 'local' for testing
    url: 'http://127.0.0.1:3100',
    authToken: '<DEALER_SECRET>',         // from examples/points-server/.env
  },
  chipUnit: 'pts',
  minBet: 10,
  maxBet: 100,
  buyIn: 500,
  commission: 2,
  settings: {},  // blackjack: { bankerIndex: 0 }
};

const dealer = new DealerNode(plugin, identity, '0.1.0', roomConfig,
  new CloudflareTransport(),
  { actionTimeout: 30000, betweenHandsDelay: 10000, autoStart: true },
);

const inviteUrl = await dealer.createRoom();
```

### Tell the Dealer

After creation, tell the user:

> Room created! Share this invite link with players:
> `<inviteUrl>`
>
> Game: Texas Hold'em | Buy-in: 500 | Commission: 2/player/hand
> Waiting for players to join... (min 2 players to start)

### Monitoring

```typescript
dealer.onPhaseChange((phase) => { /* idle->waiting->playing->settling->between-hands->... */ });
dealer.onHandComplete_cb((result) => { /* result.winners, result.pointChanges */ });
dealer.onPlayerDisconnect((id) => { /* player dropped, 60s reconnect window */ });
```

### Chip Provider Options

| Type | Config | When to Use |
|------|--------|-------------|
| `local` | `{ type: 'local' }` | Testing only |
| `http` | `{ type: 'http', url, authToken }` | Local points server (see `examples/points-server`) |
| `evm` | `{ type: 'evm', rpcUrl, chainId, contractAddress }` | Ethereum/Polygon/BSC |
| `solana` | `{ type: 'solana', rpcUrl, programId }` | Solana |

---

## Role B: Player — Join and Play

### Prerequisites

```bash
npm install @game-claw/core
```

### Join the Room

```typescript
import { PlayerNode, generateIdentity } from '@game-claw/core';

const player = new PlayerNode(generateIdentity(), '0.1.0');
const { accepted, reason } = await player.join('<INVITE_URL>');
if (!accepted) throw new Error(reason);
```

### Automatic Game Play

Register the turn handler — I'll decide and act automatically:

```typescript
player.onMyTurn(async (turn) => {
  // turn.validActions — available moves with cost and affordable flag
  // turn.chipBalance  — current chips
  // turn.phase        — game phase
  // turn.gameType     — 'texas-holdem' | 'blackjack' | 'dou-di-zhu'

  const action = pickBestAction(turn); // AI decision logic
  await player.sendAction(action);
});
```

### Query Information Anytime

```typescript
const balance = await player.queryBalance();          // my chip balance
const room    = await player.queryRoomState();         // all players, their status & chips
const table   = await player.queryTableState();        // pot, bets, community cards
const config  = await player.queryRoomConfig();        // room rules
const me      = await player.queryMyStatus();          // my status, balance, credit score
const history = player.getHistory();                   // past game results
```

### Event Handlers

```typescript
player.onActionRejected((reason) => { /* bad move */ });
player.onTimeout((autoAction) => { /* I was too slow, system acted for me */ });
player.waitForGameEnd().then((result) => { /* hand over: winners, pointChanges */ });
```

### Action Reference

**Texas Hold'em:**
- `fold` / `check` / `call` — no payload
- `raise` — `{ payload: { amount: <total bet> } }`
- `all-in` — `{ payload: { amount: <stack> } }`

**Blackjack:**
- `bet` — `{ payload: { amount } }` (betting phase)
- `hit` / `stand` / `double-down` / `split` / `surrender` — playing phase
- `insurance` — `{ payload: { amount } }` / `decline-insurance` / `even-money`

**Dou Di Zhu:**
- `ready` — pre-bidding
- `bid` — `{ payload: { bid: 0|1|2|3 } }` (0 = pass)
- `play` — `{ payload: { cards: Card[] } }` / `pass`
- `double` / `no-double` — doubling phase

### Simple Bot Example

```typescript
player.onMyTurn(async (turn) => {
  const a = turn.validActions;
  const pick =
    a.find(x => x.type === 'check') ??
    a.find(x => x.type === 'call' && x.affordable) ??
    a.find(x => x.type === 'stand') ??
    a.find(x => x.type === 'pass') ??
    a.find(x => x.type === 'fold') ??
    a[0];
  if (pick) await player.sendAction(pick);
});
```

### Leave

```typescript
await player.disconnect();
```

---

## Game Types

| Game | Plugin Class | Players | Key Feature |
|------|-------------|---------|-------------|
| Texas Hold'em | `TexasHoldemPlugin` | 2-10 | Community cards, blinds, side pots |
| Blackjack | `BlackjackPlugin` | 2-8 | Banker is a real player, peek rule, split/double |
| Dou Di Zhu | `DouDiZhuPlugin` | 3 | Landlord bidding, bombs, spring, multipliers |

## Security Notes

- All cards are cryptographically committed (SHA-256) and encrypted (X25519) — dealer cannot cheat
- Players verify all card reveals at game end via `player.verifyReveals(reveals)`
- Handshake protocol prevents impersonation, replay attacks, and MITM
- All game actions are signed with Ed25519
