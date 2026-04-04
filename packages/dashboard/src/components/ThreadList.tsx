// ThreadList — 会话列表：排序、未读 badge、搜索、新建按钮

import React, { useMemo, useState } from 'react';
import type { ChatThread } from '../api.js';
import type { WsMessage } from '../useWebSocket.js';

interface Props {
  threads: ChatThread[];
  activeThreadId: string | null;
  wsMessages: WsMessage[];
  wsStatus: 'connected' | 'connecting' | 'disconnected';
  onSelectThread: (id: string | null) => void;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export const ThreadList: React.FC<Props> = ({
  threads,
  activeThreadId,
  wsMessages,
  wsStatus,
  onSelectThread,
}) => {
  const [search, setSearch] = useState('');

  // Sort by updatedAt desc, then filter
  const sorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...threads]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter(t =>
        !q ||
        (t.title ?? '').toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
      );
  }, [threads, search]);

  return (
    <aside className="thread-list-panel">
      {/* Header */}
      <div className="tl-header">
        <span className="tl-title">消息</span>
        <div className={`ws-badge ws-badge-${wsStatus}`}>
          <span className="ws-badge-dot" />
          {wsStatus === 'connected' ? 'WS' : wsStatus === 'connecting' ? '…' : '离线'}
        </div>
      </div>

      {/* Search */}
      <div className="tl-search-wrap">
        <input
          className="tl-search"
          placeholder="搜索会话…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* New conversation button */}
      <button className="tl-new-btn" onClick={() => onSelectThread(null)}>
        <span>＋</span>
        <span>新建会话</span>
      </button>

      {/* Realtime stream entry */}
      <button
        className={`tl-item ${activeThreadId === null ? 'tl-item-active' : ''}`}
        onClick={() => onSelectThread(null)}
      >
        <div className="tl-item-avatar tl-avatar-ws">WS</div>
        <div className="tl-item-body">
          <div className="tl-item-top">
            <span className="tl-item-name">实时对话</span>
            <span className="tl-item-time">直播</span>
          </div>
          <div className="tl-item-preview">
            {wsMessages.length > 0
              ? wsMessages[wsMessages.length - 1]?.content.slice(0, 32) + '…'
              : '暂无消息'}
          </div>
        </div>
        {wsMessages.length > 0 && activeThreadId !== null && (
          <div className="tl-badge">{wsMessages.length > 99 ? '99+' : wsMessages.length}</div>
        )}
      </button>

      {/* Thread list */}
      <div className="tl-scroll">
        {sorted.length === 0 && (
          <div className="tl-empty">暂无会话</div>
        )}
        {sorted.map(thread => (
          <button
            key={thread.id}
            className={`tl-item ${activeThreadId === thread.id ? 'tl-item-active' : ''}`}
            onClick={() => onSelectThread(thread.id)}
          >
            <div className="tl-item-avatar">
              {(thread.title ?? '?')[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="tl-item-body">
              <div className="tl-item-top">
                <span className="tl-item-name">
                  {thread.title ?? `会话 #${thread.id.slice(-6)}`}
                </span>
                <span className="tl-item-time">{fmtTime(thread.updatedAt)}</span>
              </div>
              <div className="tl-item-preview">{thread.messageCount} 条消息</div>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
};
