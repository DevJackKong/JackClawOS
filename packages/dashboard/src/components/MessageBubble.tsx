// MessageBubble — 单条消息气泡，区分自己/对方，支持多种消息类型

import React, { useState, useRef } from 'react';
import type { ChatMessage } from '../api.js';

interface Props {
  msg: ChatMessage;
  onReply?: (msg: ChatMessage) => void;
  replyTo?: ChatMessage;
}

type SendStatus = 'sent' | 'delivered' | 'read';

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_ICONS: Record<SendStatus, string> = {
  sent:      '✓',
  delivered: '✓✓',
  read:      '✓✓',
};

// Long-press detection threshold
const LONG_PRESS_MS = 500;

export const MessageBubble: React.FC<Props> = ({ msg, onReply, replyTo }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSelf = msg.role === 'user';
  const isSystem = msg.role === 'system';

  // Simulated status for user messages
  const status: SendStatus = 'read';

  function handleLongPressStart() {
    pressTimer.current = setTimeout(() => setMenuOpen(true), LONG_PRESS_MS);
  }
  function handleLongPressEnd() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }

  function copyText() {
    void navigator.clipboard.writeText(msg.content);
    setMenuOpen(false);
  }
  function replyMsg() {
    onReply?.(msg);
    setMenuOpen(false);
  }
  function deleteMsg() {
    // Placeholder — would call API
    setMenuOpen(false);
  }

  if (isSystem) {
    return (
      <div className="msg-row msg-system">
        <div className="msg-bubble-system">{msg.content}</div>
        <span className="msg-time-system">{fmtTime(msg.createdAt)}</span>
      </div>
    );
  }

  return (
    <div className={`msg-row ${isSelf ? 'msg-self' : 'msg-other'}`} onClick={() => setMenuOpen(false)}>
      {/* Avatar (other side only) */}
      {!isSelf && (
        <div className="msg-avatar">
          <span>{msg.role === 'assistant' ? '🤖' : '?'}</span>
        </div>
      )}

      <div className="msg-body">
        {/* Reply-to preview */}
        {replyTo && (
          <div className="msg-reply-preview">
            <span className="msg-reply-preview-text">{replyTo.content.slice(0, 40)}</span>
          </div>
        )}

        {/* Bubble */}
        <div
          className={`msg-bubble ${isSelf ? 'msg-bubble-self' : 'msg-bubble-other'}`}
          onMouseDown={handleLongPressStart}
          onMouseUp={handleLongPressEnd}
          onTouchStart={handleLongPressStart}
          onTouchEnd={handleLongPressEnd}
          onContextMenu={e => { e.preventDefault(); setMenuOpen(true); }}
        >
          {/* Image message */}
          {msg.content.startsWith('[image]') ? (
            <img
              className="msg-image"
              src={msg.content.replace('[image]', '').trim()}
              alt="图片消息"
            />
          ) : /* File message */
          msg.content.startsWith('[file]') ? (
            <div className="msg-file">
              <span className="msg-file-icon">📎</span>
              <span className="msg-file-name">{msg.content.replace('[file]', '').trim()}</span>
            </div>
          ) : (
            <div className="msg-text">{msg.content}</div>
          )}

          {/* Footer: time + status */}
          <div className="msg-meta">
            <span className="msg-time">{fmtTime(msg.createdAt)}</span>
            {isSelf && (
              <span className={`msg-status msg-status-${status}`}>
                {STATUS_ICONS[status]}
              </span>
            )}
            {msg.tokens != null && (
              <span className="msg-tokens">{msg.tokens}t</span>
            )}
          </div>
        </div>
      </div>

      {/* Context menu */}
      {menuOpen && (
        <div className={`msg-context-menu ${isSelf ? 'msg-context-menu-self' : 'msg-context-menu-other'}`}>
          <button className="msg-ctx-btn" onClick={copyText}>复制</button>
          <button className="msg-ctx-btn" onClick={replyMsg}>回复</button>
          <button className="msg-ctx-btn" onClick={() => { /* forward placeholder */ setMenuOpen(false); }}>转发</button>
          <button className="msg-ctx-btn msg-ctx-danger" onClick={deleteMsg}>删除</button>
        </div>
      )}
    </div>
  );
};
