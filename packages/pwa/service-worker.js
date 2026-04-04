// JackClaw PWA Service Worker
// 功能：离线缓存 + Web Push 推送通知
// 版本管理：更新 CACHE_VERSION 触发重新安装

const CACHE_VERSION = 'v2'
const STATIC_CACHE  = `jackclaw-static-${CACHE_VERSION}`
const API_CACHE     = `jackclaw-api-${CACHE_VERSION}`
const PUSH_CACHE    = `jackclaw-push-${CACHE_VERSION}`

// ── 静态资源缓存列表（App Shell）─────────────────────────────────────────────
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/offline.html',
]

// ── API 路径前缀（按需缓存）──────────────────────────────────────────────────
const API_CACHE_PATHS = [
  '/api/nodes',
  '/api/summary',
]

// ── Install: 预缓存 App Shell ─────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', CACHE_VERSION)
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())  // 立即激活新版本
  )
})

// ── Activate: 清理旧版本缓存 ───────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', CACHE_VERSION)
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(k => k !== STATIC_CACHE && k !== API_CACHE && k !== PUSH_CACHE)
        .map(k => {
          console.log('[SW] Deleting old cache:', k)
          return caches.delete(k)
        })
    )).then(() => self.clients.claim())  // 立即接管所有 clients
  )
})

// ── Fetch: 缓存策略路由 ────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 非 GET 请求（POST/PUT/DELETE）直接透传，不缓存
  if (request.method !== 'GET') return

  // API 请求：Network First（联网优先，离线降级返回缓存）
  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request, API_CACHE))
    return
  }

  // 静态资源：Cache First（缓存优先）
  event.respondWith(cacheFirst(request, STATIC_CACHE))
})

// ── Cache First 策略 ──────────────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    // 离线且无缓存时，返回离线页面
    return caches.match('/offline.html')
  }
}

// ── Network First 策略 ────────────────────────────────────────────────────────
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      // API 缓存设置最大数量（LRU 简化版）
      cache.put(request, response.clone())
    }
    return response
  } catch {
    // 网络失败，降级到缓存
    const cached = await caches.match(request)
    if (cached) {
      console.log('[SW] Offline, serving cached API response for:', request.url)
      return cached
    }
    // 连缓存都没有，返回标准 JSON 错误
    return new Response(
      JSON.stringify({ error: 'Offline', cached: false }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// ── 判断是否为 API 请求 ────────────────────────────────────────────────────────
function isApiRequest(url) {
  return API_CACHE_PATHS.some(path => url.pathname.startsWith(path))
}

// ── Push 通知处理 ─────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  console.log('[SW] Push received')

  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'JackClaw', body: event.data?.text() ?? '新消息' }
  }

  const {
    title   = 'JackClaw CEO',
    body    = '有新的团队汇报',
    url     = '/',
    icon    = '/icons/icon-192.png',
    badge   = '/icons/badge-72.png',
    tag     = 'jackclaw-report',
    priority = 'normal',
    reportId,
    nodeId,
    nodeName,
  } = data

  // 根据优先级选择通知配置
  const isUrgent = priority === 'urgent' || priority === 'high'

  const notificationOptions = {
    body,
    icon,
    badge,
    tag,
    // 重要汇报震动提醒
    vibrate: isUrgent ? [200, 100, 200, 100, 400] : [100, 50, 100],
    // 持久化（不自动消失）
    requireInteraction: isUrgent,
    // 通知数据（用于 notificationclick）
    data: { url, reportId, nodeId, nodeName, priority },
    // 操作按钮
    actions: buildActions(data),
    // 静默通知标志
    silent: false,
    // 时间戳
    timestamp: Date.now(),
  }

  event.waitUntil(
    self.registration.showNotification(title, notificationOptions)
  )
})

// ── 构建通知操作按钮 ──────────────────────────────────────────────────────────
function buildActions(data) {
  const actions = []

  if (data.hasApproval) {
    actions.push(
      { action: 'approve', title: '✅ 批准' },
      { action: 'reject',  title: '❌ 驳回' }
    )
  } else {
    actions.push(
      { action: 'view',    title: '📋 查看详情' },
      { action: 'dismiss', title: '稍后处理' }
    )
  }

  return actions
}

// ── 通知点击处理 ───────────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event
  const { url, reportId, nodeId, priority } = notification.data ?? {}

  notification.close()

  // 快捷操作：直接审批（无需打开 App）
  if (action === 'approve' && reportId) {
    event.waitUntil(quickApprove(reportId, 'approved'))
    return
  }

  if (action === 'reject' && reportId) {
    event.waitUntil(quickApprove(reportId, 'rejected'))
    return
  }

  if (action === 'dismiss') return

  // 默认：打开或聚焦到对应页面
  const targetUrl = url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // 已有窗口则聚焦并导航
        for (const client of windowClients) {
          if ('focus' in client) {
            client.focus()
            client.navigate(targetUrl)
            return
          }
        }
        // 无窗口则新开
        return clients.openWindow(targetUrl)
      })
  )
})

// ── 快捷审批（不打开 App 直接处理）──────────────────────────────────────────
async function quickApprove(reportId, status) {
  try {
    // 从 cache 获取 Hub URL 和 token 配置
    const configResponse = await caches.match('/__jackclaw__/config')
    const config = configResponse ? await configResponse.json() : {}
    const { hubUrl, token } = config

    if (!hubUrl || !token) {
      console.warn('[SW] quickApprove: Hub config not found, opening app...')
      await clients.openWindow(`/approvals?id=${reportId}`)
      return
    }

    const res = await fetch(`${hubUrl}/api/approvals/${reportId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    })

    if (res.ok) {
      // 显示确认通知
      await self.registration.showNotification('JackClaw', {
        body: status === 'approved' ? '✅ 已批准' : '❌ 已驳回',
        icon: '/icons/icon-192.png',
        tag: 'jackclaw-quickaction',
        silent: true,
      })
    }
  } catch (err) {
    console.error('[SW] quickApprove failed:', err)
    await clients.openWindow(`/approvals?id=${reportId}`)
  }
}

// ── 通知关闭事件 ───────────────────────────────────────────────────────────────
self.addEventListener('notificationclose', (event) => {
  // 可用于统计 dismiss 率
  console.log('[SW] Notification closed:', event.notification.tag)
})

// ── Background Sync（任务委派失败重试）───────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'jackclaw-task-sync') {
    event.waitUntil(syncPendingTasks())
  }
})

async function syncPendingTasks() {
  // 从 IndexedDB 读取待同步任务
  // （完整实现需引入 idb 库，此处为结构占位）
  console.log('[SW] Syncing pending tasks...')
}

// ── Periodic Background Sync（定期拉取汇报）──────────────────────────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'jackclaw-daily-summary') {
    event.waitUntil(prefetchDailySummary())
  }
})

async function prefetchDailySummary() {
  try {
    const configResponse = await caches.match('/__jackclaw__/config')
    const config = configResponse ? await configResponse.json() : {}
    const { hubUrl, token } = config
    if (!hubUrl || !token) return

    const today = new Date().toISOString().slice(0, 10)
    const res = await fetch(`${hubUrl}/api/summary?date=${today}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })

    if (res.ok) {
      const cache = await caches.open(API_CACHE)
      cache.put(new Request(`${hubUrl}/api/summary?date=${today}`), res.clone())
      console.log('[SW] Daily summary prefetched for', today)
    }
  } catch (err) {
    console.warn('[SW] Prefetch failed:', err)
  }
}

// ── 消息处理（主线程 ↔ SW 通信）─────────────────────────────────────────────
self.addEventListener('message', (event) => {
  const { type, payload } = event.data ?? {}

  switch (type) {
    case 'SAVE_CONFIG':
      // 主线程发来 Hub URL + Token，缓存供离线使用
      caches.open(PUSH_CACHE).then(cache => {
        const response = new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' }
        })
        cache.put('/__jackclaw__/config', response)
      })
      break

    case 'SKIP_WAITING':
      self.skipWaiting()
      break

    case 'GET_VERSION':
      event.source?.postMessage({ type: 'VERSION', version: CACHE_VERSION })
      break

    default:
      console.log('[SW] Unknown message:', type)
  }
})

console.log('[SW] JackClaw Service Worker loaded', CACHE_VERSION)
