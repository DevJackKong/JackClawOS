// JackClaw PWA Service Worker v3
// Workbox-style strategies (pure JS), offline message queue, background sync

const CACHE_VERSION = 'v3'
const STATIC_CACHE  = `jackclaw-static-${CACHE_VERSION}`
const API_CACHE     = `jackclaw-api-${CACHE_VERSION}`
const PUSH_CACHE    = `jackclaw-push-${CACHE_VERSION}`

const DB_NAME    = 'jackclaw-offline'
const DB_VERSION = 1
const MSG_STORE  = 'outbox'   // offline message queue
const SYNC_TAG   = 'jackclaw-msg-sync'

// ── App Shell（Cache-first 静态资源）──────────────────────────────────────────
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

// ── API 路径前缀（Network-first）─────────────────────────────────────────────
const API_PREFIXES = ['/api/']

// ══════════════════════════════════════════════════════════════════════════════
// IndexedDB helpers（无第三方依赖）
// ══════════════════════════════════════════════════════════════════════════════

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(MSG_STORE)) {
        const store = db.createObjectStore(MSG_STORE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('createdAt', 'createdAt')
      }
    }
    req.onsuccess  = (e) => resolve(e.target.result)
    req.onerror    = (e) => reject(e.target.error)
  })
}

async function dbPut(storeName, data) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx   = db.transaction(storeName, 'readwrite')
    const req  = tx.objectStore(storeName).add(data)
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

async function dbGetAll(storeName) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx   = db.transaction(storeName, 'readonly')
    const req  = tx.objectStore(storeName).getAll()
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

async function dbDelete(storeName, id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx   = db.transaction(storeName, 'readwrite')
    const req  = tx.objectStore(storeName).delete(id)
    req.onsuccess = () => resolve()
    req.onerror   = (e) => reject(e.target.error)
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// Install — 预缓存 App Shell
// ══════════════════════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  console.log('[SW] Installing', CACHE_VERSION)
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  )
})

// ══════════════════════════════════════════════════════════════════════════════
// Activate — 清理旧版本缓存
// ══════════════════════════════════════════════════════════════════════════════

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', CACHE_VERSION)
  const keep = new Set([STATIC_CACHE, API_CACHE, PUSH_CACHE])
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !keep.has(k)).map(k => {
          console.log('[SW] Deleting old cache:', k)
          return caches.delete(k)
        })
      ))
      .then(() => self.clients.claim())
  )
})

// ══════════════════════════════════════════════════════════════════════════════
// Fetch — 缓存策略路由
// ══════════════════════════════════════════════════════════════════════════════

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 跨域请求直接透传
  if (url.origin !== self.location.origin) return

  // 非 GET：拦截发消息的 POST 请求，其余透传
  if (request.method !== 'GET') {
    if (isChatMessageRequest(url)) {
      event.respondWith(handleChatPost(request))
    }
    return
  }

  // API（Network-first）
  if (API_PREFIXES.some(p => url.pathname.startsWith(p))) {
    event.respondWith(networkFirst(request))
    return
  }

  // 静态资源（Cache-first）
  event.respondWith(cacheFirst(request))
})

// ── 判断是否为聊天消息 POST ───────────────────────────────────────────────────
function isChatMessageRequest(url) {
  return url.pathname.startsWith('/api/messages') ||
         url.pathname.startsWith('/api/chat')
}

// ── Cache-First 策略 ──────────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const offlinePage = await caches.match('/offline.html')
    return offlinePage || new Response('Offline', { status: 503 })
  }
}

// ── Network-First 策略 ────────────────────────────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(API_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) {
      console.log('[SW] Offline fallback (cache):', request.url)
      return cached
    }
    return new Response(
      JSON.stringify({ error: 'offline', cached: false }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// ── 离线消息处理：先入 IndexedDB 队列，成功则立即透传 ────────────────────────
async function handleChatPost(request) {
  // 克隆 body（只能读一次）
  const bodyText = await request.text()

  try {
    // 有网则直接发送
    const response = await fetch(request.url, {
      method:  request.method,
      headers: request.headers,
      body:    bodyText,
    })
    return response
  } catch {
    // 离线：存入 IndexedDB outbox
    console.log('[SW] Offline — queuing message to IndexedDB')
    await dbPut(MSG_STORE, {
      url:       request.url,
      method:    request.method,
      headers:   [...request.headers.entries()].reduce((o, [k, v]) => { o[k] = v; return o }, {}),
      body:      bodyText,
      createdAt: Date.now(),
    })

    // 注册 Background Sync（若支持）
    if ('sync' in self.registration) {
      try {
        await self.registration.sync.register(SYNC_TAG)
        console.log('[SW] Background Sync registered:', SYNC_TAG)
      } catch (err) {
        console.warn('[SW] Sync.register failed:', err)
      }
    }

    return new Response(
      JSON.stringify({ queued: true, offline: true }),
      { status: 202, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Background Sync — 上线后发送离线消息队列
// ══════════════════════════════════════════════════════════════════════════════

self.addEventListener('sync', (event) => {
  console.log('[SW] Sync event:', event.tag)
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushOutbox())
  }
  if (event.tag === 'jackclaw-task-sync') {
    event.waitUntil(syncPendingTasks())
  }
})

async function flushOutbox() {
  const messages = await dbGetAll(MSG_STORE)
  if (messages.length === 0) return
  console.log('[SW] Flushing', messages.length, 'queued messages')

  for (const msg of messages) {
    try {
      const res = await fetch(msg.url, {
        method:  msg.method,
        headers: msg.headers,
        body:    msg.body,
      })
      if (res.ok || res.status < 500) {
        // 发送成功（或服务端业务错误，不重试），从队列删除
        await dbDelete(MSG_STORE, msg.id)
        console.log('[SW] Message sent, id:', msg.id)

        // 通知所有 client 刷新会话
        const clientList = await self.clients.matchAll({ type: 'window' })
        clientList.forEach(c => c.postMessage({ type: 'MSG_SENT', msgId: msg.id }))
      }
      // 5xx 错误保留队列，等下次 sync
    } catch (err) {
      console.warn('[SW] Failed to flush message id:', msg.id, err)
      // 网络异常：保留，Background Sync 会自动重试
    }
  }
}

async function syncPendingTasks() {
  console.log('[SW] syncPendingTasks — placeholder, extend as needed')
}

// ══════════════════════════════════════════════════════════════════════════════
// Push 通知
// ══════════════════════════════════════════════════════════════════════════════

self.addEventListener('push', (event) => {
  console.log('[SW] Push received')
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch {
    data = { title: 'JackClaw', body: event.data?.text() ?? '新消息' }
  }

  const {
    title    = 'JackClaw',
    body     = '有新消息',
    url      = '/',
    icon     = '/icons/icon-192.png',
    badge    = '/icons/badge-72.png',
    tag      = 'jackclaw-msg',
    priority = 'normal',
    reportId,
    chatId,
  } = data

  const isUrgent = priority === 'urgent' || priority === 'high'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      vibrate:             isUrgent ? [200, 100, 200, 100, 400] : [100, 50, 100],
      requireInteraction:  isUrgent,
      silent:              false,
      timestamp:           Date.now(),
      data:                { url, reportId, chatId, priority },
      actions:             buildActions(data),
    })
  )
})

function buildActions(data) {
  if (data.hasApproval) {
    return [
      { action: 'approve', title: '✅ 批准' },
      { action: 'reject',  title: '❌ 驳回' },
    ]
  }
  return [
    { action: 'view',    title: '查看' },
    { action: 'dismiss', title: '稍后' },
  ]
}

self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event
  const { url, reportId } = notification.data ?? {}
  notification.close()

  if (action === 'approve' && reportId) {
    event.waitUntil(quickApprove(reportId, 'approved'))
    return
  }
  if (action === 'reject' && reportId) {
    event.waitUntil(quickApprove(reportId, 'rejected'))
    return
  }
  if (action === 'dismiss') return

  const targetUrl = url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      for (const w of wins) {
        if ('focus' in w) { w.focus(); w.navigate(targetUrl); return }
      }
      return clients.openWindow(targetUrl)
    })
  )
})

self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed:', event.notification.tag)
})

async function quickApprove(reportId, status) {
  try {
    const cfg = await getCachedConfig()
    if (!cfg.hubUrl || !cfg.token) { await clients.openWindow(`/approvals?id=${reportId}`); return }

    const res = await fetch(`${cfg.hubUrl}/api/approvals/${reportId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.token}` },
      body:    JSON.stringify({ status }),
    })
    if (res.ok) {
      await self.registration.showNotification('JackClaw', {
        body: status === 'approved' ? '✅ 已批准' : '❌ 已驳回',
        icon: '/icons/icon-192.png',
        tag:  'jackclaw-quickaction',
        silent: true,
      })
    }
  } catch (err) {
    console.error('[SW] quickApprove failed:', err)
    await clients.openWindow(`/approvals?id=${reportId}`)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Periodic Background Sync
// ══════════════════════════════════════════════════════════════════════════════

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'jackclaw-daily-summary') {
    event.waitUntil(prefetchDailySummary())
  }
})

async function prefetchDailySummary() {
  try {
    const { hubUrl, token } = await getCachedConfig()
    if (!hubUrl || !token) return
    const today = new Date().toISOString().slice(0, 10)
    const res   = await fetch(`${hubUrl}/api/summary?date=${today}`, {
      headers: { 'Authorization': `Bearer ${token}` },
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

// ══════════════════════════════════════════════════════════════════════════════
// 主线程消息通信
// ══════════════════════════════════════════════════════════════════════════════

self.addEventListener('message', (event) => {
  const { type, payload } = event.data ?? {}
  switch (type) {
    case 'SAVE_CONFIG':
      caches.open(PUSH_CACHE).then(cache => {
        cache.put('/__jackclaw__/config', new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
        }))
      })
      break

    case 'SKIP_WAITING':
      self.skipWaiting()
      break

    case 'GET_VERSION':
      event.source?.postMessage({ type: 'VERSION', version: CACHE_VERSION })
      break

    case 'GET_OUTBOX_COUNT':
      dbGetAll(MSG_STORE).then(msgs => {
        event.source?.postMessage({ type: 'OUTBOX_COUNT', count: msgs.length })
      })
      break

    case 'FLUSH_OUTBOX':
      flushOutbox()
      break

    default:
      console.log('[SW] Unknown message:', type)
  }
})

// ── 读取缓存的 Hub 配置 ───────────────────────────────────────────────────────
async function getCachedConfig() {
  try {
    const res = await caches.match('/__jackclaw__/config')
    if (res) return await res.json()
  } catch {}
  return {}
}

console.log('[SW] JackClaw Service Worker loaded', CACHE_VERSION)
