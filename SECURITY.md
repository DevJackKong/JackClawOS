# Security Policy

## Encryption Notice

JackClawOS implements end-to-end encryption for inter-agent communication. This project is classified under **ECCN 5D002** and is distributed under **License Exception TSU** (Technology and Software - Unrestricted) per EAR § 742.15(b).

### Cryptographic Algorithms Used

| Algorithm | Purpose | Implementation |
|-----------|---------|---------------|
| RSA-4096 | Asymmetric key exchange between agents | Node.js `crypto` module |
| AES-256-GCM | Symmetric message encryption | Node.js `crypto` module |
| HMAC-SHA256 | Message integrity & human-token verification | Node.js `crypto` module |
| JWT (HS256) | Authentication tokens | `jsonwebtoken` package |
| scrypt | Password hashing | Node.js `crypto` module |
| VAPID (ECDSA P-256) | Web Push notification keys | Node.js `crypto` module |

### Key Points

- **All encryption uses standard, well-audited algorithms** via the Node.js built-in `crypto` module
- **No custom or proprietary cryptographic algorithms** are implemented
- **End-to-end encryption** ensures the Hub (central server) cannot read message content — it only routes ciphertext
- **Private keys never leave the node** they were generated on
- Source code is **publicly available** under the MIT license

### Export Compliance

This software is publicly available open-source software. The U.S. Bureau of Industry and Security (BIS) and National Security Agency (NSA) have been notified in accordance with EAR § 742.15(b).

**ECCN:** 5D002  
**License Exception:** TSU (15 CFR § 740.13(e))

### Country Restrictions

This is open-source software freely available to everyone. However, users are responsible for ensuring their use complies with applicable export control laws and regulations in their jurisdiction.

---

## Reporting Security Vulnerabilities

If you discover a security vulnerability in JackClawOS, please report it responsibly:

1. **DO NOT** open a public GitHub issue for security vulnerabilities
2. Email: **security@jackclaw.ai**
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

| Action | Target |
|--------|--------|
| Acknowledge receipt | 48 hours |
| Initial assessment | 5 business days |
| Fix development | 14 business days |
| Public disclosure | After fix is released |

### Scope

The following are in scope for security reports:

- Authentication bypass
- Encryption weaknesses or key exposure
- Message interception or tampering
- Privilege escalation
- Remote code execution
- Data exposure (memory contents, private keys, etc.)
- Hub compromise leading to message decryption

### Out of Scope

- Denial of service (unless trivially exploitable)
- Social engineering attacks
- Issues in dependencies (report upstream, notify us)
- Features working as designed

---

## Security Architecture

```
┌──────────────────────────────────────────────┐
│              Human (CEO)                      │
│         JWT auth + human-token ACK            │
└─────────────────┬────────────────────────────┘
                  │
┌─────────────────▼────────────────────────────┐
│              Hub (:3100)                      │
│                                               │
│  • Routes ciphertext only (cannot decrypt)    │
│  • JWT authentication for all API calls       │
│  • Rate limiting (IP + nodeId)                │
│  • CORS + CSP headers                         │
│  • Audit log (append-only JSONL)              │
│  • Key rotation (30-day cycle)                │
│  • Input sanitization (XSS prevention)        │
└───┬───────────────┬──────────────┬───────────┘
    │               │              │
    │  RSA-4096 + AES-256-GCM per message
    │               │              │
┌───▼───┐    ┌──────▼──┐    ┌─────▼───┐
│ Node1 │    │  Node2  │    │  Node3  │
│       │    │         │    │         │
│ • Private key never  │    │         │
│   leaves this node   │    │         │
│ • L1/L2 memory local │    │         │
│ • Watchdog sandboxed │    │         │
└───────┘    └─────────┘    └─────────┘
```

### Trust Model

- **Hub is untrusted** for message content — it only sees ciphertext
- **Nodes trust each other** only through accumulated collaboration (TrustLevel: unknown → contact → colleague → trusted)
- **Human approval required** for high-risk operations regardless of agent autonomy level
- **Watchdog** cannot be modified by any agent (`canModify()` hardcoded to `false`)

---

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Current |
| < 0.1   | ❌ No      |

---

*Last updated: April 4, 2026*
