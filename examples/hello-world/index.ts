import { generateKeyPair } from "@jackclaw/protocol"

const kp = generateKeyPair()
console.log("🦞 Generated key pair")
console.log("Public key:", kp.publicKey.slice(0, 50) + "...")

// 注册到 Hub
const res = await fetch("http://localhost:3100/api/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    nodeId: "hello-node",
    name: "Hello",
    role: "demo",
    publicKey: kp.publicKey,
    callbackUrl: "http://localhost:19999",
  }),
})
const data = await res.json()
console.log("✅ Registered:", data.action ?? "ok")
