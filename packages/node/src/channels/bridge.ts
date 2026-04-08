/**
 * bridge.ts — ChannelBridge: core router between IM channels and ClawChat
 *
 * Responsibilities:
 *  - Maintain a registry of connected Channel adapters
 *  - Translate IncomingMessage → ClawChat API calls (bridgeToClawChat)
 *  - Translate ClawChat messages → IM sends (bridgeFromClawChat)
 *  - Persist handle mappings and channel configs to ~/.jackclaw/node/channels.json
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import axios from 'axios'
import type { Channel, ChannelConfig, IncomingMessage, MessageContent } from './channel'

// ── Persistence ──────────────────────────────────────────────────────────────

const CHANNELS_DIR  = path.join(os.homedir(), '.jackclaw', 'node')
const CHANNELS_FILE = path.join(CHANNELS_DIR, 'channels.json')

interface ChannelsFile {
  /** handle mappings: imUserId → agentHandle */
  handleMappings: Record<string, string>
  /** saved channel configs: channelName → ChannelConfig */
  channelConfigs: Record<string, ChannelConfig>
}

function loadChannelsFile(): ChannelsFile {
  if (!fs.existsSync(CHANNELS_FILE)) {
    return { handleMappings: {}, channelConfigs: {} }
  }
  try {
    return JSON.parse(fs.readFileSync(CHANNELS_FILE, 'utf8')) as ChannelsFile
  } catch {
    return { handleMappings: {}, channelConfigs: {} }
  }
}

function saveChannelsFile(data: ChannelsFile): void {
  fs.mkdirSync(CHANNELS_DIR, { recursive: true })
  fs.writeFileSync(CHANNELS_FILE, JSON.stringify(data, null, 2))
}

// ── ClawChat message shape sent to Hub ───────────────────────────────────────

interface ClawChatOutgoing {
  from: string        // agentHandle or imUserId fallback
  content: string
  channel: string     // originating IM platform
  senderId: string
  senderName: string
  chatId: string
  chatType: 'direct' | 'group'
  attachments?: { type: string; url: string; filename?: string }[]
  replyTo?: string
  ts: number
  raw?: any
}

// ── ChannelBridge ─────────────────────────────────────────────────────────────

export class ChannelBridge {
  private channels = new Map<string, Channel>()
  private hubUrl: string
  private nodeId: string

  private token?: string

  constructor(opts: { hubUrl: string; nodeId: string; token?: string }) {
    this.hubUrl = opts.hubUrl
    this.nodeId = opts.nodeId
    this.token = opts.token
  }

  // ── Channel registry ────────────────────────────────────────────────────────

  registerChannel(channel: Channel): void {
    this.channels.set(channel.name, channel)
    // Wire incoming messages immediately
    channel.onMessage((msg) => this.bridgeToClawChat(msg).catch((err: Error) =>
      console.error(`[bridge:${channel.name}] bridgeToClawChat error:`, err.message),
    ))
    console.log(`[bridge] Registered channel: ${channel.name}`)
  }

  removeChannel(name: string): void {
    const ch = this.channels.get(name)
    if (ch) {
      ch.disconnect().catch(() => {})
      this.channels.delete(name)
      console.log(`[bridge] Removed channel: ${name}`)
    }
  }

  getChannel(name: string): Channel | undefined {
    return this.channels.get(name)
  }

  listChannels(): { name: string; connected: boolean }[] {
    return Array.from(this.channels.values()).map((ch) => ({
      name: ch.name,
      connected: ch.isConnected(),
    }))
  }

  // ── Handle mappings ─────────────────────────────────────────────────────────

  /**
   * Map an IM user ID (e.g. telegram:123456) → ClawChat @handle
   */
  setHandleMapping(imUserId: string, agentHandle: string): void {
    const data = loadChannelsFile()
    data.handleMappings[imUserId] = agentHandle
    saveChannelsFile(data)
  }

  getHandleMapping(imUserId: string): string | undefined {
    return loadChannelsFile().handleMappings[imUserId]
  }

  // ── Bridge: IM → ClawChat ───────────────────────────────────────────────────

  /**
   * Forward an IncomingMessage from any IM channel to ClawChat Hub.
   *
   * Routing logic:
   *   - If sender has a handle mapping → POST /api/social/send (agent-to-agent)
   *   - Otherwise                      → POST /api/chat/send   (human/external)
   */
  async bridgeToClawChat(msg: IncomingMessage): Promise<void> {
    const mappedHandle = this.getHandleMapping(msg.senderId)

    const payload: ClawChatOutgoing = {
      from:        mappedHandle ?? msg.senderId,
      content:     msg.content,
      channel:     msg.channel,
      senderId:    msg.senderId,
      senderName:  msg.senderName,
      chatId:      msg.chatId,
      chatType:    msg.chatType,
      attachments: msg.attachments,
      replyTo:     msg.replyTo,
      ts:          msg.ts,
      raw:         msg.raw,
    }

    const endpoint = mappedHandle
      ? `${this.hubUrl}/api/social/send`
      : `${this.hubUrl}/api/chat/send`

    try {
      await axios.post(endpoint, payload, { timeout: 10_000, headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} })
      console.log(`[bridge] IM→ClawChat [${msg.channel}] from=${msg.senderId} → ${endpoint}`)
    } catch (err: any) {
      console.error(`[bridge] IM→ClawChat failed [${msg.channel}]:`, err?.response?.data ?? err.message)
    }
  }

  // ── Bridge: ClawChat → IM ───────────────────────────────────────────────────

  /**
   * Send a ClawChat message out through the named IM channel.
   *
   * @param clawMsg      ClawChat message object (must have `.content` string)
   * @param targetChannel  Channel name, e.g. 'telegram'
   * @param targetId       Recipient ID on that platform (user/group)
   */
  async bridgeFromClawChat(
    clawMsg: { content: string; markdown?: string; image?: string; replyTo?: string },
    targetChannel: string,
    targetId: string,
  ): Promise<void> {
    const ch = this.channels.get(targetChannel)
    if (!ch) {
      console.warn(`[bridge] Channel not found: ${targetChannel}`)
      return
    }
    if (!ch.isConnected()) {
      console.warn(`[bridge] Channel not connected: ${targetChannel}`)
      return
    }

    const content: MessageContent = {
      text:    clawMsg.content,
      markdown: clawMsg.markdown,
      image:   clawMsg.image,
      replyTo: clawMsg.replyTo,
    }

    try {
      await ch.sendMessage(targetId, content)
      console.log(`[bridge] ClawChat→IM [${targetChannel}] to=${targetId}`)
    } catch (err: any) {
      console.error(`[bridge] ClawChat→IM failed [${targetChannel}]:`, err.message)
    }
  }

  // ── Auto-connect from saved config ─────────────────────────────────────────

  /**
   * Connect all channels whose configs are saved in channels.json.
   * Called at Node startup; failures are non-fatal.
   */
  async autoConnect(): Promise<void> {
    const { channelConfigs } = loadChannelsFile()
    const names = Object.keys(channelConfigs)
    if (names.length === 0) return

    console.log(`[bridge] Auto-connecting ${names.length} saved channel(s): ${names.join(', ')}`)
    for (const name of names) {
      const ch = this.channels.get(name)
      if (!ch) {
        console.warn(`[bridge] Auto-connect: no adapter registered for "${name}", skipping`)
        continue
      }
      try {
        await ch.connect(channelConfigs[name]!)
        console.log(`[bridge] Auto-connected: ${name}`)
      } catch (err: any) {
        console.error(`[bridge] Auto-connect failed for ${name}:`, err.message)
      }
    }
  }

  /**
   * Save a channel config to channels.json (persists for auto-connect on restart).
   */
  saveChannelConfig(name: string, config: ChannelConfig): void {
    const data = loadChannelsFile()
    data.channelConfigs[name] = config
    saveChannelsFile(data)
  }

  /**
   * Disconnect all channels cleanly (called on SIGTERM/SIGINT).
   */
  async disconnectAll(): Promise<void> {
    for (const ch of this.channels.values()) {
      try {
        await ch.disconnect()
      } catch {
        // best-effort
      }
    }
  }
}
