---
name: jackclaw-status
description: "查看 JackClaw 团队汇报和节点状态。触发词：团队汇报、节点状态、大家进展、查看汇报"
---

# JackClaw Status Skill

调用本地 Hub API 获取团队状态。需要设置环境变量 `JACKCLAW_TOKEN`（Hub CEO JWT Token）。

## 前置条件

```bash
# 设置 Hub CEO Token（写入 ~/.zshrc 或 ~/.bashrc）
export JACKCLAW_TOKEN="eyJ..."
```

## 命令

### 今日汇报摘要（按 role 分组）
```bash
curl -s \
  -H "Authorization: Bearer $JACKCLAW_TOKEN" \
  "http://localhost:19001/api/summary?date=$(date +%Y-%m-%d)" \
  | node -e "
const d = require('fs').readFileSync('/dev/stdin','utf8');
const j = JSON.parse(d);
console.log('📅 日期:', j.date);
console.log('📊 汇报节点:', j.reportingNodes + '/' + j.totalNodes);
for (const [role, group] of Object.entries(j.byRole || {})) {
  console.log('\n🏷️  ' + role.toUpperCase());
  for (const n of group.nodes) {
    console.log('  • ' + n.name + ': ' + n.summary);
  }
}
"
```

### 所有节点状态（需要 CEO 角色 JWT）
```bash
curl -s \
  -H "Authorization: Bearer $JACKCLAW_TOKEN" \
  "http://localhost:19001/api/nodes" \
  | node -e "
const d = require('fs').readFileSync('/dev/stdin','utf8');
const j = JSON.parse(d);
console.log('🔗 注册节点数:', j.total);
for (const n of j.nodes || []) {
  const lastReport = n.lastReportAt ? new Date(n.lastReportAt).toLocaleString('zh-CN') : '从未汇报';
  const online = n.lastReportAt && (Date.now() - n.lastReportAt) < 600000 ? '🟢 在线' : '⚫ 离线';
  console.log(online + ' [' + n.role + '] ' + n.name + ' — 最后汇报: ' + lastReport);
}
"
```

### 指定日期汇报（例如昨天）
```bash
curl -s \
  -H "Authorization: Bearer $JACKCLAW_TOKEN" \
  "http://localhost:19001/api/summary?date=$(date -d 'yesterday' +%Y-%m-%d 2>/dev/null || date -v-1d +%Y-%m-%d)"
```

## 说明

| 字段 | 含义 |
|------|------|
| `byRole` | 按角色分组的汇报，key 为 role 名称 |
| `reportingNodes` | 今日已汇报节点数 |
| `totalNodes` | 已注册节点总数 |
| `visibility: private` 的汇报不会出现在 summary 中 |

## Hub 默认地址

- 本地：`http://localhost:19001`（默认端口可通过 `HUB_PORT` 环境变量修改）
