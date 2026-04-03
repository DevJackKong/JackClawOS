import type {
  JackClawMessage,
  EncryptedPayload,
  KeyPair,
} from './types'
import { encrypt, decrypt, sign, verify } from './crypto'

/**
 * Canonical string for signing: deterministic serialisation of message fields
 * excluding the signature itself.
 */
function signingData(msg: Omit<JackClawMessage, 'signature'>): string {
  return JSON.stringify({
    from: msg.from,
    to: msg.to,
    type: msg.type,
    payload: msg.payload,
    timestamp: msg.timestamp,
  })
}

/**
 * Build and sign an JackClawMessage.
 *
 * @param from           Sender node ID
 * @param to             Recipient node ID
 * @param type           Message type
 * @param payloadObject  Plain object to encrypt (will be JSON-serialised)
 * @param recipientPub   Recipient's RSA public key PEM (for encryption)
 * @param senderPriv     Sender's RSA private key PEM (for signing)
 */
export function createMessage(
  from: string,
  to: string,
  type: JackClawMessage['type'],
  payloadObject: unknown,
  recipientPub: string,
  senderPriv: string,
): JackClawMessage {
  const plaintext = JSON.stringify(payloadObject)
  const encPayload: EncryptedPayload = encrypt(plaintext, recipientPub)
  const payloadStr = JSON.stringify(encPayload)

  const partial: Omit<JackClawMessage, 'signature'> = {
    from,
    to,
    type,
    payload: payloadStr,
    timestamp: Date.now(),
  }

  const signature = sign(signingData(partial), senderPriv)

  return { ...partial, signature }
}

/**
 * Verify and decrypt an JackClawMessage.
 *
 * @param msg           The received message
 * @param senderPub     Sender's RSA public key PEM (for verification)
 * @param recipientPriv Recipient's RSA private key PEM (for decryption)
 * @returns Decrypted payload as parsed object, or throws on failure
 */
export function openMessage<T = unknown>(
  msg: JackClawMessage,
  senderPub: string,
  recipientPriv: string,
): T {
  // 1. Verify signature
  const dataToVerify = signingData({
    from: msg.from,
    to: msg.to,
    type: msg.type,
    payload: msg.payload,
    timestamp: msg.timestamp,
  })
  if (!verify(dataToVerify, msg.signature, senderPub)) {
    throw new Error('JackClaw: message signature verification failed')
  }

  // 2. Decrypt payload
  const encPayload: EncryptedPayload = JSON.parse(msg.payload)
  const plaintext = decrypt(encPayload, recipientPriv)
  return JSON.parse(plaintext) as T
}

export type { JackClawMessage, KeyPair }
