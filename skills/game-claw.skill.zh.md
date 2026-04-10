# game-claw：去中心化卡牌游戏平台

你正在帮助用户参与 game-claw，一个开源的去中心化卡牌游戏平台。没有中心服务器 — 荷官托管游戏，玩家直接连接。

## 第一步：确认用户角色

当用户想开始游戏或给你这个 skill 时，**必须先问**：

> 你想参与 game-claw 卡牌游戏！有两种角色：
>
> 1. **荷官（开房）** — 你来托管游戏房间。你运行服务器，设定规则（游戏类型、买入、佣金），然后分享邀请链接让其他人加入。每手牌你可以赚取佣金。
>
> 2. **玩家（参与）** — 别人给了你一个邀请链接。你加入他们的房间参与游戏。我会自动帮你做所有游戏决策。
>
> 你想要哪个角色？你已经有邀请链接了，还是想创建一个新房间？

然后根据下面对应的章节继续。

---

## 角色 A：荷官 — 托管游戏房间

### 前置准备

```bash
npm install @game-claw/core @game-claw/texas-holdem @game-claw/blackjack @game-claw/dou-di-zhu
```

如果使用本地积分系统（推荐新手使用）：
```bash
cd examples/points-server
npm install
npm run generate-secret   # 创建 .env 鉴权密钥
npm start                 # 启动在 http://127.0.0.1:3100
```

### 询问荷官

创建房间前，向用户确认：
- **游戏类型**：德州扑克 / 21 点 / 斗地主？
- **筹码系统**：本地积分服务（最简单）/ 区块链（EVM/Solana）？
- **买入**：初始筹码多少？（默认：500）
- **佣金**：每手每人收多少？（默认：2）
- **最小/最大下注**：（默认：10/100）

### 创建房间

```typescript
import { DealerNode, generateIdentity, CloudflareTransport } from '@game-claw/core';
import { TexasHoldemPlugin } from '@game-claw/texas-holdem';
// 或: import { BlackjackPlugin } from '@game-claw/blackjack';
// 或: import { DouDiZhuPlugin } from '@game-claw/dou-di-zhu';

const identity = generateIdentity();
const plugin = new TexasHoldemPlugin();  // 根据游戏类型更换

const roomConfig = {
  gameType: 'texas-holdem',
  chipProvider: {
    type: 'http',                         // 测试用 'local'
    url: 'http://127.0.0.1:3100',
    authToken: '<DEALER_SECRET>',         // 来自 examples/points-server/.env
  },
  chipUnit: 'pts',
  minBet: 10,
  maxBet: 100,
  buyIn: 500,
  commission: 2,
  settings: {},  // 21点: { bankerIndex: 0 }
};

const dealer = new DealerNode(plugin, identity, '0.1.0', roomConfig,
  new CloudflareTransport(),
  { actionTimeout: 30000, betweenHandsDelay: 10000, autoStart: true },
);

const inviteUrl = await dealer.createRoom();
```

### 告知荷官

创建成功后，告诉用户：

> 房间已创建！把这个邀请链接分享给玩家：
> `<inviteUrl>`
>
> 游戏：德州扑克 | 买入：500 | 佣金：2/人/手
> 等待玩家加入...（至少 2 人即可开始）

### 监控

```typescript
dealer.onPhaseChange((phase) => { /* idle->waiting->playing->settling->between-hands->... */ });
dealer.onHandComplete_cb((result) => { /* result.winners, result.pointChanges */ });
dealer.onPlayerDisconnect((id) => { /* 玩家断线，60秒重连窗口 */ });
```

### 筹码提供者选项

| 类型 | 配置 | 使用场景 |
|------|------|---------|
| `local` | `{ type: 'local' }` | 仅测试用 |
| `http` | `{ type: 'http', url, authToken }` | 本地积分服务（见 `examples/points-server`） |
| `evm` | `{ type: 'evm', rpcUrl, chainId, contractAddress }` | 以太坊/Polygon/BSC |
| `solana` | `{ type: 'solana', rpcUrl, programId }` | Solana |

---

## 角色 B：玩家 — 加入并参与

### 前置准备

```bash
npm install @game-claw/core
```

### 加入房间

```typescript
import { PlayerNode, generateIdentity } from '@game-claw/core';

const player = new PlayerNode(generateIdentity(), '0.1.0');
const { accepted, reason } = await player.join('<邀请链接>');
if (!accepted) throw new Error(reason);
```

### 自动游戏

注册回合处理器 — 我会自动决策并操作：

```typescript
player.onMyTurn(async (turn) => {
  // turn.validActions — 可用操作（含费用和是否负担得起）
  // turn.chipBalance  — 当前筹码
  // turn.phase        — 游戏阶段
  // turn.gameType     — 'texas-holdem' | 'blackjack' | 'dou-di-zhu'

  const action = pickBestAction(turn); // AI 决策逻辑
  await player.sendAction(action);
});
```

### 随时查询信息

```typescript
const balance = await player.queryBalance();          // 我的筹码余额
const room    = await player.queryRoomState();         // 所有玩家、状态和筹码
const table   = await player.queryTableState();        // 底池、下注、公共牌
const config  = await player.queryRoomConfig();        // 房间规则
const me      = await player.queryMyStatus();          // 我的状态、余额、信用分
const history = player.getHistory();                   // 历史对局记录
```

### 事件处理

```typescript
player.onActionRejected((reason) => { /* 操作无效 */ });
player.onTimeout((autoAction) => { /* 超时了，系统替我操作 */ });
player.waitForGameEnd().then((result) => { /* 一手结束：赢家、积分变化 */ });
```

### 操作参考

**德州扑克：**
- `fold` / `check` / `call` — 无参数
- `raise` — `{ payload: { amount: <总下注额> } }`
- `all-in` — `{ payload: { amount: <全部筹码> } }`

**21 点：**
- `bet` — `{ payload: { amount } }`（下注阶段）
- `hit` / `stand` / `double-down` / `split` / `surrender` — 玩家回合
- `insurance` — `{ payload: { amount } }` / `decline-insurance` / `even-money`

**斗地主：**
- `ready` — 准备阶段
- `bid` — `{ payload: { bid: 0|1|2|3 } }`（0=不叫）
- `play` — `{ payload: { cards: Card[] } }` / `pass`
- `double` / `no-double` — 加倍阶段

### 简单机器人示例

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

### 离开

```typescript
await player.disconnect();
```

---

## 游戏类型

| 游戏 | 插件类 | 人数 | 特色 |
|------|--------|------|------|
| 德州扑克 | `TexasHoldemPlugin` | 2-10 | 公共牌、盲注、侧池 |
| 21 点 | `BlackjackPlugin` | 2-8 | 庄家是真实玩家、窥牌、分牌/加倍 |
| 斗地主 | `DouDiZhuPlugin` | 3 | 叫地主、炸弹、春天、倍数系统 |

## 安全说明

- 所有牌通过 SHA-256 承诺 + X25519 加密 — 荷官无法作弊
- 玩家在游戏结束时通过 `player.verifyReveals(reveals)` 验证所有牌
- 握手协议防止冒充、重放攻击和中间人攻击
- 所有游戏操作都经过 Ed25519 签名
