// MessageBubble — 单条消息气泡，区分自己/对方，支持 Markdown 渲染和图片附件

import React, { useState, useRef } from 'react';
import type { ChatMessage } from '../api.js';

function renderMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const codeBlockRe = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIndex = 0;

  function processInline(chunk: string, baseKey: string): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    const inlineRe = /(`[^`]+`|\*\*[\s\S]+?\*\*|https?:\/\/[^\s<>"]+|\n)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = inlineRe.exec(chunk)) !== null) {
      if (m.index > last) nodes.push(chunk.slice(last, m.index));
      const token = m[0];
      if (token.startsWith('`')) {
        nodes.push(<code key={`${baseKey}-ic${k}`}>{token.slice(1, -1)}</code>);
      } else if (token.startsWith('**')) {
        nodes.push(<strong key={`${baseKey}-b${k}`}>{token.slice(2, -2)}</strong>);
      } else if (token.startsWith('http')) {
        nodes.push(<a key={`${baseKey}-a${k}`} href={token} target="_blank" rel="noreferrer">{token}</a>);
      } else if (token === '\n') {
        nodes.push(<br key={`${baseKey}-br${k}`} />);
      }
      last = m.index + token.length;
      k++;
    }
    if (last < chunk.length) nodes.push(chunk.slice(last));
    return nodes;
  }

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index);
      parts.push(...processInline(chunk, `c${keyIndex++}`));
    }
    parts.push(<pre key={`pre${keyIndex++}`}><code>{match[1]}</code></pre>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(...processInline(text.slice(lastIndex), `c${keyIndex++}`));
  }
  return parts;
}

interface Props {
  msg: ChatMessage;
  onReply?: (msg: ChatMessage) => void;
  replyTo?: ChatMessage;
}

type SendStatus = 'sent' | 'read';

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_ICONS: Record<SendStatus, string> = {
  sent: '✓',
  read: '✓✓',
};

const LONG_PRESS_MS = 500;

export const MessageBubble: React.FC<Props> = ({ msg, onReply, replyTo }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSelf = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const status: SendStatus = msg.read ? 'read' : 'sent';

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
      {!isSelf && (
        <div className="msg-avatar">
          <span>{msg.role === 'assistant' ? '🤖' : '?'}</span>
        </div>
      )}

      <div className="msg-body">
        {replyTo && (
          <div className="msg-reply-preview">
            <span className="msg-reply-preview-text">{replyTo.content.slice(0, 40)}</span>
          </div>
        )}

        <div
          className={`msg-bubble ${isSelf ? 'msg-bubble-self' : 'msg-bubble-other'}`}
          onMouseDown={handleLongPressStart}
          onMouseUp={handleLongPressEnd}
          onTouchStart={handleLongPressStart}
          onTouchEnd={handleLongPressEnd}
          onContextMenu={e => { e.preventDefault(); setMenuOpen(true); }}
        >
          {msg.content.startsWith('[image]') ? (
            <img className="msg-image" src={msg.content.replace('[image]', '').trim()} alt="图片消息" />
          ) : msg.content.startsWith('[file]') ? (
            <div className="msg-file">
              <span className="msg-file-icon">📎</span>
              <span className="msg-file-name">{msg.content.replace('[file]', '').trim()}</span>
            </div>
          ) : (
            <div className="msg-text">{renderMarkdown(msg.content)}</div>
          )}

          {msg.attachments?.filter(a => a.type === 'image').map((att, i) => (
            <img key={i} className="msg-image" src={att.data ?? att.url} alt={att.name} />
          ))}

          <div className="msg-meta">
            <span className="msg-time">{fmtTime(msg.createdAt)}</span>
            {isSelf && <span className={`msg-status msg-status-${status}`}>{STATUS_ICONS[status]}</span>}
            {msg.tokens != null && <span className="msg-tokens">{msg.tokens}t</span>}
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className={`msg-context-menu ${isSelf ? 'msg-context-menu-self' : 'msg-context-menu-other'}`}>
          <button className="msg-ctx-btn" onClick={copyText}>复制</button>
          <button className="msg-ctx-btn" onClick={replyMsg}>回复</button>
          <button className="msg-ctx-btn" onClick={() => { setMenuOpen(false); }}>转发</button>
          <button className="msg-ctx-btn msg-ctx-danger" onClick={deleteMsg}>删除</button>
        </div>
      )}
    </div>
  );
};
