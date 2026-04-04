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
  nodeId?: string;
}

export interface UseWebSocketResult {
  messages: WsMessage[];
  socialMessages: SocialMessage[];
  send: (content: string) => void;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  clearMessages: () => void;
}

/**
 * token: JWT user token — connects via ?token=<jwt> (recommended, auth-verified).
 * Alternatively pass nodeId directly via nodeId param for node clients.
 */
export function useWebSocket(
  nodeId: string | null,
  token?: string | null,
): UseWebSocketResult {
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [socialMessages, setSocialMessages] = useState<SocialMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeIdRef = useRef(nodeId);
  const tokenRef = useRef(token);
  nodeIdRef.current = nodeId;
  tokenRef.current = token;

  const clearMessages = useCallback(() => {
    setMessages([]);
    setSocialMessages([]);
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

    // Prefer JWT token auth; fall back to nodeId
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

        // Social message envelope
        if (envelope.event === 'social' && envelope.data) {
          setSocialMessages(prev => [...prev, envelope.data as SocialMessage]);
          return;
        }

        // Chat message envelope
        if (envelope.event === 'message' && envelope.data) {
          const d = envelope.data as Partial<WsMessage>;
          setMessages(prev => [...prev, {
            id: d.id ?? crypto.randomUUID(),
            role: d.role ?? 'assistant',
            content: (d as { content?: string }).content ?? '',
            timestamp: (d as { ts?: number }).ts ?? Date.now(),
          }]);
          return;
        }

        // ack / receipt — ignore silently
        if (envelope.event === 'ack' || envelope.event === 'receipt') return;

        // Legacy flat message format (old node protocol)
        if (envelope.content != null) {
          setMessages(prev => [...prev, {
            id: envelope.id ?? crypto.randomUUID(),
            role: envelope.role ?? 'assistant',
            content: envelope.content ?? '',
            timestamp: envelope.timestamp ?? Date.now(),
          }]);
        }
      } catch {
        // Raw text fallback
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: String(event.data),
          timestamp: Date.now(),
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

  // Reconnect when nodeId or token changes
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
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [nodeId, token, connect]);

  const send = useCallback((content: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('未连接，无法发送');
      return;
    }
    const id = nodeIdRef.current;
    const msg: WsMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
    wsRef.current.send(JSON.stringify({ type: 'message', content, nodeId: id }));
  }, []);

  return { messages, socialMessages, send, connected, connecting, error, clearMessages };
}
