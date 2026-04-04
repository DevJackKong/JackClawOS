/**
 * JackClaw Push Manager
 * Web Push 通知管理：权限请求、订阅、显示通知
 */

;(function(global) {
  'use strict'

  const PushManager = {
    // VAPID 公钥（由服务端配置，主线程启动时通过 init() 传入）
    _vapidKey: '',
    _swReg: null,

    /**
     * 初始化：传入 VAPID 公钥，并等待 SW 就绪
     * @param {string} vapidPublicKey  base64url 格式的 VAPID 公钥
     */
    async init(vapidPublicKey) {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('[PushManager] 当前环境不支持 Web Push')
        return false
      }
      this._vapidKey = vapidPublicKey || ''
      this._swReg    = await navigator.serviceWorker.ready
      return true
    },

    /**
     * 请求通知权限
     * @returns {'granted'|'denied'|'default'}
     */
    async requestPermission() {
      if (!('Notification' in window)) {
        console.warn('[PushManager] 浏览器不支持 Notification API')
        return 'denied'
      }
      if (Notification.permission === 'granted') return 'granted'
      const result = await Notification.requestPermission()
      console.log('[PushManager] Permission:', result)
      return result
    },

    /**
     * 订阅 Push 端点并上报到服务端
     * @param {string} hubUrl   JackClaw Hub URL
     * @param {string} token    JWT 令牌
     * @returns {PushSubscription|null}
     */
    async subscribe(hubUrl, token) {
      if (!this._swReg) {
        console.error('[PushManager] SW 未就绪，请先调用 init()')
        return null
      }

      const permission = await this.requestPermission()
      if (permission !== 'granted') return null

      try {
        // 如已有订阅则复用
        let subscription = await this._swReg.pushManager.getSubscription()

        if (!subscription && this._vapidKey) {
          subscription = await this._swReg.pushManager.subscribe({
            userVisibleOnly:      true,
            applicationServerKey: urlBase64ToUint8Array(this._vapidKey),
          })
          console.log('[PushManager] New subscription created')
        }

        if (!subscription) {
          console.warn('[PushManager] No VAPID key — skipping subscribe')
          return null
        }

        // 上报订阅到服务端
        if (hubUrl) {
          await this._reportSubscription(subscription, hubUrl, token)
        }

        // 同步给 SW，让它可以做 quickApprove 等操作
        if (this._swReg.active && hubUrl && token) {
          this._swReg.active.postMessage({
            type:    'SAVE_CONFIG',
            payload: { hubUrl, token },
          })
        }

        return subscription
      } catch (err) {
        console.error('[PushManager] subscribe error:', err)
        return null
      }
    },

    /**
     * 取消订阅
     */
    async unsubscribe() {
      if (!this._swReg) return false
      try {
        const sub = await this._swReg.pushManager.getSubscription()
        if (sub) {
          await sub.unsubscribe()
          console.log('[PushManager] Unsubscribed')
          return true
        }
      } catch (err) {
        console.error('[PushManager] unsubscribe error:', err)
      }
      return false
    },

    /**
     * 获取当前订阅状态
     * @returns {{ subscribed: boolean, endpoint: string|null }}
     */
    async getStatus() {
      if (!this._swReg) return { subscribed: false, endpoint: null }
      const sub = await this._swReg.pushManager.getSubscription()
      return {
        subscribed: !!sub,
        endpoint:   sub ? sub.endpoint : null,
      }
    },

    /**
     * 显示本地通知（无需服务端推送，适合调试/即时提醒）
     * @param {string}  title
     * @param {object}  opts  { body, icon, tag, url, urgent }
     */
    async showLocalNotification(title, opts = {}) {
      if (!this._swReg) return
      const permission = await this.requestPermission()
      if (permission !== 'granted') return

      const {
        body   = '',
        icon   = '/icons/icon-192.png',
        badge  = '/icons/badge-72.png',
        tag    = 'jackclaw-local',
        url    = '/',
        urgent = false,
      } = opts

      await this._swReg.showNotification(title, {
        body,
        icon,
        badge,
        tag,
        vibrate:            urgent ? [200, 100, 200, 100, 400] : [100, 50, 100],
        requireInteraction: urgent,
        silent:             false,
        timestamp:          Date.now(),
        data:               { url },
        actions: [
          { action: 'view',    title: '查看' },
          { action: 'dismiss', title: '关闭' },
        ],
      })
    },

    /**
     * 显示消息通知（适合聊天场景）
     * @param {object} msg { from, avatar, content, chatId, url }
     */
    async showMessageNotification(msg) {
      const {
        from    = 'JackClaw',
        content = '新消息',
        icon    = msg.avatar || '/icons/icon-192.png',
        chatId,
        url     = '/',
      } = msg

      await this.showLocalNotification(from, {
        body:   content,
        icon,
        tag:    `jackclaw-chat-${chatId || 'default'}`,
        url,
        urgent: false,
      })
    },

    // ── 私有：上报订阅到服务端 ─────────────────────────────────────────────
    async _reportSubscription(subscription, hubUrl, token) {
      try {
        const headers = { 'Content-Type': 'application/json' }
        if (token) headers['Authorization'] = 'Bearer ' + token

        const res = await fetch(hubUrl + '/api/push/subscribe', {
          method:  'POST',
          headers,
          body:    JSON.stringify({ subscription }),
        })
        if (res.ok) {
          console.log('[PushManager] Subscription reported to server')
        } else {
          console.warn('[PushManager] Server returned:', res.status)
        }
      } catch (err) {
        console.warn('[PushManager] Failed to report subscription:', err)
        // 不阻断流程，订阅本地已成功
      }
    },
  }

  // ── base64url → Uint8Array（VAPID 公钥解码）──────────────────────────────
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = atob(base64)
    const output  = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; i++) {
      output[i] = rawData.charCodeAt(i)
    }
    return output
  }

  // 挂载到全局
  global.JackClawPush = PushManager

})(typeof globalThis !== 'undefined' ? globalThis : window)
