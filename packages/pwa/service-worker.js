// JackClaw PWA Service Worker v4

const CACHE_VERSION = 'v4'
const STATIC_CACHE = `jackclaw-static-${CACHE_VERSION}`
const API_CACHE = `jackclaw-api-${CACHE_VERSION}`
const META_CACHE = `jackclaw-meta-${CACHE_VERSION}`

const DB_NAME = 'jackclaw-offline'
const DB_VERSION = 1
const MSG_STORE = 'outbox'
const SYNC_TAG = 'jackclaw-msg-sync'

const APP_SHELL_FILES = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/push-manager.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

const API_PREFIXES = ['/api/']
const OFFLINE_URL = '/offline.html'
const CONFIG_CACHE_KEY = '/__jackclaw__/config'

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
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = (e) => reject(e.target.error)
  })
}

async function dbPut(storeName, data) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).add(data)
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = (e) => reject(e.target.error)
  })
}

async function dbGetAll(storeName) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = (e) => reject(e.target.error)
  })
}

async function dbDelete(storeName, id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).delete(id)
    req.onsuccess = () => resolve()
    req.onerror = (e) => reject(e.target.error)
  })
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE)
    await cache.addAll(APP_SHELL_FILES)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC_CACHE, API_CACHE, META_CACHE])
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key)))
    await self.clients.claim()

    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    clientList.forEach((client) => {
      client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION })
    })
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') {
    if (isChatMessageRequest(url)) {
      event.respondWith(handleChatPost(request))
    }
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request))
    return
  }

  if (url.origin === self.location.origin && isAppShellRequest(url)) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (isApiRequest(url)) {
    event.respondWith(networkFirst(request))
    return
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request))
  }
})

function isAppShellRequest(url) {
  return (
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.json') ||
    url.pathname.startsWith('/icons/')
  )
}

function isApiRequest(url) {
  return API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) || url.pathname.includes('/api/')
}

function isChatMessageRequest(url) {
  return url.pathname.startsWith('/api/messages') || url.pathname.startsWith('/api/chat')
}

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      const cache = await caches.open(STATIC_CACHE)
      cache.put('/index.html', response.clone())
    }
    return response
  } catch {
    const cachedPage = await caches.match(request)
    if (cachedPage) return cachedPage
    const cachedIndex = await caches.match('/index.html')
    if (cachedIndex) return cachedIndex
    return (await caches.match(OFFLINE_URL)) || new Response('Offline', { status: 503 })
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response && response.ok) {
      const cache = await caches.open(STATIC_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    if (request.destination === 'document') {
      return (await caches.match(OFFLINE_URL)) || new Response('Offline', { status: 503 })
    }
    return new Response('', { status: 503, statusText: 'Offline' })
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response && response.ok) {
      const cache = await caches.open(API_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached

    if (request.mode === 'navigate') {
      return (await caches.match(OFFLINE_URL)) || new Response('Offline', { status: 503 })
    }

    return new Response(JSON.stringify({ error: 'offline', cached: false }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

async function handleChatPost(request) {
  const bodyText = await request.clone().text()

  try {
    return await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: bodyText,
    })
  } catch {
    await dbPut(MSG_STORE, {
      url: request.url,
      method: request.method,
      headers: [...request.headers.entries()].reduce((acc, [key, value]) => {
        acc[key] = value
        return acc
      }, {}),
      body: bodyText,
      createdAt: Date.now(),
    })

    if ('sync' in self.registration) {
      try {
        await self.registration.sync.register(SYNC_TAG)
      } catch (error) {
        console.warn('[SW] Sync.register failed:', error)
      }
    }

    await broadcast({ type: 'OUTBOX_UPDATED' })

    return new Response(JSON.stringify({ queued: true, offline: true }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushOutbox())
  }
  if (event.tag === 'jackclaw-task-sync') {
    event.waitUntil(syncPendingTasks())
  }
})

async function flushOutbox() {
  const messages = await dbGetAll(MSG_STORE)
  if (!messages.length) return

  for (const msg of messages) {
    try {
      const res = await fetch(msg.url, {
        method: msg.method,
        headers: msg.headers,
        body: msg.body,
      })

      if (res.ok || res.status < 500) {
        await dbDelete(MSG_STORE, msg.id)
        await broadcast({ type: 'MSG_SENT', msgId: msg.id })
      }
    } catch (error) {
      console.warn('[SW] Failed to flush message id:', msg.id, error)
    }
  }

  await broadcast({ type: 'OUTBOX_UPDATED' })
}

async function syncPendingTasks() {
  console.log('[SW] syncPendingTasks — placeholder')
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'JackClaw', body: event.data?.text() ?? '新消息' }
  }

  const {
    title = 'JackClaw',
    body = '有新消息',
    url = '/',
    icon = '/icons/icon-192.png',
    badge = '/icons/icon-192.png',
    tag = 'jackclaw-msg',
    priority = 'normal',
    reportId,
    chatId,
  } = data

  const targetUrl = normalizeTargetUrl(url, chatId)
  const isUrgent = priority === 'urgent' || priority === 'high'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      vibrate: isUrgent ? [200, 100, 200, 100, 400] : [100, 50, 100],
      requireInteraction: isUrgent,
      silent: false,
      timestamp: Date.now(),
      data: { url: targetUrl, reportId, chatId, priority },
      actions: buildActions(data),
    })
  )
})

function buildActions(data) {
  if (data.hasApproval) {
    return [
      { action: 'approve', title: '✅ 批准' },
      { action: 'reject', title: '❌ 驳回' },
    ]
  }
  return [
    { action: 'view', title: '查看' },
    { action: 'dismiss', title: '稍后' },
  ]
}

self.addEventListener('notificationclick', (event) => {
  const { action, notification } = event
  const { url, reportId, chatId } = notification.data ?? {}
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

  const targetUrl = normalizeTargetUrl(url, chatId)
  event.waitUntil(openOrFocusClient(targetUrl))
})

self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed:', event.notification.tag)
})

async function quickApprove(reportId, status) {
  try {
    const cfg = await getCachedConfig()
    if (!cfg.hubUrl || !cfg.token) {
      await openOrFocusClient(`/approvals?id=${reportId}`)
      return
    }

    const res = await fetch(`${cfg.hubUrl}/api/approvals/${reportId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ status }),
    })

    if (res.ok) {
      await self.registration.showNotification('JackClaw', {
        body: status === 'approved' ? '✅ 已批准' : '❌ 已驳回',
        icon: '/icons/icon-192.png',
        tag: 'jackclaw-quickaction',
        silent: true,
      })
    } else {
      await openOrFocusClient(`/approvals?id=${reportId}`)
    }
  } catch (error) {
    console.error('[SW] quickApprove failed:', error)
    await openOrFocusClient(`/approvals?id=${reportId}`)
  }
}

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
    const request = new Request(`${hubUrl}/api/summary?date=${today}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const res = await fetch(request)

    if (res.ok) {
      const cache = await caches.open(API_CACHE)
      cache.put(request, res.clone())
    }
  } catch (error) {
    console.warn('[SW] Prefetch failed:', error)
  }
}

self.addEventListener('message', (event) => {
  const { type, payload } = event.data ?? {}

  switch (type) {
    case 'SAVE_CONFIG':
      event.waitUntil(saveConfig(payload))
      break

    case 'SKIP_WAITING':
      self.skipWaiting()
      break

    case 'GET_VERSION':
      event.source?.postMessage({ type: 'VERSION', version: CACHE_VERSION })
      break

    case 'GET_OUTBOX_COUNT':
      event.waitUntil(postOutboxCount(event.source))
      break

    case 'FLUSH_OUTBOX':
      event.waitUntil(flushOutbox())
      break

    default:
      console.log('[SW] Unknown message:', type)
  }
})

async function saveConfig(payload = {}) {
  const cache = await caches.open(META_CACHE)
  await cache.put(CONFIG_CACHE_KEY, new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  }))
}

async function getCachedConfig() {
  try {
    const cache = await caches.open(META_CACHE)
    const res = await cache.match(CONFIG_CACHE_KEY)
    if (res) return await res.json()
  } catch {}
  return {}
}

async function postOutboxCount(target) {
  const msgs = await dbGetAll(MSG_STORE)
  target?.postMessage({ type: 'OUTBOX_COUNT', count: msgs.length })
}

async function broadcast(message) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  clientList.forEach((client) => client.postMessage(message))
}

function normalizeTargetUrl(url, chatId) {
  if (chatId) {
    return `/chat?chatId=${encodeURIComponent(chatId)}`
  }
  if (!url) return '/'
  return url
}

async function openOrFocusClient(targetUrl) {
  const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of allClients) {
    const currentUrl = new URL(client.url)
    if (currentUrl.pathname === new URL(targetUrl, self.location.origin).pathname && 'focus' in client) {
      await client.focus()
      if ('navigate' in client) await client.navigate(targetUrl)
      client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl })
      return
    }
  }

  const opened = await clients.openWindow(targetUrl)
  opened?.postMessage?.({ type: 'NOTIFICATION_CLICK', url: targetUrl })
}

console.log('[SW] JackClaw Service Worker loaded', CACHE_VERSION)
