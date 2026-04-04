import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, encrypt, decrypt, sign, verify } from '../src/crypto'

describe('Protocol Crypto — Key Generation', () => {
  it('generates an RSA key pair', () => {
    const kp = generateKeyPair()
    assert.ok(kp.publicKey.startsWith('-----BEGIN RSA PUBLIC KEY-----'))
    assert.ok(kp.privateKey.startsWith('-----BEGIN RSA PRIVATE KEY-----'))
  })

  it('generates unique keys each time', () => {
    const kp1 = generateKeyPair()
    const kp2 = generateKeyPair()
    assert.notEqual(kp1.publicKey, kp2.publicKey)
    assert.notEqual(kp1.privateKey, kp2.privateKey)
  })
})

describe('Protocol Crypto — Hybrid Encryption', () => {
  const kp = generateKeyPair()

  it('encrypts and decrypts a message', () => {
    const plaintext = 'Hello, JackClaw!'
    const payload = encrypt(plaintext, kp.publicKey)

    assert.ok(payload.encryptedKey)
    assert.ok(payload.iv)
    assert.ok(payload.ciphertext)
    assert.ok(payload.authTag)

    const decrypted = decrypt(payload, kp.privateKey)
    assert.equal(decrypted, plaintext)
  })

  it('encrypts Chinese text', () => {
    const plaintext = '你好，JackClaw！这是一条加密消息。'
    const payload = encrypt(plaintext, kp.publicKey)
    const decrypted = decrypt(payload, kp.privateKey)
    assert.equal(decrypted, plaintext)
  })

  it('encrypts JSON data', () => {
    const data = JSON.stringify({ type: 'task', content: 'Deploy to prod', priority: 1 })
    const payload = encrypt(data, kp.publicKey)
    const decrypted = decrypt(payload, kp.privateKey)
    assert.equal(decrypted, data)
    assert.deepEqual(JSON.parse(decrypted), JSON.parse(data))
  })

  it('encrypts large payload', () => {
    const plaintext = 'A'.repeat(10000)
    const payload = encrypt(plaintext, kp.publicKey)
    const decrypted = decrypt(payload, kp.privateKey)
    assert.equal(decrypted, plaintext)
  })

  it('fails to decrypt with wrong key', () => {
    const kp2 = generateKeyPair()
    const payload = encrypt('secret', kp.publicKey)
    assert.throws(() => {
      decrypt(payload, kp2.privateKey)
    })
  })

  it('produces different ciphertext each time (random IV)', () => {
    const plaintext = 'Same message'
    const p1 = encrypt(plaintext, kp.publicKey)
    const p2 = encrypt(plaintext, kp.publicKey)
    assert.notEqual(p1.ciphertext, p2.ciphertext)
    assert.notEqual(p1.iv, p2.iv)
    // But both decrypt to same plaintext
    assert.equal(decrypt(p1, kp.privateKey), plaintext)
    assert.equal(decrypt(p2, kp.privateKey), plaintext)
  })
})

describe('Protocol Crypto — Signing', () => {
  const kp = generateKeyPair()

  it('signs and verifies data', () => {
    const data = 'alice:bob:1234567890:payload-hash'
    const sig = sign(data, kp.privateKey)
    assert.ok(sig)
    assert.equal(typeof sig, 'string')
    const valid = verify(data, sig, kp.publicKey)
    assert.equal(valid, true)
  })

  it('rejects tampered data', () => {
    const data = 'original message'
    const sig = sign(data, kp.privateKey)
    const valid = verify('tampered message', sig, kp.publicKey)
    assert.equal(valid, false)
  })

  it('rejects wrong public key', () => {
    const kp2 = generateKeyPair()
    const data = 'secret message'
    const sig = sign(data, kp.privateKey)
    const valid = verify(data, sig, kp2.publicKey)
    assert.equal(valid, false)
  })

  it('signs Chinese content', () => {
    const data = '发送者:接收者:时间戳:内容哈希'
    const sig = sign(data, kp.privateKey)
    assert.equal(verify(data, sig, kp.publicKey), true)
  })

  it('signs empty string', () => {
    const sig = sign('', kp.privateKey)
    assert.equal(verify('', sig, kp.publicKey), true)
    assert.equal(verify('non-empty', sig, kp.publicKey), false)
  })
})
