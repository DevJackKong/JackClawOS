import { Router, Request, Response } from "express"

const router = Router()

// 内存存储（生产应用持久化）
const requests = new Map<string, object>()
const sessions = new Map<string, object>()

router.post("/request", (req: Request, res: Response) => {
  const { from, to, topic, clearAfterSession = true } = req.body ?? {}
  if (!from || !to || !topic) { res.status(400).json({ error: "from, to, topic required" }); return }
  const id = `tr-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
  const request = { id, from, to, topic, clearAfterSession, requestedAt: Date.now(), expiresAt: Date.now() + 1800000 }
  requests.set(id, request)
  res.json({ requestId: id, request })
})

router.post("/respond", (req: Request, res: Response) => {
  const { requestId, accept } = req.body ?? {}
  const request = requests.get(requestId)
  if (!request) { res.status(404).json({ error: "Request not found" }); return }
  if (accept) {
    const session = { ...(request as object), id: requestId, state: "active", startedAt: Date.now(), knowledge: [] }
    sessions.set(requestId, session)
  }
  requests.delete(requestId)
  res.json({ ok: true, state: accept ? "active" : "rejected" })
})

router.post("/knowledge", (req: Request, res: Response) => {
  const { sessionId, entries } = req.body ?? {}
  const session = sessions.get(sessionId) as any
  if (!session) { res.status(404).json({ error: "Session not found" }); return }
  session.knowledge = [...(session.knowledge ?? []), ...(entries ?? [])]
  res.json({ ok: true, count: entries?.length ?? 0 })
})

router.get("/sessions", (_req: Request, res: Response) => {
  res.json([...sessions.values()])
})

router.post("/complete", (req: Request, res: Response) => {
  const { sessionId } = req.body ?? {}
  const session = sessions.get(sessionId) as any
  if (!session) { res.status(404).json({ error: "Session not found" }); return }
  session.state = "completed"
  session.completedAt = Date.now()
  const knowledge = session.knowledge ?? []
  if (session.clearAfterSession) delete session.knowledge
  res.json({ ok: true, knowledge })
})

export default router
