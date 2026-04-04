// ChatApp — 完整聊天应用主组件：会话列表 + 消息区域 + 输入框

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ChatThread, type ChatMessage } from '../api.js';
import { useWebSocket } from '../useWebSocket.js';
import { MessageBubble } from './MessageBubble.js';
import { ThreadList } from './ThreadList.js';
import { ChatInput } from './ChatInput.js';
import { EmojiPicker } from './EmojiPicker.js';

interface Props {
  token: string;
  nodeId: string | null;
}

type MsgType = 'human' | 'task' | 'ask';

export const ChatApp: React.FC<Props> = ({ token, nodeId }) => {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [histMessages, setHistMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [msgType, setMsgType] = useState<MsgType>('human');
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages: wsMessages, send: wsSend, connected, connecting } = useWebSocket(nodeId);

  // ── Load thread list ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!nodeId) return;
    let cancelled = false;

    api.chat.threads(token, nodeId)
      .then(res => { if (!cancelled) setThreads(res.threads); })
      .catch(() => { /* silent */ });

    return () => { cancelled = true; };
  }, [token, nodeId]);

  // ── Load thread messages ────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeThreadId) {
      setHistMessages([]);
      return;
    }
    setLoadingThread(true);

    api.chat.thread(token, activeThreadId)
      .then(res => setHistMessages(res.messages))
      .catch(() => setHistMessages([]))
      .finally(() => setLoadingThread(false));
  }, [token, activeThreadId]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [histMessages, wsMessages]);

  // ── Send message ────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !nodeId) return;

    setInputText('');
    setSending(true);
    setReplyTo(null);

    if (connected) {
      wsSend(text);
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
  }, [inputText, nodeId, token, connected, wsSend, activeThreadId, msgType]);

  // ── Insert emoji ────────────────────────────────────────────────────────────
  const handleEmojiSelect = useCallback((emoji: string) => {
    setInputText(prev => prev + emoji);
    setShowEmoji(false);
  }, []);

  // ── Reply to message ────────────────────────────────────────────────────────
  const handleReply = useCallback((msg: ChatMessage) => {
    setReplyTo(msg);
  }, []);

  const displayMessages = activeThreadId ? histMessages : wsMessages.map(m => ({
    id: m.id,
    threadId: '',
    role: m.role,
    content: m.content,
    createdAt: m.timestamp,
    tokens: undefined,
  }));

  const wsStatus = connecting ? 'connecting' : connected ? 'connected' : 'disconnected';

  // ── Current thread info ─────────────────────────────────────────────────────
  const currentThread = threads.find(t => t.id === activeThreadId);
  const threadTitle = currentThread?.title ?? (activeThreadId ? `会话 #${activeThreadId.slice(-6)}` : '实时对话');

  return (
    <div className="chat-app">
      {/* ── 左侧：会话列表 ── */}
      <ThreadList
        threads={threads}
        activeThreadId={activeThreadId}
        wsMessages={wsMessages}
        wsStatus={wsStatus}
        onSelectThread={setActiveThreadId}
      />

      {/* ── 右侧：消息区域 ── */}
      <div className="chat-app-main">
        {/* 顶部：当前会话标题 */}
        <div className="chat-app-header">
          <div className="chat-thread-title">{threadTitle}</div>
          {nodeId && (
            <div className="chat-node-info">
              <span className="chat-node-label">节点：</span>
              <span className="chat-node-id">{nodeId}</span>
            </div>
          )}
        </div>

        {/* 消息列表 */}
        <div className="chat-messages-area">
          {loadingThread ? (
            <div className="chat-loading">加载中…</div>
          ) : displayMessages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">💬</div>
              <div>暂无消息{nodeId ? '' : ' — 请先选择节点'}</div>
            </div>
          ) : (
            displayMessages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                onReply={handleReply}
                replyTo={replyTo?.id === msg.id ? replyTo : undefined}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 回复引用提示 */}
        {replyTo && (
          <div className="chat-reply-bar">
            <span className="chat-reply-label">回复：</span>
            <span className="chat-reply-content">{replyTo.content.slice(0, 50)}...</span>
            <button className="chat-reply-cancel" onClick={() => setReplyTo(null)}>✕</button>
          </div>
        )}

        {/* 输入区域 */}
        <ChatInput
          value={inputText}
          onChange={setInputText}
          onSend={handleSend}
          disabled={!nodeId || sending}
          sending={sending}
          msgType={msgType}
          onMsgTypeChange={setMsgType}
          onEmojiClick={() => setShowEmoji(v => !v)}
        />

        {/* 表情选择器 */}
        {showEmoji && (
          <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmoji(false)} />
        )}
      </div>
    </div>
  );
};
