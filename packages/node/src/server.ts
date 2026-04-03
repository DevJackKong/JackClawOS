import express, { Request, Response, NextFunction } from 'express'
import { openMessage, decrypt } from '@jackclaw/protocol'
import type { NodeIdentity, JackClawMessage, TaskPayload, EncryptedPayload } from '@jackclaw/protocol'
import type { JackClawConfig } from './config'
import { getAiClient } from './ai-client'

// Harness runner 接口（运行时注入，避免编译期跨包依赖）
export type HarnessRunner = (opts: {
  taskId: string
  title: string
  description: string
  workdir: string
  requireApproval: boolean
}) => Promise<{ status: string; attempts: number }>

let harnessRunner: HarnessRunner | null = null
export function registerHarnessRunner(runner: HarnessRunner): void {
  harnessRunner = runner
}

export function createServer(identity: NodeIdentity, config: JackClawConfig) {  const app = express()
  app.use(express.json({ limit: '1mb' }))

  // ── Health check ────────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', nodeId: identity.nodeId, ts: Date.now() })
  })

  // ── Receive task from Hub ───────────────────────────────────────────────────
  app.post('/api/task', (req: Request, res: Response) => {
    if (!config.visibility.shareTasks) {
      res.status(403).json({ error: 'Task acceptance disabled by node config' })
      return
    }

    const msg = req.body as JackClawMessage

    if (!msg || !msg.payload || !msg.signature) {
      res.status(400).json({ error: 'Invalid message format' })
      return
    }

    // Hub must identify itself; for now we trust messages from 'hub'
    // In production, store Hub's public key in config
    const hubPublicKey: string | undefined = (config as any).hubPublicKey
    if (!hubPublicKey) {
      // Accept without verification if Hub key not configured (dev mode)
      console.warn('[server] Hub public key not configured — skipping signature verification')
      try {
        const raw: EncryptedPayload = JSON.parse(msg.payload)
        const plaintext: string = decrypt(raw, identity.privateKey)
        const task = JSON.parse(plaintext) as TaskPayload
        console.log(`[server] Received task: ${task.taskId} — ${task.action}`)
        handleTask(task, identity, config)
        res.json({ status: 'accepted', taskId: task.taskId })
      } catch (err: any) {
        console.error('[server] Failed to process task:', err.message)
        res.status(422).json({ error: 'Failed to process task' })
      }
      return
    }

    // Verified path
    try {
      const task = openMessage<TaskPayload>(msg, hubPublicKey, identity.privateKey)
      console.log(`[server] Received verified task: ${task.taskId} — ${task.action}`)
      handleTask(task, identity, config)
      res.json({ status: 'accepted', taskId: task.taskId })
    } catch (err: any) {
      console.error('[server] Task verification/decryption failed:', err.message)
      res.status(422).json({ error: 'Failed to verify or decrypt task' })
    }
  })

  // ── Ping ────────────────────────────────────────────────────────────────────
  app.post('/api/ping', (_req: Request, res: Response) => {
    res.json({ pong: true, nodeId: identity.nodeId, ts: Date.now() })
  })

  // ── Error handler ───────────────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server] Unhandled error:', err.message)
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}

function handleTask(task: TaskPayload, identity: NodeIdentity, config: JackClawConfig): void {
  console.log(`[task] Handling task ${task.taskId}: ${task.action}`, task.params)

  // action='harness' → 接入 Harness 执行链
  if (task.action === 'harness' && task.params?.description) {
    if (!harnessRunner) {
      console.warn('[task] No harness runner registered, skipping')
      return
    }
    harnessRunner({
      taskId: task.taskId,
      title: (task.params.title as string) || task.taskId,
      description: task.params.description as string,
      workdir: (task.params.workdir as string) || config.workspaceDir,
      requireApproval: !!(task.params.requireApproval),
    }).then(r => console.log(`[task] ${task.taskId} → ${r.status} (${r.attempts} attempts)`))
      .catch(err => console.error('[task] harness error:', err.message))
    return
  }

  // action='ai' → 直接 AI 调用（带 AutoRetry + SmartCache）
  if (task.action === 'ai' && task.params?.prompt) {
    const aiClient = getAiClient(identity.nodeId, config)
    aiClient.call({
      systemPrompt: 'You are a JackClaw agent node. Complete the task concisely.',
      messages: [{ role: 'user', content: task.params.prompt as string }],
      queryContext: task.params.prompt as string,
    }).then(result => {
      console.log(`[task] ${task.taskId} ai → attempts=${result.attempts} tokens=${result.usage.inputTokens}`)
    }).catch(err => console.error('[task] ai error:', err.message))
    return
  }
}

