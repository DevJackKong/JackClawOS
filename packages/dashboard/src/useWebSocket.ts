// ClawChat WebSocket hook — supports JWT token auth, auto-reconnect, social message envelopes

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SocialMessage } from './api.js';

const WS_BASE =
  typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
    : 'ws://localhost:3100';

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

export interface WsMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  threadId?: string;
  read?: boolean;
  readBy?: string[];
  nodeId?: string;
  event?: string;
}

export interface TypingEvent {
  from: string;
  to: string;
  threadId: string;
  isTyping: boolean;
  ts: number;
}

export interface MessageReadEvent {
  messageId: string;
  threadId?: string;
  readBy: string;
  ts: number;
}

export interface SendMessageOptions {
  threadId?: string;
  to?: string;
}

export interface UseWebSocketResult {
  messages: WsMessage[];
  socialMessages: SocialMessage[];
  typingEvent: TypingEvent | null;
  send: (content: string, options?: SendMessageOptions) => void;
  sendTyping: (payload: { threadId: string; to: string; isTyping: boolean }) => void;
  sendReadReceipt: (payload: { messageId: string }) => void;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  clearMessages: () => void;
}

export function useWebSocket(
  nodeId: string | null,
  token?: string | null,
): UseWebSocketResult {
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [socialMessages, setSocialMessages] = useState<SocialMessage[]>([]);
  const [typingEvent, setTypingEvent] = useState<TypingEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeIdRef = useRef(nodeId);
  const tokenRef = useRef(token);
  nodeIdRef.current = nodeId;
  tokenRef.current = token;

  const clearMessages = useCallback(() => {
    setMessages([]);
    setSocialMessages([]);
    setTypingEvent(null);
  }, []);

  const connect = useCallback(() => {
    const id  = nodeIdRef.current;
    const tok = tokenRef.current;
    if (!id && !tok) return;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnecting(true);
    setError(null);

    const param = tok
      ? `token=${encodeURIComponent(tok)}`
      : `nodeId=${encodeURIComponent(id ?? '')}`;
    const ws = new WebSocket(`${WS_BASE}/chat/ws?${param}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnecting(false);
      attemptsRef.current = 0;
      setError(null);
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const envelope = JSON.parse(event.data) as { event?: string; data?: unknown } & Partial<WsMessage>;

        if (envelope.event === 'social' && envelope.data) {
          setSocialMessages(prev => [...prev, envelope.data as SocialMessage]);
          return;
        }

        if (envelope.event === 'message' && envelope.data) {
          const d = envelope.data as Partial<WsMessage> & { ts?: number; content?: string; role?: 'user' | 'assistant' | 'system' };
          setMessages(prev => [...prev, {
            id: d.id ?? crypto.randomUUID(),
            role: d.role ?? 'assistant',
            content: d.content ?? '',
            timestamp: d.ts ?? Date.now(),
            threadId: d.threadId,
            read: d.read,
            readBy: d.readBy,
            event: 'message',
          }]);
          return;
        }

        if (envelope.event === 'typing' && envelope.data) {
          const typing = envelope.data as TypingEvent;
          setTypingEvent(typing);
          if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
          typingClearTimer.current = setTimeout(() => setTypingEvent(null), 3000);
          return;
        }

        if (envelope.event === 'message_read' && envelope.data) {
          const readEvent = envelope.data as MessageReadEvent;
          setMessages(prev => prev.map(msg => (
            msg.id === readEvent.messageId
              ? { ...msg, read: true, readBy: Array.from(new Set([...(msg.readBy ?? []), readEvent.readBy])) }
              : msg
          )));
          return;
        }

        if (envelope.event === 'ack' || envelope.event === 'receipt') return;

        if (envelope.content != null) {
          setMessages(prev => [...prev, {
            id: envelope.id ?? crypto.randomUUID(),
            role: envelope.role ?? 'assistant',
            content: envelope.content ?? '',
            timestamp: envelope.timestamp ?? Date.now(),
            threadId: envelope.threadId,
            read: envelope.read,
            readBy: envelope.readBy,
            event: 'message',
          }]);
        }
      } catch {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: String(event.data),
          timestamp: Date.now(),
          event: 'message',
        }]);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setConnecting(false);
      wsRef.current = null;

      const hasAuth = nodeIdRef.current || tokenRef.current;
      if (attemptsRef.current < MAX_RECONNECT_ATTEMPTS && hasAuth) {
        attemptsRef.current++;
        const delay = RECONNECT_DELAY_MS * Math.min(attemptsRef.current, 5);
        reconnectTimer.current = setTimeout(connect, delay);
      } else {
        setError('连接断开，请重试');
      }
    };

    ws.onerror = () => {
      setError('WebSocket 连接错误');
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    attemptsRef.current = 0;

    if (nodeId || token) {
      connect();
    } else {
      wsRef.current?.close();
      setConnected(false);
      setConnecting(false);
    }

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [nodeId, token, connect]);

  const send = useCallback((content: string, options?: SendMessageOptions) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('未连接，无法发送');
      return;
    }
    const msg: WsMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      threadId: options?.threadId,
      read: false,
      readBy: [],
      event: 'message',
    };
    setMessages(prev => [...prev, msg]);
    wsRef.current.send(JSON.stringify({
      id: msg.id,
      type: 'human',
      from: nodeIdRef.current,
      to: options?.to,
      content,
      threadId: options?.threadId,
      ts: msg.timestamp,
      signature: '',
      encrypted: false,
    }));
  }, []);

  const sendTyping = useCallback((payload: { threadId: string; to: string; isTyping: boolean }) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      event: 'typing',
      threadId: payload.threadId,
      to: payload.to,
      isTyping: payload.isTyping,
    }));
  }, []);

  const sendReadReceipt = useCallback((payload: { messageId: string }) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      event: 'read_receipt',
      messageId: payload.messageId,
    }));
  }, []);

  return {
    messages,
    socialMessages,
    typingEvent,
    send,
    sendTyping,
    sendReadReceipt,
    connected,
    connecting,
    error,
    clearMessages,
  };
}
