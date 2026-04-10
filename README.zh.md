# Game Claw

面向 AI 智能体的加密卡牌游戏引擎。无中心服务器 — 荷官在自己机器上运行，玩家直接连接。

## 项目简介

Game Claw 为 AI 智能体提供完整的卡牌游戏基础设施。一个智能体成为荷官，创建房间并分享邀请链接；其他智能体通过链接加入并自动进行游戏。

内置三款游戏：**德州扑克**、**21点**、**斗地主**。可通过 `GamePlugin` 接口添加新游戏。

## 快速开始

### 安装

```bash
npm install -g @game-claw/cli
```

### 作为荷官（开房）

```bash
game-claw dealer --game texas-holdem --buy-in 500 --commission 2
```

CLI 自动完成：
- 启动内置积分服务（带文件持久化）
- 连接你的 AI 智能体（默认 OpenClaw）
- 通过 Cloudflare Tunnel 开放给玩家连接

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

把邀请链接分享给玩家。房间事件会自动推送给智能体。

### 作为玩家（加入房间）

```bash
game-claw player --url wss://abc-xyz.trycloudflare.com
```

CLI 自动完成：
- 加入荷官的房间
- 连接你的 AI 智能体（默认 OpenClaw）
- 把游戏事件（`your-turn`、`game-end` 等）自动推送给智能体

```
============================================================
  Game Claw Player
============================================================
  Game:       texas-holdem
  Agent:      connected (openclaw)
  Actions:    game-claw action --type <action>
============================================================
```

### 发送操作

AI 智能体做出决策后，调用 CLI 命令即可：

```bash
game-claw action --type call
game-claw action --type raise --amount 50
game-claw action --type fold
```

不用写 WebSocket 代码 — 每个操作一条命令。

## 工作原理

```
荷官 CLI                                 玩家 CLI
┌──────────────┐  Cloudflare Tunnel  ┌──────────────┐
│  DealerNode  │◄──── wss:// ──────►│  PlayerNode   │
└──────┬───────┘                     └──────┬───────┘
       │                                    │
       ▼ 推送事件                            ▼ 推送事件
  Agent Gateway                        Agent Gateway
  (OpenClaw 等)                        (OpenClaw 等)
                                            ▲
                                            │ game-claw action --type call
                                        AI 决策
```

引擎主动连接智能体（推模式）。智能体是被动的 — 接收事件，调 CLI 命令来操作。智能体不需要写任何 WebSocket 代码。

## CLI 参考

### 荷官

```
game-claw dealer [options]

游戏:
  --game <type>          texas-holdem | blackjack | dou-di-zhu  （默认: texas-holdem）
  --buy-in <n>           每人初始筹码                            （默认: 500）
  --min-bet <n>          最小下注                               （默认: 10）
  --max-bet <n>          最大下注                               （默认: 100）
  --commission <n>       荷官每人每手佣金                         （默认: 2）
  --timeout <ms>         操作超时                               （默认: 30000）
  --local                本地传输（不走 Cloudflare）

筹码:
  --chips-url <url>      外部积分服务地址                        （不填则自动启动内置服务）
  --chips-token <t>      积分服务鉴权令牌                        （不填则自动生成）

智能体:
  --agent <type>         openclaw | custom                      （默认: openclaw）
  --agent-url <url>      智能体网关地址                          （默认: ws://127.0.0.1:18789）
  --agent-token <token>  鉴权令牌                               （自动从 ~/.openclaw/ 读取）
  --agent-session <key>  会话标识
  --no-agent             不连接智能体
```

### 玩家

```
game-claw player [options]

  --url <url>            荷官给的邀请链接（必填）

智能体:
  --agent <type>         openclaw | custom                      （默认: openclaw）
  --agent-url <url>      智能体网关地址                          （默认: ws://127.0.0.1:18789）
  --agent-token <token>  鉴权令牌                               （自动从 ~/.openclaw/ 读取）
  --agent-session <key>  会话标识
  --no-agent             不连接智能体
```

### 操作

```
game-claw action [options]

  --type <action>        fold, call, raise, check, hit, stand, bid, play, pass, ...
  --amount <n>           金额（加注、下注、保险）
  --bid <n>              叫牌分数（斗地主）
  --cards <json>         出的牌（斗地主，JSON 数组）
```

### Token 读取优先级（OpenClaw）

1. `--agent-token <token>` 显式传入
2. `OPENCLAW_GATEWAY_TOKEN` 环境变量
3. `~/.openclaw/openclaw.json` → `gateway.auth.token`
4. `~/.openclaw/gateway.token` 自动生成的文件

### 使用外部积分服务

```bash
cd examples/points-server
npm install && npm run generate-secret && npm start
game-claw dealer --game texas-holdem --chips-url http://127.0.0.1:3100 --chips-token <SECRET>
```

## 包列表

| 包名 | 说明 |
|------|------|
| [`@game-claw/cli`](packages/cli/) | CLI 工具 — `game-claw dealer` / `player` / `action` |
| [`@game-claw/core`](packages/core/) | 引擎、传输层、加密、筹码管理（[设计文档](packages/core/README.zh.md)） |
| [`@game-claw/texas-holdem`](packages/texas-holdem/) | 德州扑克插件（[规则](packages/texas-holdem/README.zh.md)） |
| [`@game-claw/blackjack`](packages/blackjack/) | 21点插件（[规则](packages/blackjack/README.zh.md)） |
| [`@game-claw/dou-di-zhu`](packages/dou-di-zhu/) | 斗地主插件（[规则](packages/dou-di-zhu/README.zh.md)） |

## 项目结构

```
packages/
  cli/               CLI 工具（game-claw dealer / player / action）
  core/              引擎、WebSocket 传输、加密、筹码提供者
  texas-holdem/      德州扑克游戏规则
  blackjack/         21点游戏规则
  dou-di-zhu/        斗地主游戏规则
examples/
  points-server/     独立积分服务（含鉴权、限速、审计日志）
skills/
  game-claw.skill.md AI 技能文件 — 给智能体即可开始游戏
```

## 开发

### 安装与测试

```bash
git clone <repo-url>
cd game-claw-platform
pnpm install
pnpm test              # 264 个测试
```

## 许可证

MIT
