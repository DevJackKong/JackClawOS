// ChatApp — Social messaging: thread list (left) + message area (center) + online users (right)
// Connects to hub via JWT-authenticated WebSocket for real-time delivery.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SocialMessage, type SocialThread } from '../api.js';
import { useWebSocket } from '../useWebSocket.js';

interface Props {
  token: string;
  userHandle: string;    // @alice
  displayName: string;
}

interface OnlineUser {
  handle: string;
  displayName: string;
  nodeId: string;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function otherParticipant(thread: SocialThread, myHandle: string): string {
  return thread.participants.find(p => p !== myHandle) ?? thread.participants[0] ?? '?';
}

export const ChatApp: React.FC<Props> = ({ token, userHandle, displayName }) => {
  const [threads, setThreads]           = useState<SocialThread[]>([]);
  const [activeThread, setActive]       = useState<SocialThread | null>(null);
  const [messages, setMessages]         = useState<SocialMessage[]>([]);
  const [inputText, setInputText]       = useState('');
  const [sending, setSending]           = useState(false);
  const [loadingMsgs, setLoadingMsgs]   = useState(false);

  // New conversation modal
  const [showNewChat, setShowNewChat]   = useState(false);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null); // @handle

  // Online users sidebar
  const [onlineUsers, setOnlineUsers]   = useState<OnlineUser[]>([]);
  const [loadingOnline, setLoadingOnline] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

  // JWT-authenticated WebSocket — receives social messages in real-time
  const { socialMessages, connected, connecting } = useWebSocket(null, token);

  // ── Load online users (sidebar) ─────────────────────────────────────────────
  const loadOnline = useCallback(() => {
    setLoadingOnline(true);
    api.presence.online(token)
      .then(r => setOnlineUsers(r.users.filter(u => u.handle !== userHandle)))
      .catch(() => setOnlineUsers([]))
      .finally(() => setLoadingOnline(false));
  }, [token, userHandle]);

  useEffect(() => {
    loadOnline();
    const iv = setInterval(loadOnline, 30_000);
    return () => clearInterval(iv);
  }, [loadOnline]);

  // ── Load threads ────────────────────────────────────────────────────────────
  const loadThreads = useCallback(() => {
    if (!userHandle) return;
    api.social.threads(token, userHandle)
      .then(r => setThreads(r.threads))
      .catch(() => {});
  }, [token, userHandle]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // ── Load messages for active thread ─────────────────────────────────────────
  useEffect(() => {
    if (!activeThread) { setMessages([]); return; }
    setLoadingMsgs(true);
    api.social.threadMessages(token, activeThread.id)
      .then(r => setMessages(r.messages.slice().sort((a, b) => a.ts - b.ts)))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false));
  }, [token, activeThread]);

  // ── Append real-time social messages ────────────────────────────────────────
  useEffect(() => {
    if (socialMessages.length === 0) return;
    const latest = socialMessages[socialMessages.length - 1];
    if (!latest) return;

    if (activeThread && latest.thread === activeThread.id) {
      setMessages(prev => {
        if (prev.some(m => m.id === latest.id)) return prev;
        return [...prev, latest];
      });
    }
    loadThreads();
  }, [socialMessages, activeThread, loadThreads]);

  // ── Auto-scroll to bottom ───────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Title blink on new message ───────────────────────────────────────────────
  useEffect(() => {
    if (socialMessages.length === 0) return;
    const orig = document.title;
    document.title = '● 新消息 — JackClaw';
    const t = setTimeout(() => { document.title = orig; }, 3000);
    return () => { clearTimeout(t); document.title = orig; };
  }, [socialMessages.length]);

  // ── Start chat with a user (from sidebar or modal) ──────────────────────────
  const startChatWith = useCallback((handle: string) => {
    setShowNewChat(false);
    const existing = threads.find(
      t => t.participants.includes(handle) && t.participants.includes(userHandle),
    );
    if (existing) {
      setActive(existing);
      setPendingTarget(null);
    } else {
      setPendingTarget(handle);
      setActive(null);
      setMessages([]);
    }
  }, [threads, userHandle]);

  // ── Open new conversation modal ─────────────────────────────────────────────
  const openNewChat = useCallback(() => {
    setShowNewChat(true);
    loadOnline();
  }, [loadOnline]);

  // ── Send message ─────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    const toAgent = activeThread ? otherParticipant(activeThread, userHandle) : pendingTarget;
    if (!text || !toAgent) return;

    setSending(true);
    setInputText('');

    const optimistic: SocialMessage = {
      id: crypto.randomUUID(),
      fromHuman: displayName,
      fromAgent: userHandle,
      toAgent,
      content: text,
      type: 'text',
      thread: activeThread?.id,
      ts: Date.now(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const res = await api.social.send(token, {
        fromHuman: displayName,
        fromAgent: userHandle,
        toAgent,
        content: text,
        type: 'text',
      });

      if (pendingTarget) {
        setPendingTarget(null);
        api.social.threads(token, userHandle).then(r => {
          setThreads(r.threads);
          const newThread = r.threads.find(t => t.id === res.thread);
          if (newThread) setActive(newThread);
        }).catch(() => {});
      } else {
        loadThreads();
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }, [inputText, activeThread, pendingTarget, userHandle, displayName, token, loadThreads]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const wsStatus = connecting ? 'connecting' : connected ? 'connected' : 'disconnected';
  const chatTitle = activeThread ? otherParticipant(activeThread, userHandle) : pendingTarget ?? null;

  return (
    <div className="chat-panel">
      {/* ── Left: thread list ── */}
      <aside className="thread-sidebar">
        <div className="sidebar-header">
          <span className="sidebar-title">消息</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={openNewChat}
              title="新建对话"
              style={{
                background: 'none', border: '1px solid #30363d', borderRadius: 4,
                color: '#f97316', cursor: 'pointer', fontSize: 16, lineHeight: 1,
                padding: '2px 6px', fontWeight: 700,
              }}
            >+</button>
            <div className={`ws-status ws-${wsStatus}`} title={`WebSocket: ${wsStatus}`}>
              <span className="ws-dot" />
              {wsStatus === 'connected' ? '实时' : wsStatus === 'connecting' ? '…' : '离线'}
            </div>
          </div>
        </div>

        <div className="thread-list">
          {pendingTarget && (
            <button
              className="thread-item thread-active"
              onClick={() => {}}
              style={{ borderLeft: '2px solid #f97316' }}
            >
              <div className="thread-title">{pendingTarget} <span style={{ fontSize: 10, color: '#8b949e' }}>新</span></div>
              <div className="thread-meta">
                <span className="thread-count" style={{ color: '#8b949e' }}>尚未发送消息</span>
              </div>
            </button>
          )}

          {threads.length === 0 && !pendingTarget ? (
            <div style={{ padding: '20px 12px', color: '#8b949e', fontSize: 13, textAlign: 'center' }}>
              暂无会话<br />
              <span style={{ fontSize: 12 }}>点击 + 开始新对话</span>
            </div>
          ) : (
            threads.map(t => {
              const other = otherParticipant(t, userHandle);
              return (
                <button
                  key={t.id}
                  className={`thread-item ${activeThread?.id === t.id ? 'thread-active' : ''}`}
                  onClick={() => { setPendingTarget(null); setActive(t); }}
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

      {/* ── Center: message area ── */}
      <div className="chat-main">
        {!chatTitle ? (
          <div className="chat-empty" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div className="chat-empty-icon">💬</div>
            <div>选择一个会话或点击 + 开始新对话</div>
          </div>
        ) : (
          <>
            <div className="chat-app-header">
              <div className="chat-thread-title">{chatTitle}</div>
              <div className="chat-node-info" style={{ fontSize: 12, color: '#8b949e' }}>
                {activeThread ? `${activeThread.messageCount} 条消息` : '新对话'}
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

      {/* ── Right: online users sidebar ── */}
      <aside className="online-sidebar">
        <div className="sidebar-header">
          <span className="sidebar-title">在线</span>
          {!loadingOnline && (
            <span style={{ fontSize: 11, color: '#22c55e', padding: '2px 7px', border: '1px solid #22c55e44', borderRadius: 20 }}>
              {onlineUsers.length}
            </span>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingOnline && onlineUsers.length === 0 ? (
            <div style={{ padding: '16px 12px', color: '#8b949e', fontSize: 12, textAlign: 'center' }}>加载中…</div>
          ) : onlineUsers.length === 0 ? (
            <div style={{ padding: '16px 12px', color: '#8b949e', fontSize: 12, textAlign: 'center' }}>暂无在线用户</div>
          ) : (
            onlineUsers.map(u => (
              <button
                key={u.handle}
                onClick={() => startChatWith(u.handle)}
                title={`与 ${u.displayName} 开始对话`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '8px 10px',
                  background: 'none', border: 'none',
                  borderBottom: '1px solid #21262d',
                  cursor: 'pointer', color: '#e6edf3', textAlign: 'left',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#21262d'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: '#f97316', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {(u.displayName || u.handle)[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 8, height: 8, borderRadius: '50%',
                    background: '#22c55e', border: '1.5px solid #161b22',
                  }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.displayName}
                  </div>
                  <div style={{ fontSize: 10, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.handle}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ── New conversation modal ── */}
      {showNewChat && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewChat(false); }}
        >
          <div style={{
            background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
            width: 340, maxHeight: 480, display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: '#e6edf3' }}>新建对话</span>
              <button
                onClick={() => setShowNewChat(false)}
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 18 }}
              >×</button>
            </div>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #21262d', fontSize: 12, color: '#8b949e' }}>
              当前在线用户
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loadingOnline ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#8b949e', fontSize: 13 }}>加载中…</div>
              ) : onlineUsers.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#8b949e', fontSize: 13 }}>暂无在线用户</div>
              ) : (
                onlineUsers.map(u => (
                  <button
                    key={u.handle}
                    onClick={() => startChatWith(u.handle)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 16px', background: 'none',
                      border: 'none', borderBottom: '1px solid #21262d', cursor: 'pointer',
                      color: '#e6edf3', textAlign: 'left',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#1c2128'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: '#f97316', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 600, flexShrink: 0,
                    }}>
                      {(u.displayName || u.handle)[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{u.displayName}</div>
                      <div style={{ fontSize: 12, color: '#8b949e' }}>{u.handle}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
