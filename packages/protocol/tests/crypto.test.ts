import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, encrypt, decrypt, sign, verify } from '../src/crypto'

describe('generateKeyPair', () => {
  it('returns PEM-encoded RSA keys', () => {
    const kp = generateKeyPair()
    assert.ok(kp.publicKey.includes('-----BEGIN RSA PUBLIC KEY-----'))
    assert.ok(kp.privateKey.includes('-----BEGIN RSA PRIVATE KEY-----'))
  })

  it('generates unique keys each call', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    assert.notEqual(a.publicKey, b.publicKey)
  })
})

describe('encrypt / decrypt', () => {
  it('round-trips a plaintext string', () => {
    const kp = generateKeyPair()
    const plain = 'hello jackclaw 🦞'
    const payload = encrypt(plain, kp.publicKey)
    const result = decrypt(payload, kp.privateKey)
    assert.equal(result, plain)
  })

  it('round-trips JSON data', () => {
    const kp = generateKeyPair()
    const obj = { summary: 'daily report', count: 42, nested: { ok: true } }
    const plain = JSON.stringify(obj)
    const payload = encrypt(plain, kp.publicKey)
    const result = decrypt(payload, kp.privateKey)
    assert.deepEqual(JSON.parse(result), obj)
  })

  it('fails to decrypt with wrong private key', () => {
    const kp1 = generateKeyPair()
    const kp2 = generateKeyPair()
    const payload = encrypt('secret', kp1.publicKey)
    assert.throws(() => decrypt(payload, kp2.privateKey))
  })

  it('rejects tampered ciphertext (auth tag mismatch)', () => {
    const kp = generateKeyPair()
    const payload = encrypt('tamper test', kp.publicKey)
    // Flip a byte in the ciphertext
    const tampered = Buffer.from(payload.ciphertext, 'base64')
    tampered[0] ^= 0xff
    const badPayload = { ...payload, ciphertext: tampered.toString('base64') }
    assert.throws(() => decrypt(badPayload, kp.privateKey))
  })
})

describe('sign / verify', () => {
  it('verifies a valid signature', () => {
    const kp = generateKeyPair()
    const data = 'data to sign'
    const sig = sign(data, kp.privateKey)
    assert.equal(verify(data, sig, kp.publicKey), true)
  })

  it('rejects tampered data', () => {
    const kp = generateKeyPair()
    const sig = sign('original', kp.privateKey)
    assert.equal(verify('tampered', sig, kp.publicKey), false)
  })

  it('rejects wrong public key', () => {
    const kp1 = generateKeyPair()
    const kp2 = generateKeyPair()
    const sig = sign('data', kp1.privateKey)
    assert.equal(verify('data', sig, kp2.publicKey), false)
  })
})
