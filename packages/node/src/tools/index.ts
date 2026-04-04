/**
 * JackClaw Built-in Tool Definitions
 *
 * 权限分级：
 * - L0/L1: webSearch, readUrl, mathCalc
 * - L2:    + fileRead, runCode
 * - L3:    + fileWrite, shellExec
 */

import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import vm from 'vm'

const execFileAsync = promisify(execFile)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ToolParameter {
  type: string
  description: string
  enum?: string[]
  items?: { type: string }
  required?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolParameter>
    required: string[]
  }
  permissionLevel: 0 | 1 | 2 | 3
  execute: (args: Record<string, unknown>) => Promise<string>
}

export interface ToolCallResult {
  toolName: string
  args: Record<string, unknown>
  result: string
  error?: string
  durationMs: number
}

// ─── Tool Implementations ─────────────────────────────────────────────────────

const webSearchTool: ToolDefinition = {
  name: 'webSearch',
  description: 'Search the web for information using DuckDuckGo',
  permissionLevel: 0,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query string' },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = String(args.query)
    const encoded = encodeURIComponent(query)
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JackClaw/1.0)',
        'Accept': 'text/html',
      },
    })

    if (!res.ok) throw new Error(`Search failed: ${res.status}`)

    const html = await res.text()
    const snippets: string[] = []
    const resultPattern = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
    let m: RegExpExecArray | null
    // eslint-disable-next-line no-cond-assign
    while ((m = resultPattern.exec(html)) !== null && snippets.length < 5) {
      snippets.push(m[1].replace(/<[^>]+>/g, '').trim())
    }

    if (snippets.length === 0) return `No results found for: ${query}`
    return `Search results for "${query}":\n\n${snippets.map((s, i) => `${i + 1}. ${s}`).join('\n\n')}`
  },
}

const readUrlTool: ToolDefinition = {
  name: 'readUrl',
  description: 'Fetch and read the text content of a URL',
  permissionLevel: 0,
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
    },
    required: ['url'],
  },
  async execute(args) {
    const url = String(args.url)
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http/https URLs allowed')

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JackClaw/1.0)' },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()

    const plain = text
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s{3,}/g, '\n\n')
      .trim()
      .slice(0, 8000)

    return plain || '(empty page)'
  },
}

const mathCalcTool: ToolDefinition = {
  name: 'mathCalc',
  description: 'Evaluate a mathematical expression safely',
  permissionLevel: 0,
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'Math expression, e.g. "2 + 3 * 4"' },
    },
    required: ['expression'],
  },
  async execute(args) {
    const expr = String(args.expression)
    if (!/^[\d\s+\-*/().^%,a-zA-Z]+$/.test(expr)) {
      throw new Error('Invalid expression — only math operators and numbers allowed')
    }
    const result = vm.runInNewContext(expr, {
      Math, Number, parseInt, parseFloat, Infinity, NaN,
    }, { timeout: 1000 })
    return String(result)
  },
}

const fileReadTool: ToolDefinition = {
  name: 'fileRead',
  description: 'Read the contents of a local file',
  permissionLevel: 2,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
    },
    required: ['path'],
  },
  async execute(args) {
    const filePath = String(args.path)
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
    const content = fs.readFileSync(filePath, 'utf-8')
    return content.slice(0, 16000)
  },
}

const runCodeTool: ToolDefinition = {
  name: 'runCode',
  description: 'Execute a JavaScript snippet in a sandboxed environment',
  permissionLevel: 2,
  parameters: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Programming language (only "javascript" supported)',
        enum: ['javascript'],
      },
      code: { type: 'string', description: 'Code to execute' },
    },
    required: ['language', 'code'],
  },
  async execute(args) {
    const lang = String(args.language)
    const code = String(args.code)
    if (lang !== 'javascript') throw new Error('Only javascript is supported')

    const logs: string[] = []
    const sandbox = {
      console: {
        log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
        error: (...a: unknown[]) => logs.push('[error] ' + a.map(String).join(' ')),
        warn: (...a: unknown[]) => logs.push('[warn] ' + a.map(String).join(' ')),
      },
      Math, Number, String, Array, Object, JSON,
      parseInt, parseFloat, isNaN, isFinite,
    }

    let returnValue: unknown
    try {
      returnValue = vm.runInNewContext(code, sandbox, { timeout: 5000 })
    } catch (err) {
      throw new Error(`Runtime error: ${(err as Error).message}`)
    }

    const output = logs.join('\n')
    const ret = returnValue !== undefined ? `\nReturn: ${JSON.stringify(returnValue)}` : ''
    return (output + ret).trim() || '(no output)'
  },
}

const fileWriteTool: ToolDefinition = {
  name: 'fileWrite',
  description: 'Write content to a local file',
  permissionLevel: 3,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
  async execute(args) {
    const filePath = String(args.path)
    const content = String(args.content)
    fs.writeFileSync(filePath, content, 'utf-8')
    return `Written ${content.length} chars to ${filePath}`
  },
}

const shellExecTool: ToolDefinition = {
  name: 'shellExec',
  description: 'Execute a shell command (L3 permission required). Uses execFile to prevent shell injection.',
  permissionLevel: 3,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to execute (first word is the binary)' },
      args: {
        type: 'array',
        description: 'Arguments to pass to the command',
        items: { type: 'string' },
      },
    },
    required: ['command'],
  },
  async execute(args) {
    const command = String(args.command)
    const cmdArgs = Array.isArray(args.args) ? (args.args as string[]).map(String) : []

    try {
      const { stdout, stderr } = await execFileAsync(command, cmdArgs, {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf-8',
      })
      const out = [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n[stderr]\n')
      return out || '(no output)'
    } catch (err: any) {
      const msg = err?.stderr?.trim() || err?.message || String(err)
      throw new Error(`Command failed: ${msg}`)
    }
  },
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const ALL_TOOLS: ToolDefinition[] = [
  webSearchTool,
  readUrlTool,
  mathCalcTool,
  fileReadTool,
  runCodeTool,
  fileWriteTool,
  shellExecTool,
]

export function getToolsForLevel(level: 0 | 1 | 2 | 3): ToolDefinition[] {
  return ALL_TOOLS.filter(t => t.permissionLevel <= level)
}

export function getToolByName(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find(t => t.name === name)
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  permissionLevel: 0 | 1 | 2 | 3 = 0,
): Promise<ToolCallResult> {
  const tool = getToolByName(name)
  const start = Date.now()

  if (!tool) {
    return { toolName: name, args, result: '', error: `Unknown tool: ${name}`, durationMs: 0 }
  }

  if (tool.permissionLevel > permissionLevel) {
    return {
      toolName: name, args, result: '',
      error: `Permission denied: tool "${name}" requires L${tool.permissionLevel}, current L${permissionLevel}`,
      durationMs: 0,
    }
  }

  try {
    const result = await tool.execute(args)
    return { toolName: name, args, result, durationMs: Date.now() - start }
  } catch (err) {
    return {
      toolName: name, args, result: '',
      error: (err as Error).message,
      durationMs: Date.now() - start,
    }
  }
}
