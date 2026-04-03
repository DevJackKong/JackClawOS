# 持久化存储指南

JackClaw 采用分层存储架构，每层各有职责。本文档说明默认存储方式、文件持久化方案和 SQLite 生产级方案的配置。

---

## 默认存储方式

JackClaw 开箱即用，**无需任何配置**，自动使用以下存储层：

```
请求 → L1 In-Memory Cache（毫秒级会话缓存）
            ↓ 持久化
       L2 SQLite（~/.jackclaw/memory.db，本地磁盘）
            ↓ 同步（可选）
       L3 Hub Network（多节点共享，需配置 Hub URL）
```

| 层 | 类型 | 默认路径 | 生命周期 |
|----|------|----------|----------|
| L1 | In-Memory Map | 进程内存 | 进程退出即清空 |
| L2 | SQLite WAL | `~/.jackclaw/memory.db` | 永久，本地磁盘 |
| L3 | REST API | Hub 服务端（`JACKCLAW_HUB_URL`） | 永久，网络共享 |

MemoryManager（新系统）使用 JSON 文件存储：

| 文件 | 内容 |
|------|------|
| `~/.jackclaw/memory/<nodeId>/private.json` | Agent 私有记忆 |
| `~/.jackclaw/memory/<nodeId>/shared.json` | 共享记忆（可同步到 Hub） |
| `~/.jackclaw/memory/<nodeId>/teaching/<sessionId>.json` | 技能教学会话 |
| `~/.jackclaw/snapshots/teaching-<sessionId>.json` | 教学快照存档 |

---

## 方案一：文件持久化（简单，适合开发和个人使用）

MemoryManager 默认使用文件存储，**零配置开箱即用**。

### 特点

- 无需数据库服务
- 人类可读（JSON 格式）
- 支持语义搜索（TF-IDF，无需调用 API）
- 自动压缩：超过 200 条或 25KB 时自动合并相似条目

### 基本用法

```typescript
import { MemoryManager } from '@jackclaw/memory'

const mem = new MemoryManager()
// 默认存储路径：~/.jackclaw/memory/

// 保存记忆
mem.save({
  nodeId: 'agent-1',
  type: 'feedback',           // 'user' | 'feedback' | 'project' | 'reference'
  scope: 'private',           // 'private' | 'shared' | 'teaching'
  content: '复杂查询应先写入临时表再聚合，直接聚合大表会超时',
  why: '生产环境曾因此导致查询超时 30 秒',
  howToApply: '当 SQL 涉及 JOIN + GROUP BY 超过 10 万行时触发',
  tags: ['sql', 'performance'],
})

// 查询记忆
const results = mem.query('agent-1', {
  type: 'feedback',
  tags: ['sql'],
})

// 语义搜索（TF-IDF，无需网络）
const semantic = await mem.semanticQuery('agent-1', '数据库查询优化', 5)

// 查看统计
const stats = mem.stats('agent-1')
console.log(`共 ${stats.totalEntries} 条，${stats.totalChars} 字符`)
if (stats.limitWarning) console.warn('记忆条目过多，建议清理')
```

### 自定义存储路径

```typescript
import { MemoryManager } from '@jackclaw/memory'

// 指定自定义数据目录
const mem = new MemoryManager('/path/to/my/data')
```

### .env 配置（可选）

```env
# 自定义 Memory 根目录（默认 ~/.jackclaw/memory）
JACKCLAW_MEMORY_DIR=/var/data/jackclaw/memory
```

---

## 方案二：SQLite 持久化（生产级，推荐）

L2Store 使用 `better-sqlite3`，支持 WAL 模式，适合生产环境。

### 特点

- WAL 模式：并发读写安全
- 支持索引查询（agentId、category、scope、importance）
- 支持 tag 过滤、重要性阈值过滤
- 与 L1 Cache 透明集成，L1 未命中自动查 L2

### 安装依赖

```bash
npm install better-sqlite3
# TypeScript 类型
npm install -D @types/better-sqlite3
```

### 基本用法

```typescript
import { L2Store, L1Cache } from '@jackclaw/memory'

// L2 SQLite 存储
const store = new L2Store()
// 默认路径：~/.jackclaw/memory.db

// 保存条目
store.save({
  id: 'mem-001',
  agentId: 'agent-1',
  layer: 'L2',
  category: 'feedback',
  scope: 'private',
  content: '优先使用 TypeScript strict 模式',
  tags: ['typescript', 'quality'],
  importance: 0.8,
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

// 查询
const entries = store.query('agent-1', {
  category: 'feedback',
  minImportance: 0.5,
  tags: ['typescript'],
})

// 与 L1 Cache 联合使用（推荐）
const cache = new L1Cache()

// 先查 L1
let result = cache.get('mem-001')
if (!result) {
  // L1 未命中，查 L2
  result = store.get('mem-001')
  if (result) cache.set(result)  // 回填 L1
}
```

### 自定义 SQLite 路径

```typescript
const store = new L2Store('/var/data/jackclaw/memory.db')
```

### .env 配置

```env
# SQLite 数据库路径（默认 ~/.jackclaw/memory.db）
JACKCLAW_DB_PATH=/var/data/jackclaw/memory.db

# Hub 同步（L3，可选）
JACKCLAW_HUB_URL=http://localhost:3100
JACKCLAW_SYNC_SECRET=your-hmac-secret-here
```

---

## 方案对比

| 特性 | 文件存储（JSON） | SQLite | Hub 网络（L3） |
|------|----------------|--------|---------------|
| 配置复杂度 | 零配置 | 需安装依赖 | 需部署 Hub |
| 并发安全 | 单进程安全 | WAL 模式，高并发 | 分布式 |
| 查询能力 | 全量扫描 + TF-IDF | 索引查询 | REST API |
| 数据共享 | 单机 | 单机 | 多节点共享 |
| 适合场景 | 开发、个人 | 生产单机 | 多节点协作 |
| 数据位置 | `~/.jackclaw/memory/` | `~/.jackclaw/memory.db` | Hub 服务端 |

---

## 数据备份

### 文件存储备份

```bash
# 备份整个 memory 目录
tar -czf jackclaw-memory-$(date +%Y%m%d).tar.gz ~/.jackclaw/memory/
```

### SQLite 备份

```bash
# 在线备份（不影响运行中的服务）
sqlite3 ~/.jackclaw/memory.db ".backup /backup/memory-$(date +%Y%m%d).db"

# 或直接复制（服务停止时）
cp ~/.jackclaw/memory.db /backup/memory.db
```

### 自动定时备份（Linux/Mac）

```bash
# 编辑 crontab
crontab -e

# 每天凌晨 2 点备份
0 2 * * * tar -czf ~/backups/jackclaw-$(date +\%Y\%m\%d).tar.gz ~/.jackclaw/memory/ ~/.jackclaw/memory.db 2>/dev/null
```

---

## 记忆类型说明

保存记忆时，`type` 字段决定内容的语义分类：

| type | 用途 | 必填字段 |
|------|------|---------|
| `feedback` | Agent 的行为规则和偏好 | `why`（原因）|
| `user` | 用户背景信息 | — |
| `project` | 项目背景、决策、截止日期 | — |
| `reference` | 外部资源指针（URL、文档位置）| — |

`feedback` 类型必须提供 `why` 字段，否则 `MemoryManager.save()` 会抛出错误。

---

## 记忆压缩策略

当条目数 > 200 或总字符数 > 25,000 时，`MemoryManager` 自动触发压缩：

**压缩优先级**（先删低优先级）：
1. `reference` — 最低优先级，先压缩
2. `project`
3. `user`
4. `feedback` — 最高优先级，最后压缩

相似度 > 75%（Levenshtein + 关键词重叠）的条目会被合并，保留 importance 值更高的一条。
