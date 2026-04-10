[English](README.md) | **中文**

# @game-claw/core

Game Claw 平台核心引擎。提供加密发牌、WebSocket 网络通信、筹码管理，以及游戏插件接口。

## 架构

四层设计，每层只调用下一层：

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  DealerNode │ ──► │  GameEngine  │ ──► │  GamePlugin  │
│  (房间管理)  │     │ (发牌/加密)   │     │  (游戏规则)  │
└─────────────┘     └─────────────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│ ChipProvider│
│  (扣款/加款) │
└─────────────┘
```

| 层级 | 职责 |
|------|------|
| **GamePlugin** | 纯游戏规则。验证操作、推进状态、判定赢家。不涉及网络或筹码。 |
| **GameEngine** | 洗牌、为每个玩家加密发牌（X25519）、创建 SHA-256 承诺、执行发牌计划。调用插件处理游戏逻辑。 |
| **DealerNode** | 房间生命周期、WebSocket 连接、玩家加入/离开/重连、操作超时、筹码扣款/加款、状态广播。只与 GameEngine 交互。 |
| **PlayerNode** | 客户端 SDK。连接荷官、解密发到手的牌、发送操作、接收回合通知、查询房间/牌桌状态。 |

## 加密发牌协议

### 发牌流程

```
1. GameEngine 洗牌（Fisher-Yates 算法 + 加密随机数）
2. 插件提供 DealPlan：谁拿几张牌、明牌还是暗牌
3. 对每张发给玩家的牌：
   a. 生成随机 32 字节盐值
   b. 承诺值 = SHA-256(cardId || salt)
   c. 用收牌者的 X25519 公钥加密 {cardId, salt}（NaCl box）
   d. 用荷官的 Ed25519 私钥签名承诺值
4. 所有承诺广播给所有玩家（每个人都能看到哈希）
5. 加密牌数据仅发送给目标玩家
6. 游戏结束时：公开所有盐值，任何玩家都可验证每张牌的承诺
```

核心保证：
- **荷官无法作弊** — 牌在发出前已被承诺，改牌会破坏哈希
- **玩家互相看不到对方的牌** — 加密是针对每个玩家单独进行的
- **完全可验证** — 游戏结束后公开所有秘密，任何人都能重新计算每个哈希

### 不同类型的牌

| 目标 | 加密方式 | 可见性 |
|------|---------|--------|
| 玩家 | X25519 box 加密给该玩家 | 仅目标玩家可见 |
| 公共牌（明牌） | 无 | 立即对所有人公开 |
| 公共牌（暗牌） | 无 | 仅哈希可见；之后公开 |
| 废牌（burn） | 无 | 仅哈希可见；游戏结束时公开 |
| 庄家牌（house） | 无 | 哈希；明牌则立即公开 |

## 握手协议

玩家连接时的 4 步双向认证：

```
玩家 → 荷官:  HELLO  { 玩家公钥, npm版本, 时间戳, 签名 }
荷官 → 玩家:  CHALLENGE  { 随机32字节, 荷官公钥, 房间配置, 签名 }
玩家 → 荷官:  RESPONSE  { sign(challenge, 玩家私钥) }
荷官 → 玩家:  ACCEPTED / REJECTED
```

| 攻击类型 | 防御方式 |
|---------|---------|
| 冒充身份 | 双方都通过签名证明拥有私钥 |
| 重放攻击 | 15 秒时间窗口 + 每次连接随机挑战 |
| 中间人攻击 | 双方都验证对方签名的公钥 |
| 版本不匹配 | 在 HELLO 步骤中检查 npm 版本 |

超时：每次握手 10 秒。过期连接会被拒绝。

## 房间状态机

```
idle → waiting → playing → settling → between-hands ─┐
                    ▲                                  │
                    └──────────────────────────────────┘
```

- **idle** — 房间已创建，尚未监听
- **waiting** — 接受玩家加入；达到 `minPlayers` 后自动开始
- **playing** — 正在进行一手牌，操作计时器运行中
- **settling** — 通过 ChipProvider 处理筹码加款/扣款
- **between-hands** — 可配置的等待时间（默认 10 秒），然后开始下一手
- **closed** — 房间关闭

## 玩家状态机

```
joined → seated → playing → seated（下一手）
                     │
                     ├→ sit-out → seated
                     ├→ disconnected →（60秒内重连）→ playing/seated
                     │                 （超时）→ left
                     └→ left
```

- **disconnected**：检测到 WebSocket 关闭，60 秒重连窗口
- **sit-out**：自愿暂离，跳过下一手但保留座位
- **left**：永久离开，若在游戏中离开会扣信用分

## 筹码协议（实时扣款/加款）

筹码在下注时立即扣除，赢牌时立即到账。无托管，无结算等待。

```
玩家下注 50  →  chipProvider.debit(50)   →  余额: 450
玩家赢得底池 →  chipProvider.credit(150) →  余额: 600
```

### 提供者

| 类型 | 配置 | 用途 |
|------|------|------|
| `http` | `{ type: 'http', url, authToken }` | HTTP 积分服务。CLI 不传 URL 时自动启动内置服务。`examples/points-server` 提供带审计日志的独立版本。 |
| `evm` | `{ type: 'evm', rpcUrl, chainId, contractAddress }` | 以太坊 / Polygon / BSC |
| `solana` | `{ type: 'solana', rpcUrl, programId }` | Solana 主网 / 测试网 |

所有筹码操作在 DealerNode 中都使用 `await`。失败会记录日志，不会被静默吞掉。

### 佣金

荷官每手牌从每个玩家收取固定费用：
1. 开始时：从每个玩家 `debit(commission)`
2. 结束时：将总佣金 `credit()` 到荷官账户

佣金不从底池中扣除，是单独收取的。

## 查询协议

玩家可以随时通过现有的 WebSocket 连接向荷官请求信息：

```
玩家 → 荷官:  { type: 'query', payload: { queryType, nonce }, from: playerId }
荷官 → 玩家:  { type: 'query-result', payload: { queryType, nonce, ...数据 } }
```

| 查询类型 | 返回内容 |
|---------|---------|
| `my-balance` | 玩家自己的筹码余额 |
| `room-state` | 房间阶段、已打局数、所有玩家的状态和筹码 |
| `table-state` | 当前游戏公共状态（底池、下注额、公共牌等） |
| `room-config` | 房间配置（游戏类型、买入、最小/最大下注、佣金） |
| `my-status` | 玩家座位状态、筹码余额、信用分 |

安全保障：
- 验证连接身份（伪造的 playerId 会被拒绝）
- 永远不暴露私密数据（牌组、其他玩家手牌、密钥）
- 与操作共享速率限制
- 每次查询 5 秒超时
- 基于 nonce 的请求/响应匹配

## 消息类型

### 荷官 → 玩家

| 类型 | 时机 | 内容 |
|------|------|------|
| `join-response` | 加入请求后 | `{ accepted, reason?, roomConfig?, players? }` |
| `game-start` | 开始一手牌 | `{ playerCommitments, publicCommitments, allCommitments, dealerEncryptPubKey }` |
| `your-turn` | 轮到你 | `{ validActions（含费用/是否负担得起）, chipBalance, phase, warning? }` |
| `action-result` | 任何有效操作后 | `{ action, accepted, phase, currentPlayerIndex, publicState }` |
| `action-rejected` | 无效操作（仅发给操作者） | `{ action, reason }` |
| `phase-deal` | 发出新公共牌 | `{ phase, commitments, communityCards }` |
| `new-card` | 给玩家发额外牌 | `{ commitment }` |
| `game-end` | 一手结束 | `{ result: { winners, pointChanges, commission }, reveals }` |
| `timeout-action` | 玩家超时 | `{ action, reason }` |
| `kicked` | 余额不足 | `{ reason }` |
| `query-result` | 查询响应 | `{ queryType, nonce, ...数据 }` |
| `query-error` | 查询失败 | `{ error, nonce }` |

### 玩家 → 荷官

| 类型 | 时机 | 内容 |
|------|------|------|
| `join-request` | 连接时 | `{ playerInfo, npmVersion }` |
| `action` | 轮到你时 | PlayerAction (`{ playerId, type, payload? }`) |
| `query` | 随时 | `{ queryType, nonce }` |

## PendingAction 系统

插件从 `applyAction()` 返回 `pendingActions`，由引擎和荷官节点分别处理：

| PendingAction 类型 | 处理者 |
|-------------------|--------|
| `deal-phase` | GameEngine — 发下一阶段的牌（翻牌/转牌/河牌） |
| `deal-to-player` | GameEngine — 给指定玩家发 N 张牌 |
| `debit` | DealerNode — 调用 chipProvider.debit() |
| `credit` | DealerNode — 调用 chipProvider.credit() |

这保持了游戏逻辑的纯净：插件说"从这个玩家扣 50"，基础设施负责执行。

## GamePlugin 接口

```typescript
interface GamePlugin {
  meta: { name, displayName, minPlayers, maxPlayers, version };

  createGame(players, options?): GameState;       // 初始状态
  createDeck(): Card[];                           // 该游戏的完整牌组
  getDealPlan(state): DealPlan[];                 // 谁在什么时候拿牌
  validateAction(state, action): boolean;         // 这个操作合法吗？
  applyAction(state, action): ApplyActionResult;  // 执行操作，返回新状态 + pendingActions
  isGameOver(state): boolean;                     // 这手牌结束了吗？
  getResult(state): GameResult;                   // 赢家、积分变化、佣金
  getValidActions(state): PlayerAction[];          // 当前玩家可以做什么？
  getPublicState(state): Record<string, unknown>; // 每次操作后广播给所有玩家

  // 可选：
  getAutoAction?(state, playerId): PlayerAction;  // 超时时的默认操作
  getStartActions?(state): PendingAction[];       // 开局的盲注、前注
  postDeal?(state): GameState;                    // 发牌后逻辑（如21点的窥牌规则）
}
```

## 安全总结

| 层级 | 机制 |
|------|------|
| 牌的公平性 | SHA-256 承诺-揭示 + X25519 逐玩家加密 |
| 身份认证 | Ed25519 密钥对，4 步签名握手 |
| 防重放 | 15 秒时间窗口 + 随机 32 字节挑战 |
| 传输层 | 通过 Cloudflare Tunnel 的 WSS（TLS） |
| 筹码服务 | Bearer token 鉴权、输入校验、速率限制、追加写入审计日志 |
| 操作 | 每玩家速率限制（默认 10 次/秒），拒绝断线玩家的操作 |
| 查询 | 连接身份验证，不暴露私密数据 |
| URL 校验 | 屏蔽内网 IP，非本地连接要求 TLS，拒绝 URL 中的凭据 |
