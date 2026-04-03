import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair } from '../src/crypto'
import { createMessage, openMessage } from '../src/message'
import type { ReportPayload } from '../src/types'

describe('createMessage / openMessage', () => {
  it('creates a valid signed+encrypted message and opens it', () => {
    const sender = generateKeyPair()
    const recipient = generateKeyPair()

    const report: ReportPayload = {
      summary: 'All systems normal',
      period: 'daily',
      visibility: 'full',
      data: { tasks: 5, completed: 4 },
    }

    const msg = createMessage(
      'node-a',
      'hub',
      'report',
      report,
      recipient.publicKey,
      sender.privateKey,
    )

    assert.equal(msg.from, 'node-a')
    assert.equal(msg.to, 'hub')
    assert.equal(msg.type, 'report')
    assert.ok(typeof msg.timestamp === 'number')
    assert.ok(msg.signature.length > 0)
    assert.ok(msg.payload.length > 0)

    // Open the message
    const result = openMessage<ReportPayload>(msg, sender.publicKey, recipient.privateKey)
    assert.deepEqual(result, report)
  })

  it('throws on tampered payload', () => {
    const sender = generateKeyPair()
    const recipient = generateKeyPair()

    const msg = createMessage('a', 'b', 'ping', { nonce: 'abc' }, recipient.publicKey, sender.privateKey)
    const tampered = { ...msg, payload: msg.payload.slice(0, -5) + 'XXXXX' }

    assert.throws(() => openMessage(tampered, sender.publicKey, recipient.privateKey))
  })

  it('throws if signature does not match sender public key', () => {
    const sender = generateKeyPair()
    const attacker = generateKeyPair()
    const recipient = generateKeyPair()

    const msg = createMessage('a', 'b', 'ack', { status: 'ok' }, recipient.publicKey, sender.privateKey)

    // Pass attacker's public key instead of sender's
    assert.throws(() => openMessage(msg, attacker.publicKey, recipient.privateKey))
  })

  it('supports all message types', () => {
    const s = generateKeyPair()
    const r = generateKeyPair()

    const types = ['report', 'task', 'ack', 'ping'] as const
    for (const type of types) {
      const msg = createMessage('n', 'h', type, { type }, r.publicKey, s.privateKey)
      assert.equal(msg.type, type)
      const out = openMessage<{ type: string }>(msg, s.publicKey, r.privateKey)
      assert.equal(out.type, type)
    }
  })
})
