// ChatPanel — ClawChat: thread list (left) + message stream (right) + input

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ChatThread, type ChatMessage } from '../api.js';
import { useWebSocket } from '../useWebSocket.js';

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

const MessageBubble: React.FC<{ msg: ChatMessage }> = ({ msg }) => (
  <div className={`msg-row msg-${msg.role}`}>
    <div className="msg-bubble">
      <div className="msg-content">{msg.content}</div>
      <div className="msg-footer">
        <span className="msg-role">{msg.role}</span>
        <span className="msg-time">{fmtTime(msg.createdAt)}</span>
        {msg.tokens != null && <span className="msg-tokens">{msg.tokens}t</span>}
      </div>
    </div>
  </div>
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages: wsMessages, send: wsSend, connected, connecting } = useWebSocket(nodeId);

  // Load thread list
  useEffect(() => {
    if (!nodeId) return;
    let cancelled = false;

    api.chat.threads(token, nodeId)
      .then(res => { if (!cancelled) setThreads(res.threads); })
      .catch(() => { /* silent */ });

    return () => { cancelled = true; };
  }, [token, nodeId]);

  // Load thread messages when selection changes
  useEffect(() => {
    if (!activeThreadId) { setHistMessages([]); return; }
    setLoadingThread(true);

    api.chat.thread(token, activeThreadId)
      .then(res => setHistMessages(res.messages))
      .catch(() => setHistMessages([]))
      .finally(() => setLoadingThread(false));
  }, [token, activeThreadId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [histMessages, wsMessages]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !nodeId) return;

    setInputText('');
    setSending(true);

    if (connected) {
      wsSend(text);
      setSending(false);
    } else {
      try {
        const res = await api.chat.send(token, { nodeId, content: text, threadId: activeThreadId ?? undefined });
        setActiveThreadId(res.threadId);
        setHistMessages(prev => [...prev, res.message]);
      } catch {
        // silent
      } finally {
        setSending(false);
      }
    }
  }, [inputText, nodeId, token, connected, wsSend, activeThreadId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const displayMessages = activeThreadId ? histMessages : wsMessages.map(m => ({
    id: m.id,
    threadId: '',
    role: m.role,
    content: m.content,
    createdAt: m.timestamp,
    tokens: undefined,
  }));

  const wsStatus = connecting ? 'connecting' : connected ? 'connected' : 'disconnected';

  return (
    <div className="chat-panel">
      {/* Thread sidebar */}
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
            <ThreadItem
              key={t.id}
              thread={t}
              active={activeThreadId === t.id}
              onClick={() => setActiveThreadId(t.id)}
            />
          ))}
        </div>
      </aside>

      {/* Message area */}
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
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-bar">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={nodeId ? '输入消息… (Enter 发送, Shift+Enter 换行)' : '请先选择目标节点'}
            disabled={!nodeId || sending}
            rows={2}
          />
          <button
            className={`send-btn ${sending ? 'send-loading' : ''}`}
            onClick={() => void handleSend()}
            disabled={!nodeId || sending || !inputText.trim()}
          >
            {sending ? '…' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
};
