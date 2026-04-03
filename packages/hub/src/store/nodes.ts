// JackClaw Hub - Node Registry Store
// Persists to ~/.jackclaw/hub/nodes.json

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { NodeRegistry, RegisteredNode } from '../types'

const STORE_DIR = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const NODES_FILE = path.join(STORE_DIR, 'nodes.json')

function ensureDir(): void {
  fs.mkdirSync(STORE_DIR, { recursive: true })
}

function readRegistry(): NodeRegistry {
  ensureDir()
  if (!fs.existsSync(NODES_FILE)) {
    return { nodes: {}, updatedAt: Date.now() }
  }
  try {
    const raw = fs.readFileSync(NODES_FILE, 'utf-8')
    return JSON.parse(raw) as NodeRegistry
  } catch {
    return { nodes: {}, updatedAt: Date.now() }
  }
}

function writeRegistry(registry: NodeRegistry): void {
  ensureDir()
  registry.updatedAt = Date.now()
  fs.writeFileSync(NODES_FILE, JSON.stringify(registry, null, 2), 'utf-8')
}

export function registerNode(node: Omit<RegisteredNode, 'registeredAt'>): RegisteredNode {
  const registry = readRegistry()
  const registered: RegisteredNode = {
    ...node,
    registeredAt: Date.now(),
  }
  registry.nodes[node.nodeId] = registered
  writeRegistry(registry)
  return registered
}

export function getNode(nodeId: string): RegisteredNode | undefined {
  const registry = readRegistry()
  return registry.nodes[nodeId]
}

export function getAllNodes(): RegisteredNode[] {
  const registry = readRegistry()
  return Object.values(registry.nodes)
}

export function updateLastReport(nodeId: string): void {
  const registry = readRegistry()
  if (registry.nodes[nodeId]) {
    registry.nodes[nodeId].lastReportAt = Date.now()
    writeRegistry(registry)
  }
}

export function nodeExists(nodeId: string): boolean {
  const registry = readRegistry()
  return nodeId in registry.nodes
}

// Generate a stable node ID from publicKey if not provided
export function deriveNodeId(publicKey: string): string {
  return crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16)
}
