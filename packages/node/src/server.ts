import express, { Request, Response, NextFunction } from 'express'
import { openMessage, decrypt } from '@jackclaw/protocol'
import type { NodeIdentity, JackClawMessage, TaskPayload, EncryptedPayload } from '@jackclaw/protocol'
import type { JackClawConfig } from './config'
import { getAiClient } from './ai-client'
import { getOwnerMemoryAuth } from './owner-memory-auth'
import { getOwnerMemory } from './owner-memory'
import { TaskPlanner, formatPlan } from './task-planner'
import { createOwnerAuthRouter } from './routes/owner-auth'
import { WorkloadTracker } from './workload-tracker'
import { getPerformanceLedger } from './performance-ledger'
import { getNodeGateway } from './llm-gateway'

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

  // Workload tracker — scoped to this server instance
  const workloadTracker = new WorkloadTracker(identity.nodeId)

  // ── Health check ────────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', nodeId: identity.nodeId, ts: Date.now(), workload: workloadTracker.getSnapshot() })
  })

  // ── Ask: direct LLM call via gateway ──────────────────────────────────────
  // POST /api/ask  { model?, prompt, systemPrompt? }
  // → { answer, model, provider, tokens, latencyMs, costUsd }
  app.post('/api/ask', async (req: Request, res: Response) => {
    const { prompt, model, systemPrompt, temperature, max_tokens } = req.body
    if (!prompt) { res.status(400).json({ error: 'prompt required' }); return }

    const gateway = getNodeGateway()
    if (!gateway) { res.status(503).json({ error: 'LLM gateway not initialized' }); return }

    const targetModel = model || config.ai.model
    const sys = systemPrompt || `You are ${identity.nodeId}, a JackClaw agent (role: ${(config as any).nodeRole ?? 'worker'}).`

    try {
      const result = await gateway.chat({
        model: targetModel,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: prompt },
        ],
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 2048,
      })
      const answer = result.choices[0]?.message.content ?? ''
      const costUsd = gateway.estimateCost(targetModel, result.usage.prompt_tokens, result.usage.completion_tokens)
      res.json({
        answer,
        model: result.model,
        provider: result.provider,
        tokens: result.usage,
        latencyMs: result.latencyMs,
        costUsd,
      })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── List available providers ───────────────────────────────────────────────
  app.get('/api/providers', (_req: Request, res: Response) => {
    const gateway = getNodeGateway()
    if (!gateway) { res.json({ providers: [] }); return }
    res.json({ providers: gateway.listProviders(), stats: gateway.getStats() })
  })

  // ── Memory semantic search ─────────────────────────────────────────────────
  // POST /api/memory/search  { query, topK?, useEmbeddings? }
  app.post('/api/memory/search', async (req: Request, res: Response) => {
    const { query, topK = 5, useEmbeddings = false } = req.body
    if (!query) { res.status(400).json({ error: 'query required' }); return }

    try {
      const { MemoryManager } = await import('@jackclaw/memory')
      const mm = new MemoryManager()
      const gateway = getNodeGateway()

      // Optional: use LLM embeddings for better semantic matching
      let embedder: ((text: string) => Promise<number[]>) | undefined
      if (useEmbeddings && gateway) {
        embedder = async (text: string) => {
          // Use OpenAI embeddings if available, otherwise TF-IDF fallback
          try {
            const r = await gateway.chat({
              model: 'text-embedding-3-small',
              messages: [{ role: 'user', content: text }],
            })
            // Parse embedding from response (provider-specific)
            return (r.raw as any)?.data?.[0]?.embedding ?? []
          } catch {
            return [] // fallback to TF-IDF
          }
        }
      }

      const results = await mm.semanticQuery(identity.nodeId, query, topK, embedder)
      res.json({ query, results, total: results.length })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
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

  // ── Task Plan（规划引擎）────────────────────────────────────────────────────
  // POST /api/plan { taskId, title, description, useAi? }
  // 返回完整 ExecutionPlan + 格式化文本
  app.post('/api/plan', (req: Request, res: Response) => {
    const { taskId, title, description, useAi } = req.body ?? {}
    if (!title || !description) {
      res.status(400).json({ error: 'title and description required' })
      return
    }
    const aiClient = getAiClient(identity.nodeId, config)
    const planner = new TaskPlanner(aiClient)
    planner.plan({
      taskId: taskId ?? `plan-${Date.now()}`,
      title,
      description,
      useAi: useAi !== false,
    }).then(plan => {
      res.json({ plan, formatted: formatPlan(plan) })
    }).catch(err => {
      res.status(500).json({ error: err.message })
    })
  })

  // ── OwnerMemory 授权区 ───────────────────────────────────────────────────────
  app.use('/api/owner', createOwnerAuthRouter(identity))

  // ── Performance Ledger ───────────────────────────────────────────────────────

  // GET /api/performance/stats — 本周绩效统计
  app.get('/api/performance/stats', (_req: Request, res: Response) => {
    res.json(getPerformanceLedger().weeklyStats())
  })

  // GET /api/performance/recommendation — 自动调优建议
  app.get('/api/performance/recommendation', (_req: Request, res: Response) => {
    const stats = getPerformanceLedger().weeklyStats()
    const retryTuning = getPerformanceLedger().autoTuneRetry()
    res.json({ recommendation: stats.recommendation, retryTuning })
  })

  // ── Error handler ───────────────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server] Unhandled error:', err.message)
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}

export function handleTask(task: TaskPayload, identity: NodeIdentity, config: JackClawConfig): void {
  console.log(`[task] Handling task ${task.taskId}: ${task.action}`, task.params)

  // 所有 harness/ai 任务先自动规划，打印计划后再执行
  if ((task.action === 'harness' || task.action === 'ai') && task.params?.description) {
    const aiClient = getAiClient(identity.nodeId, config)
    const planner = new TaskPlanner(aiClient)
    // 非阻塞：规划和执行同时启动，规划完打印计划
    planner.plan({
      taskId: task.taskId,
      title: (task.params.title as string) || task.taskId,
      description: task.params.description as string,
      useAi: true,
    }).then(plan => {
      console.log('\n' + formatPlan(plan) + '\n')
    }).catch(() => { /* 规划失败不影响执行 */ })
  }

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

  // action='ai' → 通过 LLM Gateway 调用（支持任意 provider + 自动 fallback）
  if (task.action === 'ai' && task.params?.prompt) {
    const gateway = getNodeGateway()
    const prompt = task.params.prompt as string
    const model = (task.params.model as string) || config.ai.model
    const systemPrompt = (task.params.systemPrompt as string) || `You are ${identity.nodeId}, a JackClaw agent node (role: ${(config as any).nodeRole ?? 'worker'}). Complete the task concisely.`

    if (gateway) {
      // Gateway available — use it (supports all providers + fallback chain)
      gateway.chat({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: (task.params.maxTokens as number) || 2048,
        temperature: (task.params.temperature as number) || 0.7,
      }).then(result => {
        const answer = result.choices[0]?.message.content ?? ''
        const stats = gateway.getStats()
        console.log(`[task] ${task.taskId} ai[${result.provider}/${result.model}] → ${result.usage.total_tokens} tokens, ${result.latencyMs}ms`)
        console.log(`[task] Answer: ${answer.slice(0, 100)}${answer.length > 100 ? '...' : ''}`)
        console.log(`[gateway] Total cost so far: $${stats.totalCostUsd.toFixed(6)}`)
      }).catch(err => console.error('[task] gateway ai error:', err.message))
    } else {
      // Fallback to legacy ai-client
      const aiClient = getAiClient(identity.nodeId, config)
      aiClient.call({
        systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        queryContext: prompt,
      }).then(result => {
        console.log(`[task] ${task.taskId} ai[legacy] → attempts=${result.attempts} tokens=${result.usage.inputTokens}`)
      }).catch(err => console.error('[task] ai error:', err.message))
    }
    return
  }

  // action='chat-reply' → 自动回复 ClawChat 消息（LLM 生成回复）
  if (task.action === 'chat-reply' && task.params?.message) {
    const gateway = getNodeGateway()
    if (!gateway) return
    const incomingMsg = task.params.message as string
    const from = task.params.from as string
    const model = (task.params.model as string) || config.ai.model

    gateway.chat({
      model,
      messages: [
        { role: 'system', content: `You are ${identity.nodeId} (${(config as any).nodeRole ?? 'worker'}). Reply concisely to your colleague's message.` },
        { role: 'user', content: incomingMsg },
      ],
      max_tokens: 512,
      temperature: 0.8,
    }).then(result => {
      const reply = result.choices[0]?.message.content ?? ''
      console.log(`[chat-reply] ${from} → ${identity.nodeId}: "${incomingMsg.slice(0,40)}"`)
      console.log(`[chat-reply] ${identity.nodeId} → ${from}: "${reply.slice(0,80)}"`)
    }).catch(err => console.error('[chat-reply] error:', err.message))
    return
  }
}

