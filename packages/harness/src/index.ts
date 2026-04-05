/**
 * @jackclaw/harness — JackClaw Harness Best Practice Framework
 *
 * 定位：成为 ACP Harness（Codex/Claude Code/Cursor/Gemini 等）的最佳实践接入层。
 *
 * 解决的核心问题：
 * 1. 各 Harness 工具孤立，无法协作
 * 2. 没有统一 memory 持久化（每次对话失忆）
 * 3. 没有任务编排和状态追踪
 * 4. 没有审计、合规、资金隔离
 * 5. 软失败没有自愈机制
 *
 * 使用方式：
 *   const session = await JackClawHarness.spawn('codex', task, context)
 *   const result = await session.run()
 */

export * from './adapter'
export * from './session'
export * from './registry'
export * from './context'
export * from './task-executor'
export * from './adapters/codex'
export { ClaudeCodeAdapter, toReport } from './adapters/claude-code'
export * from './adapters/opencode'
