// ChatPanel — ClawChat: thread list (left) + message stream (right) + input

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ChatThread, type ChatMessage } from '../api.js';
import { useWebSocket } from '../useWebSocket.js';
import { ChatInput } from './ChatInput.js';
import { MessageBubble } from './MessageBubble.js';

interface Props {
  token: string;
  nodeId: string | null;
}

type MsgType = 'human' | 'task' | 'ask';

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

const ThreadItem: React.FC<{
  thread: ChatThread;
  active: boolean;
  onClick: () => void;
}> = ({ thread, active, onClick }) => (
  <button className={`thread-item ${active ? 'thread-active' : ''}`} onClick={onClick}>
    <div className="thread-title">{thread.title ?? `会话 #${thread.id.slice(-6)}`}</div>
    <div className="thread-meta">
      <span className="thread-count">{thread.messageCount} 条</span>
      <span className="thread-time">{fmtTime(thread.updatedAt)}</span>
    </div>
  </button>
);

export const ChatPanel: React.FC<Props> = ({ token, nodeId }) => {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [histMessages, setHistMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [msgType, setMsgType] = useState<MsgType>('human');
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages: wsMessages,
    typingEvent,
    send: wsSend,
    sendTyping,
    sendReadReceipt,
    connected,
    connecting,
  } = useWebSocket(nodeId, token);

  useEffect(() => {
    if (!nodeId) return;
    let cancelled = false;

    api.chat.threads(token, nodeId)
      .then(res => { if (!cancelled) setThreads(res.threads); })
      .catch(() => { /* silent */ });

    return () => { cancelled = true; };
  }, [token, nodeId]);

  useEffect(() => {
    if (!activeThreadId) { setHistMessages([]); return; }
    setLoadingThread(true);

    api.chat.thread(token, activeThreadId)
      .then(res => setHistMessages(res.messages))
      .catch(() => setHistMessages([]))
      .finally(() => setLoadingThread(false));
  }, [token, activeThreadId]);

  const displayMessages = useMemo<ChatMessage[]>(() => (
    activeThreadId
      ? histMessages
      : wsMessages.map(m => ({
          id: m.id,
          threadId: m.threadId ?? '',
          role: m.role,
          content: m.content,
          createdAt: m.timestamp,
          tokens: undefined,
          read: m.read,
          readBy: Array.isArray(m.readBy) ? m.readBy : undefined,
        }))
  ), [activeThreadId, histMessages, wsMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages, typingEvent]);

  useEffect(() => {
    if (!nodeId) return;
    displayMessages
      .filter(msg => msg.role !== 'user' && !msg.read)
      .forEach(msg => sendReadReceipt({ messageId: msg.id }));
  }, [displayMessages, nodeId, sendReadReceipt]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !nodeId) return;

    setInputText('');
    setSending(true);
    sendTyping({ threadId: activeThreadId ?? 'live', to: nodeId, isTyping: false });

    if (connected) {
      wsSend(text, { threadId: activeThreadId ?? 'live', to: nodeId });
      setSending(false);
    } else {
      try {
        const res = await api.chat.send(token, {
          nodeId,
          content: text,
          threadId: activeThreadId ?? undefined,
          type: msgType,
        });
        setActiveThreadId(res.threadId);
        setHistMessages(prev => [...prev, res.message]);
      } catch {
        // silent
      } finally {
        setSending(false);
      }
    }
  }, [inputText, nodeId, activeThreadId, connected, wsSend, sendTyping, token, msgType]);

  const handleTyping = useCallback((isTyping: boolean) => {
    if (!connected || !nodeId) return;
    sendTyping({ threadId: activeThreadId ?? 'live', to: nodeId, isTyping });
  }, [activeThreadId, connected, nodeId, sendTyping]);

  const showTyping = Boolean(
    typingEvent?.isTyping
    && typingEvent.to === nodeId
    && typingEvent.threadId === (activeThreadId ?? 'live')
  );

  const wsStatus = connecting ? 'connecting' : connected ? 'connected' : 'disconnected';

  return (
    <div className="chat-panel">
      <aside className="thread-sidebar">
        <div className="sidebar-header">
          <span className="sidebar-title">会话列表</span>
          <div className={`ws-status ws-${wsStatus}`}>
            <span className="ws-dot" />
            {wsStatus === 'connected' ? 'WS' : wsStatus === 'connecting' ? '…' : '离线'}
          </div>
        </div>

        <div className="thread-list">
          <button
            className={`thread-item ${activeThreadId === null ? 'thread-active' : ''}`}
            onClick={() => setActiveThreadId(null)}
          >
            <div className="thread-title">实时对话</div>
            <div className="thread-meta">
              <span className="thread-count">{wsMessages.length} 条</span>
              <span className="thread-time">直播</span>
            </div>
          </button>

          {threads.map(t => (
            <ThreadItem key={t.id} thread={t} active={activeThreadId === t.id} onClick={() => setActiveThreadId(t.id)} />
          ))}
        </div>
      </aside>

      <div className="chat-main">
        <div className="messages-area">
          {loadingThread ? (
            <div className="chat-loading">加载中…</div>
          ) : displayMessages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">💬</div>
              <div>暂无消息{nodeId ? '' : ' — 请先选择节点'}</div>
            </div>
          ) : (
            displayMessages.map(msg => (
              <MessageBubble key={msg.id} msg={msg} />
            ))
          )}
          {showTyping && (
            <div className="chat-typing" style={{ padding: '8px 12px', color: '#8b949e', fontSize: 12 }}>
              对方正在输入...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-bar">
          <ChatInput
            value={inputText}
            onChange={setInputText}
            onSend={() => void handleSend()}
            disabled={!nodeId || sending}
            sending={sending}
            msgType={msgType}
            onMsgTypeChange={setMsgType}
            onEmojiClick={() => {}}
            onTyping={handleTyping}
          />
        </div>
      </div>
    </div>
  );
};
