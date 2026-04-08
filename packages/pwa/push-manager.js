/**
 * JackClaw Push Manager
 */

;(function(global) {
  'use strict'

  const DEFAULT_VAPID_PUBLIC_KEY = global.JACKCLAW_VAPID_PUBLIC_KEY || ''

  const PushManager = {
    _vapidKey: DEFAULT_VAPID_PUBLIC_KEY,
    _swReg: null,
    _nodeId: '',
    _currentHubUrl: '',
    _currentToken: '',

    async init(vapidPublicKey) {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('[PushManager] 当前环境不支持 Web Push')
        return false
      }

      this._vapidKey = vapidPublicKey || localStorage.getItem('jackclaw_vapid_key') || DEFAULT_VAPID_PUBLIC_KEY || ''
      this._swReg = await navigator.serviceWorker.ready
      this._nodeId = this._getOrCreateNodeId()
      this._bindServiceWorkerMessages()
      return true
    },

    async initFromHub(hubUrl, token) {
      this._currentHubUrl = (hubUrl || '').replace(/\/$/, '')
      this._currentToken = token || ''

      try {
        const headers = this._currentToken ? { Authorization: 'Bearer ' + this._currentToken } : {}
        const res = await fetch(this._currentHubUrl + '/api/push/vapid-key', { headers })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const { publicKey } = await res.json()
        if (publicKey) {
          localStorage.setItem('jackclaw_vapid_key', publicKey)
        }
        return await this.init(publicKey || this._vapidKey)
      } catch (err) {
        console.warn('[PushManager] initFromHub failed, fallback to cached key:', err)
        return await this.init(localStorage.getItem('jackclaw_vapid_key') || this._vapidKey)
      }
    },

    _bindServiceWorkerMessages() {
      if (this._swBound) return
      this._swBound = true

      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type, url } = event.data || {}
        if (type === 'NOTIFICATION_CLICK' && url) {
          window.location.href = url
        }
      })
    },

    _getOrCreateNodeId() {
      const KEY = 'jackclaw_pwa_node_id'
      let id = localStorage.getItem(KEY)
      if (!id) {
        id = 'pwa-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
        localStorage.setItem(KEY, id)
      }
      return id
    },

    async requestPermission() {
      if (!('Notification' in window)) {
        console.warn('[PushManager] 浏览器不支持 Notification API')
        return 'denied'
      }
      if (Notification.permission === 'granted') return 'granted'
      return Notification.requestPermission()
    },

    async subscribe(hubUrl, token) {
      if (hubUrl) this._currentHubUrl = hubUrl.replace(/\/$/, '')
      if (typeof token === 'string') this._currentToken = token

      if (!this._swReg) {
        await this.init(this._vapidKey)
      }
      if (!this._swReg) return null

      const permission = await this.requestPermission()
      if (permission !== 'granted') return null

      try {
        let subscription = await this._swReg.pushManager.getSubscription()

        if (subscription && this._vapidKey) {
          const currentKey = subscription.options?.applicationServerKey
          const nextKey = urlBase64ToUint8Array(this._vapidKey)
          if (currentKey && !sameUint8Array(new Uint8Array(currentKey), nextKey)) {
            await subscription.unsubscribe()
            subscription = null
          }
        }

        if (!subscription) {
          if (!this._vapidKey) throw new Error('缺少 VAPID 公钥')
          subscription = await this._swReg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(this._vapidKey),
          })
        }

        if (this._currentHubUrl) {
          await this._reportSubscription(subscription, this._currentHubUrl, this._currentToken)
        }

        if (this._swReg.active) {
          this._swReg.active.postMessage({
            type: 'SAVE_CONFIG',
            payload: { hubUrl: this._currentHubUrl, token: this._currentToken },
          })
        }

        return subscription
      } catch (err) {
        console.error('[PushManager] subscribe error:', err)
        return null
      }
    },

    async unsubscribe(hubUrl, token) {
      if (hubUrl) this._currentHubUrl = hubUrl.replace(/\/$/, '')
      if (typeof token === 'string') this._currentToken = token
      if (!this._swReg) await this.init(this._vapidKey)
      if (!this._swReg) return false

      try {
        const sub = await this._swReg.pushManager.getSubscription()
        if (!sub) return true

        if (this._currentHubUrl) {
          await this._removeSubscription(sub, this._currentHubUrl, this._currentToken)
        }

        await sub.unsubscribe()
        return true
      } catch (err) {
        console.error('[PushManager] unsubscribe error:', err)
        return false
      }
    },

    async getStatus() {
      if (!this._swReg) {
        await this.init(this._vapidKey)
      }
      if (!this._swReg) return { subscribed: false, endpoint: null, permission: 'unsupported' }

      const sub = await this._swReg.pushManager.getSubscription()
      return {
        subscribed: !!sub,
        endpoint: sub ? sub.endpoint : null,
        permission: Notification.permission,
      }
    },

    async showLocalNotification(title, opts = {}) {
      if (!this._swReg) return
      const permission = await this.requestPermission()
      if (permission !== 'granted') return

      const {
        body = '',
        icon = '/icons/icon-192.png',
        badge = '/icons/icon-192.png',
        tag = 'jackclaw-local',
        url = '/',
        urgent = false,
        chatId = '',
      } = opts

      await this._swReg.showNotification(title, {
        body,
        icon,
        badge,
        tag,
        vibrate: urgent ? [200, 100, 200, 100, 400] : [100, 50, 100],
        requireInteraction: urgent,
        silent: false,
        timestamp: Date.now(),
        data: { url: normalizeTargetUrl(url, chatId), chatId },
        actions: [
          { action: 'view', title: '查看' },
          { action: 'dismiss', title: '关闭' },
        ],
      })
    },

    async showMessageNotification(msg) {
      const {
        from = 'JackClaw',
        content = '新消息',
        icon = msg.avatar || '/icons/icon-192.png',
        chatId = '',
        url = '',
      } = msg

      await this.showLocalNotification(from, {
        body: content,
        icon,
        tag: `jackclaw-chat-${chatId || 'default'}`,
        url: normalizeTargetUrl(url, chatId),
        chatId,
      })
    },

    async _reportSubscription(subscription, hubUrl, token) {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = 'Bearer ' + token

      const res = await fetch(hubUrl + '/api/push/subscribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          nodeId: this._nodeId,
          userAgent: navigator.userAgent,
          subscription,
        }),
      })

      if (!res.ok) {
        throw new Error('HTTP ' + res.status)
      }
    },

    async _removeSubscription(subscription, hubUrl, token) {
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = 'Bearer ' + token

      try {
        await fetch(hubUrl + '/api/push/unsubscribe', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            nodeId: this._nodeId,
            endpoint: subscription.endpoint,
          }),
        })
      } catch (err) {
        console.warn('[PushManager] Failed to remove subscription from server:', err)
      }
    },
  }

  function normalizeTargetUrl(url, chatId) {
    if (chatId) return `/chat?chatId=${encodeURIComponent(chatId)}`
    return url || '/'
  }

  function sameUint8Array(a, b) {
    if (!a || !b || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = atob(base64)
    const output = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) {
      output[i] = rawData.charCodeAt(i)
    }
    return output
  }

  global.JackClawPush = PushManager
})(typeof globalThis !== 'undefined' ? globalThis : window)
