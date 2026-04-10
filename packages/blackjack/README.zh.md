# @game-claw/blackjack

Game Claw 引擎的 21 点插件。庄家是真实玩家，不是虚拟庄。

## 概述

多人 21 点，支持 2-8 人。一名玩家担任庄家。支持所有标准操作：要牌、停牌、加倍、分牌、保险、等额赔付和投降。

## 规则

### 基本设置

- **人数**：2-8
- **牌组**：标准 52 张
- **庄家**：牌桌上的一名真实玩家，通过 `settings.bankerIndex` 指定
- **发牌**：庄家第一张明牌（所有人可见），第二张暗牌

### 手牌点数

| 牌 | 点数 |
|----|------|
| 2-10 | 面值 |
| J, Q, K | 10 |
| A | 11，总点数超过 21 时自动变为 1 |

- **天牌 21 点（Natural）**：恰好 2 张牌合计 21（A + 10 点牌）
- **软 17（Soft 17）**：含一张算作 11 的 A，总计 17

### 游戏阶段

```
下注 → 发牌 → [保险] → 玩家回合 → 庄家回合 → 结算
```

1. **下注**：普通玩家下注（最小/最大限制）
2. **发牌**：每人 2 张。庄家第一张明牌。
3. **保险**（可选）：庄家明牌为 A 且开启 `dealerPeek`
4. **玩家回合**：每位普通玩家依次操作
5. **庄家回合**：庄家按固定规则操作（<17 必须要牌，>=17 停牌）
6. **结算**：计算输赢

### 玩家操作

| 操作 | 可用时机 | 效果 |
|------|---------|------|
| `bet` | 下注阶段 | 下初始赌注 |
| `hit` | 玩家回合 | 要一张牌 |
| `stand` | 玩家回合 | 停牌 |
| `double-down` | 仅首次操作且手持 2 张牌 | 加倍赌注，再拿一张牌后自动停牌 |
| `split` | 仅首次操作且对子 | 分成两手，各拿一张新牌 |
| `insurance` | 庄家明牌为 A | 边注，最多为原注的一半。庄家天牌时赔 2:1。 |
| `decline-insurance` | 庄家明牌为 A | 拒绝保险 |
| `even-money` | 天牌 21 点 + 庄家明牌为 A | 保证 1:1 赔付，不冒被平的风险 |
| `surrender` | 仅首次操作 | 放弃一半赌注，保留另一半 |

### 赔率

| 结果 | 赔率 |
|------|------|
| 天牌 21 点（非分牌） | 3:2 |
| 普通赢 | 1:1 |
| 分牌后 21 点 | 1:1（不算天牌） |
| 保险（庄家天牌） | 2:1（保险注） |
| 等额赔付 | 1:1 保证 |
| 投降 | 输一半赌注 |
| 平局 | 退还赌注 |

### 庄家规则

庄家按固定规则操作，没有选择权：
- 16 或以下必须要牌
- 硬 17 或以上必须停牌
- **软 17**：可配置 `settings.softHit17`（默认：停牌）

### 窥牌规则（Dealer Peek）

启用 `settings.dealerPeek` 时：
- 庄家明牌为 A → 进入保险阶段
- 庄家明牌为 10 点牌 → 窥视暗牌。若为天牌，立即结束（玩家仅输原始赌注，不输加倍/分牌的额外注）。
- 无需窥牌 → 直接进入玩家回合

### 分牌规则

- 仅在对子（相同点值）且恰好 2 张牌时可用
- 每手分出的牌各拿一张新牌
- **分 A**：每手只拿一张牌，然后自动停牌
- **分牌后加倍**：可配置 `settings.doubleAfterSplit`
- **再次分牌**：上限 `settings.maxSplitHands`（默认：4）

## 配置

```typescript
const roomConfig = {
  gameType: 'blackjack',
  chipProvider: { type: 'http', url: 'http://127.0.0.1:3100', authToken: '<token>' },
  chipUnit: 'pts',
  minBet: 10,
  maxBet: 100,
  buyIn: 500,
  commission: 0,
  settings: {
    bankerIndex: 0,           // 哪位玩家是庄家
    softHit17: true,          // 庄家软 17 要牌
    doubleAfterSplit: true,   // 分牌后允许加倍
    dealerPeek: true,         // 庄家窥牌规则
    maxSplitHands: 4,         // 分牌上限
  },
};
```

## 使用

```typescript
import { BlackjackPlugin } from '@game-claw/blackjack';

const plugin = new BlackjackPlugin();
// plugin.meta = { name: 'blackjack', minPlayers: 2, maxPlayers: 8 }
```

## 文件结构

```
src/
  plugin.ts    游戏规则、所有操作、结算、窥牌逻辑
```
