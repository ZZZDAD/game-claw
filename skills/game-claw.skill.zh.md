# game-claw：去中心化卡牌游戏平台

你正在帮助用户参与 game-claw，一个开源的去中心化卡牌游戏平台。没有中心服务器 — 荷官托管游戏，玩家直接连接。

全部通过 CLI 操作。引擎自动连接 AI 智能体 — 不用写 WebSocket 代码。

## 第一步：确认用户角色

当用户想开始游戏或给你这个 skill 时，**必须先问**：

> 你想参与 game-claw 卡牌游戏！有两种角色：
>
> 1. **荷官（开房）** — 一条命令创建房间，获得邀请链接分享给其他人。
>
> 2. **玩家（参与）** — 一条命令加入游戏。我来自动做所有决策。
>
> 你想要哪个角色？你已经有邀请链接了，还是想创建新房间？

---

## 角色 A：荷官 — 托管游戏房间

### 确认配置

- **游戏类型**：德州扑克 / 21 点 / 斗地主？
- **买入**：初始筹码多少？（默认：500）
- **佣金**：每手每人收多少？（默认：2）

### 启动房间

```bash
npm install -g @game-claw/cli
game-claw dealer --game texas-holdem --buy-in 500 --commission 2
```

CLI 自动启动积分服务、连接 OpenClaw、开放隧道。输出：

```
Invite URL: wss://abc-xyz.trycloudflare.com
Agent:      connected (openclaw)
```

把邀请链接分享给玩家。房间事件自动推送给智能体。

其他游戏：
```bash
game-claw dealer --game blackjack --buy-in 500
game-claw dealer --game dou-di-zhu --buy-in 500
```

### 推送给智能体的事件

| 事件 | 时机 | 数据 |
|------|------|------|
| `phase-change` | 房间状态变化 | `{ phase }` |
| `hand-complete` | 一手结束 | `{ winners, pointChanges, commission }` |
| `player-disconnect` | 玩家掉线 | `{ playerId }` |

### 全部参数

```
--game <type>          texas-holdem | blackjack | dou-di-zhu  （默认: texas-holdem）
--buy-in <n>           每人初始筹码                            （默认: 500）
--min-bet <n>          最小下注                               （默认: 10）
--max-bet <n>          最大下注                               （默认: 100）
--commission <n>       荷官每人每手佣金                         （默认: 2）
--chips-url <url>      外部积分服务                            （不填自动启动内置服务）
--chips-token <t>      积分服务鉴权令牌                        （不填自动生成）
--timeout <ms>         操作超时                               （默认: 30000）
--local                本地传输（不走 Cloudflare）
--agent <type>         openclaw | custom                      （默认: openclaw）
--agent-url <url>      智能体网关地址                          （默认: ws://127.0.0.1:18789）
--agent-token <token>  鉴权令牌                               （自动从 ~/.openclaw/ 读取）
--no-agent             不连接智能体
```

---

## 角色 B：玩家 — 加入并参与

### 加入

```bash
npm install -g @game-claw/cli
game-claw player --url wss://abc-xyz.trycloudflare.com
```

CLI 自动连接荷官和 OpenClaw。输出：

```
Game:       texas-holdem
Agent:      connected (openclaw)
Actions:    game-claw action --type <action>
```

### 推送给智能体的事件

| 事件 | 时机 | 数据 |
|------|------|------|
| `your-turn` | 轮到你操作 | `{ validActions, chipBalance, phase, gameType, playerId }` |
| `action-rejected` | 操作无效 | `{ reason, playerId }` |
| `timeout-action` | 超时了 | `{ action, playerId }` |
| `game-end` | 一手结束 | `{ result, playerId, history }` |

### 发送操作

AI 决策后，调用 CLI 命令：

```bash
game-claw action --type call
game-claw action --type raise --amount 50
game-claw action --type fold
```

### 操作参考

**德州扑克：**
- `--type fold` / `--type check` / `--type call`
- `--type raise --amount 50`
- `--type all-in --amount 200`

**21 点：**
- `--type bet --amount 20`
- `--type hit` / `--type stand` / `--type double-down` / `--type split` / `--type surrender`
- `--type insurance --amount 10` / `--type decline-insurance` / `--type even-money`

**斗地主：**
- `--type ready`
- `--type bid --bid 3`（0=不叫）
- `--type play --cards '["hearts-5","hearts-6","hearts-7","hearts-8","hearts-9"]'`
- `--type pass` / `--type double` / `--type no-double`

### 全部参数

```
--url <url>            荷官给的邀请链接（必填）
--agent <type>         openclaw | custom                      （默认: openclaw）
--agent-url <url>      智能体网关地址                          （默认: ws://127.0.0.1:18789）
--agent-token <token>  鉴权令牌                               （自动从 ~/.openclaw/ 读取）
--no-agent             不连接智能体
```

---

## Token 读取优先级（OpenClaw）

1. `--agent-token <token>` 显式传入
2. `OPENCLAW_GATEWAY_TOKEN` 环境变量
3. `~/.openclaw/openclaw.json` → `gateway.auth.token`
4. `~/.openclaw/gateway.token`（自动生成的文件）

## 接入其他智能体

使用 `--agent custom --agent-url ws://your-agent:port --agent-token <token>` 可连接任何 WebSocket 智能体网关。

## 游戏类型

| 游戏 | 参数 | 人数 |
|------|------|------|
| 德州扑克 | `--game texas-holdem` | 2-10 |
| 21 点 | `--game blackjack` | 2-8 |
| 斗地主 | `--game dou-di-zhu` | 3 |
