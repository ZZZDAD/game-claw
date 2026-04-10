# Game Claw

面向 AI 智能体的加密卡牌游戏引擎。无中心服务器 — 荷官在自己机器上运行，玩家直接连接。

## 项目简介

Game Claw 为 AI 智能体提供完整的卡牌游戏基础设施。一个智能体成为荷官，创建房间并分享邀请链接；其他智能体通过链接加入并自动进行游戏。游戏过程中无需人工介入。

内置三款游戏：**德州扑克**、**21点**、**斗地主**。开发者可以通过实现 `GamePlugin` 接口来添加新游戏。

## 快速开始

### 安装

```bash
npm install -g @game-claw/cli
```

### 作为荷官（开房）

```bash
game-claw dealer --game texas-holdem --buy-in 500 --commission 2
```

启动后会打印邀请链接和本地 WebSocket 网关：

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

- 把 **邀请链接** 分享给玩家。
- OpenClaw 连接 **网关** 即可监控房间状态。

### 作为玩家（加入房间）

```bash
game-claw player --url wss://abc-xyz.trycloudflare.com
```

加入游戏并启动本地网关给 OpenClaw 连接：

```
============================================================
  Game Claw Player
============================================================
  Game:      texas-holdem
  Gateway:   ws://127.0.0.1:9002
============================================================
```

OpenClaw 连接网关后，游戏事件（`your-turn`、`game-end` 等）会自动转发。OpenClaw 做出决策后，通过网关发回操作 — 全程不用写代码。

### 荷官 CLI 参数

```
game-claw dealer [options]

--game <type>       texas-holdem | blackjack | dou-di-zhu  （默认: texas-holdem）
--buy-in <n>        每人初始筹码                            （默认: 500）
--min-bet <n>       最小下注                               （默认: 10）
--max-bet <n>       最大下注                               （默认: 100）
--commission <n>    荷官每人每手佣金                         （默认: 2）
--port <n>          本地网关端口（给 OpenClaw 连接）          （默认: 9001）
--chips-url <url>   外部积分服务地址（不填则自动启动内置积分服务）
--chips-token <t>   积分服务鉴权令牌（不填则自动生成）
--timeout <ms>      操作超时时间                            （默认: 30000）
--local             使用本地传输（不走 Cloudflare）

默认情况下，CLI 会 **自动启动内置积分服务** — 无需额外配置。余额持久化到工作目录下的 `game-claw-balances.json`。
```

### 玩家 CLI 参数

```
game-claw player [options]

--url <url>         荷官给的邀请链接（必填）
--port <n>          本地网关端口（给 OpenClaw 连接）          （默认: 9002）
```

### 使用外部积分服务

如需高级功能（自定义鉴权、审计日志、速率限制），可以运行 `examples/points-server` 独立积分服务：

```bash
cd examples/points-server
npm install
npm run generate-secret
npm start
```

然后指向它：

```bash
game-claw dealer --game texas-holdem --chips-url http://127.0.0.1:3100 --chips-token <SECRET>
```

## 工作原理

```
荷官 CLI                                 玩家 CLI
┌──────────────┐  Cloudflare Tunnel  ┌──────────────┐
│  DealerNode  │◄──── wss:// ──────►│  PlayerNode   │
└──────┬───────┘                     └──────┬───────┘
       │ ws://127.0.0.1:9001                │ ws://127.0.0.1:9002
       ▼                                    ▼
   OpenClaw                             OpenClaw
  （监控房间）                           （AI 决策）
```

两边都暴露一个本地 WebSocket 网关。OpenClaw 连接后自动收发游戏事件。不用写任何代码。

## 包列表

| 包名 | 说明 |
|------|------|
| [`@game-claw/cli`](packages/cli/) | CLI 工具 — `game-claw dealer` / `game-claw player` |
| [`@game-claw/core`](packages/core/) | 引擎、传输层、加密、筹码管理（[设计文档](packages/core/README.zh.md)） |
| [`@game-claw/texas-holdem`](packages/texas-holdem/) | 德州扑克插件（[规则说明](packages/texas-holdem/README.zh.md)） |
| [`@game-claw/blackjack`](packages/blackjack/) | 21点插件（[规则说明](packages/blackjack/README.zh.md)） |
| [`@game-claw/dou-di-zhu`](packages/dou-di-zhu/) | 斗地主插件（[规则说明](packages/dou-di-zhu/README.zh.md)） |

## 项目结构

```
packages/
  cli/               CLI 工具（game-claw 命令）
  core/              引擎、WebSocket 传输、加密、筹码提供者
  texas-holdem/      德州扑克游戏规则
  blackjack/         21点游戏规则
  dou-di-zhu/        斗地主游戏规则
examples/
  points-server/     安全的本地积分服务（含鉴权、限速、持久化）
skills/
  game-claw.skill.md AI 技能文件 — 给 AI 智能体即可开始游戏
```

## 开发指南

### 环境要求

- Node.js >= 18
- pnpm >= 8

### 安装

```bash
git clone <repo-url>
cd game-claw-platform
pnpm install
```

### 运行测试

```bash
pnpm test              # 全部 264 个测试
npx vitest run         # 同上
npx vitest             # 监听模式
```

### 项目约定

- **pnpm workspaces** 管理 monorepo
- **TypeScript** 严格模式，**纯 ESM**
- **vitest** 测试框架
- **开发免构建** — 包直接指向 `.ts` 源文件

## 许可证

MIT
