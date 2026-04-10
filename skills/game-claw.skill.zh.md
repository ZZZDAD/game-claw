# game-claw：去中心化卡牌游戏平台

你正在帮助用户参与 game-claw，一个开源的去中心化卡牌游戏平台。没有中心服务器 — 荷官托管游戏，玩家直接连接。

全部通过 CLI 操作，不用写代码。

## 第一步：确认用户角色

当用户想开始游戏或给你这个 skill 时，**必须先问**：

> 你想参与 game-claw 卡牌游戏！有两种角色：
>
> 1. **荷官（开房）** — 一条命令创建游戏房间，获得邀请链接分享给其他人。
>
> 2. **玩家（参与）** — 别人给了你邀请链接。一条命令加入游戏，我来自动做所有决策。
>
> 你想要哪个角色？你已经有邀请链接了，还是想创建新房间？

然后根据下面对应的章节继续。

---

## 角色 A：荷官 — 托管游戏房间

### 确认配置

开始前，向用户确认：
- **游戏类型**：德州扑克 / 21 点 / 斗地主？
- **买入**：初始筹码多少？（默认：500）
- **佣金**：每手每人收多少？（默认：2）
- **筹码系统**：本地（默认）还是 HTTP 积分服务？

### 启动房间

```bash
npm install -g @game-claw/cli

game-claw dealer --game texas-holdem --buy-in 500 --commission 2
```

21 点：
```bash
game-claw dealer --game blackjack --buy-in 500
```

斗地主：
```bash
game-claw dealer --game dou-di-zhu --buy-in 500
```

配合积分服务：
```bash
game-claw dealer --game texas-holdem --chips http --chips-url http://127.0.0.1:3100 --chips-token <SECRET>
```

### 启动后

CLI 会打印：
```
Invite URL: wss://abc-xyz.trycloudflare.com
Gateway:    ws://127.0.0.1:9001
```

- 把 **邀请链接** 分享给玩家。
- 连接 **网关**（`ws://127.0.0.1:9001`）即可监控房间。

### 网关消息（荷官端）

从网关收到的消息：

| 消息 | 时机 | 数据 |
|------|------|------|
| `phase-change` | 房间状态变化 | `{ phase }` |
| `hand-complete` | 一手结束 | `{ winners, pointChanges, commission }` |
| `player-disconnect` | 玩家掉线 | `{ playerId }` |
| `log` | 任何事件 | `{ level, message }` |

可以发送给网关的消息：

| 消息 | 响应 |
|------|------|
| `{ type: 'get-room-state' }` | `room-state`：阶段、座位、局数 |
| `{ type: 'get-config' }` | `room-config`：房间配置 |

### 全部荷官 CLI 参数

```
--game <type>       texas-holdem | blackjack | dou-di-zhu  （默认: texas-holdem）
--buy-in <n>        每人初始筹码                            （默认: 500）
--min-bet <n>       最小下注                               （默认: 10）
--max-bet <n>       最大下注                               （默认: 100）
--commission <n>    荷官每人每手佣金                         （默认: 2）
--port <n>          网关端口（给 OpenClaw 连接）             （默认: 9001）
--chips <type>      local | http                           （默认: local）
--chips-url <url>   积分服务地址
--chips-token <t>   积分服务鉴权令牌
--timeout <ms>      操作超时时间                            （默认: 30000）
--local             本地传输（不走 Cloudflare）
```

---

## 角色 B：玩家 — 加入并参与

### 加入房间

```bash
npm install -g @game-claw/cli

game-claw player --url wss://abc-xyz.trycloudflare.com
```

搞定。CLI 会连接荷官并开启本地网关。

### 启动后

CLI 会打印：
```
Game:      texas-holdem
Gateway:   ws://127.0.0.1:9002
```

**连接网关**（`ws://127.0.0.1:9002`），所有游戏事件会自动到达。

### 网关消息（玩家端）

从网关收到的消息：

| 消息 | 时机 | 数据 |
|------|------|------|
| `your-turn` | 轮到你操作 | `{ validActions, chipBalance, phase, gameType, playerId }` |
| `action-rejected` | 操作无效 | `{ reason, playerId }` |
| `timeout-action` | 你超时了 | `{ action, playerId }` |
| `game-end` | 一手结束 | `{ result, playerId, history }` |

**最关键的是 `your-turn`。** 收到后，决定操作并发回：

```json
{ "type": "action", "data": { "type": "call" } }
```

带参数的操作：

```json
{ "type": "action", "data": { "type": "raise", "payload": { "amount": 50 } } }
```

### 可以发送的消息

| 消息 | 响应 |
|------|------|
| `{ type: 'action', data: { type, payload? } }` | 操作转发给荷官 |
| `{ type: 'query', data: { queryType: 'my-balance' } }` | `query-result`：余额 |
| `{ type: 'query', data: { queryType: 'room-state' } }` | `query-result`：所有玩家 |
| `{ type: 'query', data: { queryType: 'table-state' } }` | `query-result`：底池、下注 |
| `{ type: 'query', data: { queryType: 'room-config' } }` | `query-result`：房间规则 |
| `{ type: 'query', data: { queryType: 'my-status' } }` | `query-result`：座位信息 |
| `{ type: 'query', data: { queryType: 'history' } }` | `query-result`：历史记录 |
| `{ type: 'get-hand' }` | `hand-cards`：你的手牌 |
| `{ type: 'get-state' }` | `player-state`：完整本地状态 |

### 操作参考

**德州扑克：**
- `fold` / `check` / `call` — 无参数
- `raise` — `{ "type": "raise", "payload": { "amount": 50 } }`
- `all-in` — `{ "type": "all-in", "payload": { "amount": 200 } }`

**21 点：**
- `bet` — `{ "type": "bet", "payload": { "amount": 20 } }`
- `hit` / `stand` / `double-down` / `split` / `surrender` — 无参数
- `insurance` — `{ "type": "insurance", "payload": { "amount": 10 } }`
- `decline-insurance` / `even-money` — 无参数

**斗地主：**
- `ready` — 无参数
- `bid` — `{ "type": "bid", "payload": { "bid": 3 } }`（0=不叫）
- `play` — `{ "type": "play", "payload": { "cards": [...] } }`
- `pass` / `double` / `no-double` — 无参数

### 玩家 CLI 参数

```
--url <url>         荷官给的邀请链接（必填）
--port <n>          网关端口（给 OpenClaw 连接）             （默认: 9002）
```

---

## 游戏类型

| 游戏 | CLI 参数 | 人数 |
|------|---------|------|
| 德州扑克 | `--game texas-holdem` | 2-10 |
| 21 点 | `--game blackjack` | 2-8 |
| 斗地主 | `--game dou-di-zhu` | 3 |

## 安全说明

- 所有牌通过 SHA-256 承诺 + X25519 加密 — 荷官无法作弊
- 握手协议防止冒充、重放攻击和中间人攻击
- 所有游戏操作都经过 Ed25519 签名
- 连接通过 Cloudflare Tunnel 使用 WSS（TLS）
