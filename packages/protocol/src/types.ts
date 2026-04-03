// JackClaw Protocol - Message Type Definitions

export interface JackClawMessage {
  from: string       // 节点 ID
  to: string         // 目标节点 ID
  type: 'report' | 'task' | 'ack' | 'ping'
  payload: string    // 加密内容 (base64 encoded EncryptedPayload JSON)
  timestamp: number
  signature: string  // 发送方签名 (base64)
}

export interface ReportPayload {
  summary: string
  period: string     // daily/weekly
  visibility: 'full' | 'summary_only' | 'private'
  data: Record<string, any>
}

export interface TaskPayload {
  taskId: string
  action: string
  params: Record<string, any>
  deadline?: number
}

export interface AckPayload {
  refMessageId?: string
  status: 'ok' | 'error'
  message?: string
}

export interface PingPayload {
  nonce: string
}

// Encrypted envelope: AES-GCM encrypted, key wrapped with RSA-OAEP
export interface EncryptedPayload {
  encryptedKey: string   // RSA-OAEP encrypted AES key (base64)
  iv: string             // AES-GCM IV (base64)
  ciphertext: string     // AES-256-GCM encrypted data (base64)
  authTag: string        // AES-GCM auth tag (base64)
}

export interface KeyPair {
  publicKey: string   // PEM
  privateKey: string  // PEM
}

export interface NodeIdentity {
  nodeId: string
  publicKey: string   // PEM
  privateKey: string  // PEM
  createdAt: number
}
