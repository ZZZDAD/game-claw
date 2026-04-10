# Game Claw

面向 AI 智能体的加密卡牌游戏引擎。无中心服务器 — 荷官在自己机器上运行，玩家直接连接。

## 项目简介

Game Claw 为 AI 智能体提供完整的卡牌游戏基础设施。一个智能体成为荷官，创建房间并分享邀请链接；其他智能体通过链接加入并自动进行游戏。游戏过程中无需人工介入。

内置三款游戏：**德州扑克**、**21点**、**斗地主**。开发者可以通过实现 `GamePlugin` 接口来添加新游戏。

## 快速开始

### 作为荷官（开房）

```bash
npm install @game-claw/core @game-claw/texas-holdem
```

```typescript
import { DealerNode, generateIdentity, CloudflareTransport } from '@game-claw/core';
import { TexasHoldemPlugin } from '@game-claw/texas-holdem';

const dealer = new DealerNode(
  new TexasHoldemPlugin(),
  generateIdentity(),
  '0.1.0',
  { gameType: 'texas-holdem', chipProvider: { type: 'local' },
    chipUnit: 'pts', minBet: 10, maxBet: 100, buyIn: 500, commission: 2 },
  new CloudflareTransport(),
);
const url = await dealer.createRoom();
console.log('邀请链接:', url);
```

### 作为玩家（加入房间）

```bash
npm install @game-claw/core
```

```typescript
import { PlayerNode, generateIdentity } from '@game-claw/core';

const player = new PlayerNode(generateIdentity(), '0.1.0');
await player.join('wss://abc-xyz.trycloudflare.com');

player.onMyTurn(async (turn) => {
  const action = turn.validActions.find(a => a.type === 'call' && a.affordable)
    ?? turn.validActions.find(a => a.type === 'check')
    ?? turn.validActions[0];
  await player.sendAction(action);
});
```

## 包列表

| 包名 | 说明 |
|------|------|
| [`@game-claw/core`](packages/core/) | 引擎、传输层、加密、筹码管理（[设计文档](packages/core/README.zh.md)） |
| [`@game-claw/texas-holdem`](packages/texas-holdem/) | 德州扑克插件（[规则说明](packages/texas-holdem/README.zh.md)） |
| [`@game-claw/blackjack`](packages/blackjack/) | 21点插件（[规则说明](packages/blackjack/README.zh.md)） |
| [`@game-claw/dou-di-zhu`](packages/dou-di-zhu/) | 斗地主插件（[规则说明](packages/dou-di-zhu/README.zh.md)） |

## 项目结构

```
packages/
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
# 全部测试（28 个文件，264 个用例）
pnpm test
# 或
npx vitest run

# 单个包
npx vitest run packages/texas-holdem

# 监听模式
npx vitest
```

### 本地积分服务（筹码测试用）

```bash
cd examples/points-server
npm install
npm run generate-secret   # 生成 .env 鉴权密钥
npm start                 # 启动在 http://127.0.0.1:3100
npm test                  # 安全测试
```

### 项目约定

- **pnpm workspaces** 管理 monorepo
- **TypeScript** 严格模式
- **vitest** 测试框架
- **纯 ESM** — 所有包使用 `"type": "module"`
- **开发免构建** — 包直接指向 `.ts` 源文件。生产环境使用 `tsc` 编译。

## 许可证

MIT
