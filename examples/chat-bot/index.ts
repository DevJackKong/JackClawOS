import { generateKeyPair } from "@jackclaw/protocol"
import WebSocket from "ws"

const HUB_WS = "ws://localhost:3100"
const NODE_ID = "chat-bot"

// 1. 注册到 Hub
const kp = generateKeyPair()
await fetch("http://localhost:3100/api/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    nodeId: NODE_ID,
    name: "ChatBot",
    role: "bot",
    publicKey: kp.publicKey,
    callbackUrl: "http://localhost:19998",
  }),
})
console.log("🦞 ChatBot registered, connecting WS…")

// 2. 连接 Hub WebSocket
const ws = new WebSocket(`${HUB_WS}?nodeId=${NODE_ID}`)

ws.on("open", () => console.log("✅ Connected to Hub"))

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString())
  console.log("📨 Received:", msg.type ?? msg)

  // 自动回复
  ws.send(JSON.stringify({
    type: "message",
    from: NODE_ID,
    to: msg.from ?? "hub",
    content: "🦞 Got it!",
  }))
  console.log("📤 Replied: 🦞 Got it!")
})

ws.on("error", (e) => console.error("WS error:", e.message))
ws.on("close", () => console.log("🔌 Disconnected"))
