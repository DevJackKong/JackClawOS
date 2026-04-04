// ClawChat — message delivery/read receipt types
//
// Unified Message State Machine (6 states):
//
//   accepted → sent → acked → stored → consumed → failed
//
//   accepted  : Hub received and persisted the message
//   sent      : Hub pushed message to target WebSocket
//   acked     : Target node sent delivery_ack back to Hub
//   stored    : Target node wrote message to local store
//   consumed  : Target's handler/UI processed the message
//   failed    : Delivery failed after all retries exhausted
//
// Transitions:
//   → accepted : on Hub saveMessage()
//   → sent     : on ws.send() callback success
//   → acked    : on receiving delivery_ack from target node
//   → stored   : on target node confirming local store write
//   → consumed : on target handler/UI marking message as processed
//   → failed   : on delivery timeout with no ack after retries

export type MessageStatus =
  | 'accepted'   // Hub received & persisted
  | 'sent'       // Pushed to target WS
  | 'acked'      // Target node ACK'd receipt
  | 'stored'     // Target wrote to local store
  | 'consumed'   // Target handler processed
  | 'failed'     // Delivery failed
  | 'duplicate'  // Deduplicated (not stored again)

/** Valid state transitions */
export const STATUS_TRANSITIONS: Record<MessageStatus, MessageStatus[]> = {
  accepted:  ['sent', 'failed'],
  sent:      ['acked', 'failed'],
  acked:     ['stored', 'failed'],
  stored:    ['consumed'],
  consumed:  [],
  failed:    ['accepted'],  // retry resets to accepted
  duplicate: [],
}

export function isValidTransition(from: MessageStatus, to: MessageStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false
}

export interface DeliveryReceipt {
  messageId: string
  status: MessageStatus
  nodeId: string   // the node reporting this status
  ts: number
  /** Optional: trace of all state transitions */
  trace?: StatusTransition[]
}

export interface StatusTransition {
  from: MessageStatus
  to: MessageStatus
  nodeId: string
  ts: number
}

export interface ReadReceipt {
  messageId: string
  readBy: string   // nodeId that read the message
  ts: number
}

export interface TypingIndicator {
  fromAgent: string
  threadId: string
  isTyping: boolean
}
