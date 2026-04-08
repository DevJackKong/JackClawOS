import axios from 'axios'
import type { JackClawConfig } from './config'
import type { NodeIdentity } from '@jackclaw/protocol'

/**
 * Register this node with the Hub.
 * Hub endpoint: POST /api/register
 */
export async function registerWithHub(
  identity: NodeIdentity,
  config: JackClawConfig,
): Promise<void> {
  const url = `${config.hubUrl}/api/register`
  const payload = {
    nodeId: identity.nodeId,
    name: identity.displayName ?? identity.nodeId,
    role: identity.role ?? 'worker',
    publicKey: identity.publicKey,
    callbackUrl: config.callbackUrl ?? `http://localhost:${config.port}`,
  }

  try {
    const res = await axios.post(url, payload, { timeout: 10_000 })
    console.log(`[hub] Registered with Hub at ${url}. Status: ${res.status}`)
  } catch (err: any) {
    const msg = err?.response?.data ?? err?.message ?? String(err)
    console.warn(`[hub] Registration failed (will retry on next start): ${msg}`)
  }
}

/**
 * Send a report message to the Hub.
 * Hub endpoint: POST /api/report
 */
export async function sendReportToHub(
  nodeId: string,
  encryptedMessage: string,
  config: JackClawConfig,
): Promise<void> {
  const url = `${config.hubUrl}/api/report`
  try {
    const res = await axios.post(url, { nodeId, message: encryptedMessage }, { timeout: 15_000 })
    console.log(`[hub] Report sent. Status: ${res.status}`)
  } catch (err: any) {
    const msg = err?.response?.data ?? err?.message ?? String(err)
    console.error(`[hub] Failed to send report: ${msg}`)
  }
}
