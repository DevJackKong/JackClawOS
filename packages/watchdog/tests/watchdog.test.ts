import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AnomalyDetector } from '../src/anomaly-detector'
import { AuditLog } from '../src/audit-log'

// ─── AnomalyDetector ────────────────────────────────────────────

describe('AnomalyDetector', () => {
  it('does not alert below threshold', () => {
    const ad = new AnomalyDetector()
    const result = ad.trackMessage('node-1')
    assert.equal(result, null)
  })

  it('alerts on message flood', () => {
    let alerted = false
    const ad = new AnomalyDetector({ onAlert: () => { alerted = true } })
    // Set low threshold for testing
    ad.setThreshold('messageFlood', { count: 5, windowMs: 60_000 })
    for (let i = 0; i < 4; i++) ad.trackMessage('node-flood')
    assert.equal(alerted, false)
    const alert = ad.trackMessage('node-flood')
    assert.equal(alerted, true)
    assert.ok(alert)
    assert.equal(alert!.type, 'message_flood')
    assert.equal(alert!.severity, 'critical')
    assert.equal(alert!.actor, 'node-flood')
  })

  it('alerts on login brute force', () => {
    const ad = new AnomalyDetector()
    ad.setThreshold('loginBrute', { count: 3, windowMs: 300_000 })
    ad.trackLoginFailure('192.168.1.1')
    ad.trackLoginFailure('192.168.1.1')
    const alert = ad.trackLoginFailure('192.168.1.1')
    assert.ok(alert)
    assert.equal(alert!.type, 'login_brute_force')
  })

  it('alerts on bulk export', () => {
    const ad = new AnomalyDetector()
    ad.setThreshold('bulkExport', { count: 3, windowMs: 60_000 })
    ad.trackQuery('node-q')
    ad.trackQuery('node-q')
    const alert = ad.trackQuery('node-q')
    assert.ok(alert)
    assert.equal(alert!.type, 'bulk_export')
    assert.equal(alert!.severity, 'warning')
  })

  it('getAlerts returns recent alerts', () => {
    const ad = new AnomalyDetector()
    ad.setThreshold('messageFlood', { count: 1, windowMs: 60_000 })
    ad.trackMessage('n1')
    ad.trackMessage('n2')
    const alerts = ad.getAlerts()
    assert.ok(alerts.length >= 2)
  })

  it('getAlertsBySeverity filters correctly', () => {
    const ad = new AnomalyDetector()
    ad.setThreshold('messageFlood', { count: 1, windowMs: 60_000 })
    ad.setThreshold('bulkExport', { count: 1, windowMs: 60_000 })
    ad.trackMessage('n1')   // critical
    ad.trackQuery('n2')     // warning
    assert.equal(ad.getAlertsBySeverity('critical').length, 1)
    assert.equal(ad.getAlertsBySeverity('warning').length, 1)
  })
})

// ─── AuditLog ───────────────────────────────────────────────────

describe('AuditLog', () => {
  it('appends entries with auto-incrementing id', () => {
    const log = new AuditLog()
    const e1 = log.append('auth.login', 'user-1')
    const e2 = log.append('auth.register', 'user-2')
    assert.equal(e1.id, 1)
    assert.equal(e2.id, 2)
    assert.equal(log.size, 2)
  })

  it('stores target and detail', () => {
    const log = new AuditLog()
    const e = log.append('msg.send', 'node-1', {
      target: 'node-2',
      detail: 'Sent hello',
      meta: { msgId: 'abc' },
    })
    assert.equal(e.target, 'node-2')
    assert.equal(e.detail, 'Sent hello')
    assert.deepEqual(e.meta, { msgId: 'abc' })
  })

  it('queries by action prefix', () => {
    const log = new AuditLog()
    log.append('auth.login', 'u1')
    log.append('auth.register', 'u2')
    log.append('msg.send', 'n1')
    const authEntries = log.query({ action: 'auth' })
    assert.equal(authEntries.length, 2)
    const msgEntries = log.query({ action: 'msg' })
    assert.equal(msgEntries.length, 1)
  })

  it('queries by actor', () => {
    const log = new AuditLog()
    log.append('auth.login', 'alice')
    log.append('auth.login', 'bob')
    log.append('msg.send', 'alice')
    const aliceEntries = log.query({ actor: 'alice' })
    assert.equal(aliceEntries.length, 2)
  })

  it('queries by time range', () => {
    const log = new AuditLog()
    log.append('auth.login', 'u1')
    const future = Date.now() + 100_000
    const entries = log.query({ from: future })
    assert.equal(entries.length, 0)
  })

  it('exports JSONL', () => {
    const log = new AuditLog()
    log.append('auth.login', 'u1')
    log.append('msg.send', 'n1')
    const jsonl = log.exportJSONL()
    const lines = jsonl.split('\n')
    assert.equal(lines.length, 2)
    assert.ok(JSON.parse(lines[0]).action === 'auth.login')
  })

  it('stats groups by action prefix', () => {
    const log = new AuditLog()
    log.append('auth.login', 'u1')
    log.append('auth.register', 'u2')
    log.append('msg.send', 'n1')
    const s = log.stats()
    assert.equal(s.total, 3)
    assert.equal(s.byAction['auth'], 2)
    assert.equal(s.byAction['msg'], 1)
  })

  it('respects maxEntries limit', () => {
    const log = new AuditLog({ maxEntries: 10 })
    for (let i = 0; i < 15; i++) {
      log.append('auth.login', `user-${i}`)
    }
    assert.ok(log.size <= 10)
  })
})
