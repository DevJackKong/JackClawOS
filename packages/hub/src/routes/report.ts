// POST /api/report - Receive encrypted agent report
// JWT-authenticated; decrypts payload and stores it

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { getNode, updateLastReport } from '../store/nodes'
import { saveReport } from '../store/reports'
import { getHubKeys } from '../server'
import { ReportEntry } from '../types'
import { EncryptedPayload, ReportPayload, JackClawMessage } from '@jackclaw/protocol'

const router = Router()

/**
 * Decrypt an EncryptedPayload using the hub's RSA private key + AES-256-GCM.
 * Protocol matches the EncryptedPayload spec in @jackclaw/protocol/types.ts
 */
function decryptPayload(encrypted: EncryptedPayload, privateKeyPem: string): string {
  // Unwrap AES key with RSA-OAEP
  const aesKey = crypto.privateDecrypt(
    { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(encrypted.encryptedKey, 'base64')
  )

  const iv = Buffer.from(encrypted.iv, 'base64')
  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64')
  const authTag = Buffer.from(encrypted.authTag, 'base64')

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return decrypted.toString('utf-8')
}

router.post('/', (req: Request, res: Response): void => {
  const message = req.body as Partial<JackClawMessage>

  if (!message.from || !message.payload || !message.timestamp || !message.signature) {
    res.status(400).json({ error: 'Invalid message format' })
    return
  }

  const node = getNode(message.from)
  if (!node) {
    res.status(403).json({ error: 'Unknown node. Please register first.' })
    return
  }

  // Verify signature
  try {
    const dataToVerify = `${message.from}:${message.to ?? 'hub'}:${message.timestamp}:${message.payload}`
    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(dataToVerify)
    const sigValid = verify.verify(node.publicKey, message.signature, 'base64')
    if (!sigValid) {
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
  } catch (err) {
    res.status(401).json({ error: 'Signature verification failed' })
    return
  }

  // Decrypt payload
  let reportPayload: ReportPayload
  try {
    const { privateKey: hubPrivateKey } = getHubKeys()
    const encryptedEnvelope: EncryptedPayload = JSON.parse(
      Buffer.from(message.payload, 'base64').toString('utf-8')
    )
    const plaintext = decryptPayload(encryptedEnvelope, hubPrivateKey)
    reportPayload = JSON.parse(plaintext) as ReportPayload
  } catch (err) {
    res.status(400).json({ error: 'Failed to decrypt payload' })
    return
  }

  const entry: ReportEntry = {
    nodeId: message.from,
    messageId: `${message.from}-${message.timestamp}`,
    timestamp: message.timestamp,
    summary: reportPayload.summary,
    period: reportPayload.period,
    visibility: reportPayload.visibility,
    data: reportPayload.data,
  }

  saveReport(entry)
  updateLastReport(message.from)

  res.json({ success: true, messageId: entry.messageId })
})

export default router
