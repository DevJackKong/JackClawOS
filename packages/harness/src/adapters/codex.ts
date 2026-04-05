/**
 * Codex Adapter
 * CLI: codex --quiet "<task>" in workdir
 */

import { spawn as spawnProc } from 'child_process'
import { randomUUID } from 'crypto'
import type { HarnessAdapter, HarnessTask, ActiveSession, HarnessOutput } from '../adapter'
import type { HarnessContext } from '../context'

export class CodexAdapter implements HarnessAdapter {
  readonly name = 'codex' as const

  async isAvailable(): Promise<boolean> {
    try {
      const { execSync } = await import('child_process')
      execSync('codex --version', { stdio: 'ignore' })
      return true
    } catch { return false }
  }

  async spawn(task: HarnessTask, _context: HarnessContext): Promise<ActiveSession> {
    const sessionId = randomUUID()
    const startedAt = Date.now()
    const outputChunks: string[] = []
    const errChunks: string[] = []
    const outputCallbacks: Array<(chunk: string) => void> = []

    const proc = spawnProc('codex', ['--quiet', task.description], {
      cwd: task.workdir,
      env: { ...process.env },
    })

    proc.stdout.on('data', (chunk: Buffer) => {
      const str = chunk.toString()
      outputChunks.push(str)
      outputCallbacks.forEach(cb => cb(str))
    })
    proc.stderr.on('data', (chunk: Buffer) => { errChunks.push(chunk.toString()) })

    return {
      sessionId,
      pid: proc.pid,

      async wait(): Promise<HarnessOutput> {
        return new Promise((resolve, reject) => {
          proc.on('error', (err) => reject(new Error(`Process spawn error: ${err.message}`)))
          proc.on('close', (code) => {
            resolve({
              sessionId,
              stdout: outputChunks.join(''),
              stderr: errChunks.join(''),
              exitCode: code ?? 1,
              durationMs: Date.now() - startedAt,
            })
          })
        })
      },

      async kill() { proc.kill('SIGTERM') },

      onOutput(cb) { outputCallbacks.push(cb) },
    }
  }
}

export function toReport(output: HarnessOutput): { summary: string, period: string, visibility: string, data: Record<string, unknown> } {
  return {
    summary: output.stdout.slice(0, 500),
    period: "on-demand",
    visibility: "ceo",
    data: { exitCode: output.exitCode, duration: output.durationMs, model: (output as unknown as Record<string, unknown>).model }
  }
}
