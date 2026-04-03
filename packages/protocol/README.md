# @jackclaw/protocol

End-to-end encrypted messaging protocol for JackClaw nodes.

## Features

- **RSA-2048** key pair generation (PKCS1 PEM)
- **Hybrid encryption**: AES-256-GCM data + RSA-OAEP key wrapping
- **RSA-SHA256** message signing & verification
- Pure Node.js built-in `crypto` — no external deps

## API

```typescript
import {
  generateKeyPair,
  encrypt, decrypt,
  sign, verify,
  createMessage, openMessage,
} from '@jackclaw/protocol'

// Generate key pairs
const alice = generateKeyPair()   // { publicKey, privateKey }
const bob = generateKeyPair()

// Send encrypted + signed message
const msg = createMessage(
  'node-alice', 'node-bob',
  'report',
  { summary: 'all good', period: 'daily', visibility: 'full', data: {} },
  bob.publicKey,    // encrypt FOR bob
  alice.privateKey, // sign AS alice
)

// Receive & decrypt
const payload = openMessage(msg, alice.publicKey, bob.privateKey)
```

## Types

```typescript
interface JackClawMessage {
  from: string
  to: string
  type: 'report' | 'task' | 'ack' | 'ping'
  payload: string    // JSON-serialised EncryptedPayload
  timestamp: number
  signature: string  // base64
}

interface ReportPayload {
  summary: string
  period: string     // 'daily' | 'weekly'
  visibility: 'full' | 'summary_only' | 'private'
  data: Record<string, any>
}
```

## Test

```bash
npm run test:src
```
