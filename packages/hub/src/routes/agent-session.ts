import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { fileStore } from '../store/files'

interface AgentSessionEnvelope<TArgs = any> {
  sessionId: string
  messageId: string
  from: string
  to: string
  command: string
  args: TArgs
  traceId?: string
  timestamp: number
}

interface AgentSessionSuccess<TData = any> {
  ok: true
  sessionId: string
  messageId: string
  data: TData
  error: null
}

interface AgentSessionFailure {
  ok: false
  sessionId: string
  messageId: string
  data: null
  error: {
    code: string
    message: string
  }
}

type AgentSessionResponse<TData = any> = AgentSessionSuccess<TData> | AgentSessionFailure

const router = Router()

const AGENT_FS_ROOT = path.resolve(process.env.JACKCLAW_AGENT_FS_ROOT || process.cwd())
const taskQueue: any[] = []
const resultStore = new Map<string, any>()

function ok(messageId: string, sessionId: string, data: any): AgentSessionResponse {
  return { ok: true, sessionId, messageId, data, error: null }
}

function fail(messageId: string, sessionId: string, code: string, message: string): AgentSessionResponse {
  return { ok: false, sessionId, messageId, data: null, error: { code, message } }
}

function resolveSafePath(inputPath: string): string {
  const full = path.resolve(AGENT_FS_ROOT, inputPath)
  if (!full.startsWith(AGENT_FS_ROOT)) {
    throw new Error('Path escapes JACKCLAW_AGENT_FS_ROOT sandbox')
  }
  return full
}

function listRecursive(dir: string, pattern: string, out: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      listRecursive(full, pattern, out)
    } else if (entry.name.includes(pattern.replaceAll('*', ''))) {
      out.push(path.relative(AGENT_FS_ROOT, full))
    }
  }
}

router.post('/session', (req: Request, res: Response): void => {
  const body = req.body as AgentSessionEnvelope<any>

  if (!body?.sessionId || !body?.messageId || !body?.from || !body?.to || !body?.command) {
    res.status(400).json(fail(body?.messageId || '', body?.sessionId || '', 'BAD_REQUEST', 'invalid envelope'))
    return
  }

  try {
    switch (body.command) {
      case '/health': {
        res.json(ok(body.messageId, body.sessionId, {
          status: 'ok',
          service: 'agent-session',
          timestamp: Date.now(),
          fsRoot: AGENT_FS_ROOT,
          capabilities: [
            '/health',
            '/task',
            '/result',
            '/pop',
            '/fs/list',
            '/fs/read',
            '/fs/write',
            '/fs/find',
            '/fs/download',
            '/fs/tail',
            '/fs/read_bytes',
            '/semantic',
          ],
        }))
        return
      }

      case '/task': {
        const task = {
          taskId: body.args?.taskId || `task_${Date.now()}`,
          goal: body.args?.goal,
          input: body.args?.input ?? null,
          from: body.from,
          to: body.to,
          createdAt: Date.now(),
        }
        taskQueue.push(task)
        res.json(ok(body.messageId, body.sessionId, task))
        return
      }

      case '/result': {
        const taskId = body.args?.taskId
        resultStore.set(taskId, {
          taskId,
          ok: body.args?.ok,
          output: body.args?.output,
          error: body.args?.error,
          from: body.from,
          at: Date.now(),
        })
        res.json(ok(body.messageId, body.sessionId, {
          received: true,
          taskId,
        }))
        return
      }

      case '/pop': {
        const limit = Math.max(1, Number(body.args?.limit || 1))
        const items = taskQueue.splice(0, limit)
        res.json(ok(body.messageId, body.sessionId, { items }))
        return
      }

      case '/fs/list': {
        const dir = resolveSafePath(body.args?.path || '.')
        const items = fs.readdirSync(dir, { withFileTypes: true }).map((x) => ({
          name: x.name,
          type: x.isDirectory() ? 'dir' : 'file',
        }))
        res.json(ok(body.messageId, body.sessionId, { path: body.args?.path || '.', items }))
        return
      }

      case '/fs/read': {
        const file = resolveSafePath(body.args?.path)
        if (body.args?.encoding === 'base64') {
          const buf = fs.readFileSync(file)
          res.json(ok(body.messageId, body.sessionId, {
            path: body.args.path,
            content: buf.toString('base64'),
            encoding: 'base64',
          }))
          return
        }
        const content = fs.readFileSync(file, 'utf8')
        res.json(ok(body.messageId, body.sessionId, {
          path: body.args.path,
          content,
          encoding: 'utf8',
        }))
        return
      }

      case '/fs/write': {
        const file = resolveSafePath(body.args?.path)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        if (body.args?.encoding === 'base64') {
          fs.writeFileSync(file, Buffer.from(body.args.content, 'base64'))
        } else {
          fs.writeFileSync(file, body.args?.content ?? '', 'utf8')
        }
        res.json(ok(body.messageId, body.sessionId, {
          path: body.args.path,
          written: true,
        }))
        return
      }

      case '/fs/find': {
        const base = resolveSafePath(body.args?.path || '.')
        const out: string[] = []
        listRecursive(base, body.args?.pattern || '', out)
        res.json(ok(body.messageId, body.sessionId, {
          path: body.args?.path || '.',
          pattern: body.args?.pattern || '',
          items: out,
        }))
        return
      }

      case '/fs/download': {
        const meta = fileStore.get(body.args?.fileId)
        if (!meta) {
          res.status(404).json(fail(body.messageId, body.sessionId, 'FILE_NOT_FOUND', 'fileId not found'))
          return
        }
        const diskPath = fileStore.getFilePath(body.args.fileId)
        res.json(ok(body.messageId, body.sessionId, {
          fileId: body.args.fileId,
          filename: meta.filename,
          mimeType: meta.mimeType,
          size: meta.size,
          url: meta.url,
          diskPath,
        }))
        return
      }

      case '/fs/tail': {
        const file = resolveSafePath(body.args?.path)
        const text = fs.readFileSync(file, 'utf8')
        const lines = text.split(/\r?\n/)
        res.json(ok(body.messageId, body.sessionId, {
          path: body.args.path,
          content: lines.slice(-(body.args?.lines || 50)).join('\n'),
        }))
        return
      }

      case '/fs/read_bytes': {
        const file = resolveSafePath(body.args?.path)
        const buf = fs.readFileSync(file)
        const offset = Math.max(0, Number(body.args?.offset || 0))
        const length = Math.max(0, Number(body.args?.length || 0))
        res.json(ok(body.messageId, body.sessionId, {
          path: body.args.path,
          offset,
          length,
          content: buf.subarray(offset, offset + length).toString('base64'),
          encoding: 'base64',
        }))
        return
      }

      case '/semantic': {
        res.json(ok(body.messageId, body.sessionId, {
          protocol: body.args?.protocol,
          input: body.args?.input ?? null,
          accepted: true,
        }))
        return
      }

      default: {
        res.status(400).json(fail(body.messageId, body.sessionId, 'UNKNOWN_COMMAND', `unsupported command: ${body.command}`))
        return
      }
    }
  } catch (err: any) {
    res.status(500).json(fail(body.messageId, body.sessionId, 'INTERNAL_ERROR', err?.message || 'internal error'))
  }
})

export default router
