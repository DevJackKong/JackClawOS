// ChatApp — Social messaging: thread list (left) + message area (right)
// Connects to hub via JWT-authenticated WebSocket for real-time delivery.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SocialMessage, type SocialThread } from '../api.js';
import { useWebSocket } from '../useWebSocket.js';

interface Props {
  token: string;
  userHandle: string;    // @alice
  displayName: string;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function otherParticipant(thread: SocialThread, myHandle: string): string {
  return thread.participants.find(p => p !== myHandle) ?? thread.participants[0] ?? '?';
}

export const ChatApp: React.FC<Props> = ({ token, userHandle, displayName }) => {
  const [threads, setThreads]       = useState<SocialThread[]>([]);
  const [activeThread, setActive]   = useState<SocialThread | null>(null);
  const [messages, setMessages]     = useState<SocialMessage[]>([]);
  const [inputText, setInputText]   = useState('');
  const [sending, setSending]       = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  // JWT-authenticated WebSocket — receives social messages in real-time
  const { socialMessages, connected, connecting } = useWebSocket(null, token);

  // ── Load threads ──────────────────────────────────────────────────────────
  const loadThreads = useCallback(() => {
    if (!userHandle) return;
    api.social.threads(token, userHandle)
      .then(r => setThreads(r.threads))
      .catch(() => {});
  }, [token, userHandle]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // ── Load messages for active thread ──────────────────────────────────────
  useEffect(() => {
    if (!activeThread) { setMessages([]); return; }
    setLoadingMsgs(true);
    api.social.messages(token, userHandle, 100)
      .then(r => {
        const threadMsgs = r.messages.filter(m => m.thread === activeThread.id);
        setMessages(threadMsgs.sort((a, b) => a.ts - b.ts));
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false));
  }, [token, userHandle, activeThread]);

  // ── Append real-time social messages ──────────────────────────────────────
  useEffect(() => {
    if (socialMessages.length === 0) return;
    const latest = socialMessages[socialMessages.length - 1];
    if (!latest) return;

    // Append to active thread if it matches, or refresh threads
    if (activeThread && latest.thread === activeThread.id) {
      setMessages(prev => {
        if (prev.some(m => m.id === latest.id)) return prev;
        return [...prev, latest];
      });
    }
    // Refresh thread list to update last message preview
    loadThreads();
  }, [socialMessages, activeThread, loadThreads]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Title blink on new message ────────────────────────────────────────────
  useEffect(() => {
    if (socialMessages.length === 0) return;
    const orig = document.title;
    document.title = '● 新消息 — JackClaw';
    const t = setTimeout(() => { document.title = orig; }, 3000);
    return () => { clearTimeout(t); document.title = orig; };
  }, [socialMessages.length]);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !activeThread) return;

    const toAgent = otherParticipant(activeThread, userHandle);
    setSending(true);
    setInputText('');

    const optimistic: SocialMessage = {
      id: crypto.randomUUID(),
      fromHuman: displayName,
      fromAgent: userHandle,
      toAgent,
      content: text,
      type: 'text',
      thread: activeThread.id,
      ts: Date.now(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      await api.social.send(token, {
        fromHuman: displayName,
        fromAgent: userHandle,
        toAgent,
        content: text,
        type: 'text',
      });
      loadThreads();
    } catch {
      // Remove optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }, [inputText, activeThread, userHandle, displayName, token, loadThreads]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const wsStatus = connecting ? 'connecting' : connected ? 'connected' : 'disconnected';

  return (
    <div className="chat-panel">
      {/* ── Left: thread list ── */}
      <aside className="thread-sidebar">
        <div className="sidebar-header">
          <span className="sidebar-title">消息</span>
          <div className={`ws-status ws-${wsStatus}`} title={`WebSocket: ${wsStatus}`}>
            <span className="ws-dot" />
            {wsStatus === 'connected' ? '实时' : wsStatus === 'connecting' ? '…' : '离线'}
          </div>
        </div>

        <div className="thread-list">
          {threads.length === 0 ? (
            <div style={{ padding: '20px 12px', color: '#8b949e', fontSize: 13, textAlign: 'center' }}>
              暂无会话<br />
              <span style={{ fontSize: 12 }}>在联系人页添加好友后开始聊天</span>
            </div>
          ) : (
            threads.map(t => {
              const other = otherParticipant(t, userHandle);
              return (
                <button
                  key={t.id}
                  className={`thread-item ${activeThread?.id === t.id ? 'thread-active' : ''}`}
                  onClick={() => setActive(t)}
                >
                  <div className="thread-title">{other}</div>
                  <div className="thread-meta">
                    <span className="thread-count" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                      {t.lastMessage}
                    </span>
                    <span className="thread-time">{fmtTime(t.lastMessageAt)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* ── Right: message area ── */}
      <div className="chat-main">
        {!activeThread ? (
          <div className="chat-empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div className="chat-empty-icon">💬</div>
            <div>选择一个会话开始聊天</div>
          </div>
        ) : (
          <>
            <div className="chat-app-header">
              <div className="chat-thread-title">{otherParticipant(activeThread, userHandle)}</div>
              <div className="chat-node-info" style={{ fontSize: 12, color: '#8b949e' }}>
                {activeThread.messageCount} 条消息
              </div>
            </div>

            <div className="messages-area" style={{ flex: 1, overflowY: 'auto' }}>
              {loadingMsgs ? (
                <div className="chat-loading">加载中…</div>
              ) : messages.length === 0 ? (
                <div className="chat-empty">
                  <div className="chat-empty-icon">💬</div>
                  <div>暂无消息，发送第一条吧</div>
                </div>
              ) : (
                messages.map(msg => {
                  const isMine = msg.fromAgent === userHandle;
                  return (
                    <div
                      key={msg.id}
                      className={`msg-row ${isMine ? 'msg-user' : 'msg-assistant'}`}
                    >
                      <div className="msg-bubble">
                        {!isMine && (
                          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>
                            {msg.fromAgent}
                          </div>
                        )}
                        <div className="msg-content">{msg.content}</div>
                        <div className="msg-footer">
                          <span className="msg-time">{fmtTime(msg.ts)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            <div className="chat-input-bar">
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  className="chat-input"
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
                  disabled={sending}
                  rows={2}
                />
                <button
                  className={`send-btn ${sending ? 'send-loading' : ''}`}
                  onClick={() => void handleSend()}
                  disabled={sending || !inputText.trim()}
                >
                  {sending ? '…' : '发送'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
