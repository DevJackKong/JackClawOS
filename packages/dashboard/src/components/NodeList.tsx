// NodeList — node status cards with online pulse, role badge, last-active time

import React, { useEffect, useState } from 'react';
import { api, type NodeInfo } from '../api.js';

interface Props {
  token: string;
}

function timeAgo(ts?: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

type NodeStatus = 'online' | 'recent' | 'offline';

function nodeStatus(lastReportAt?: number): NodeStatus {
  if (!lastReportAt) return 'offline';
  const diff = Date.now() - lastReportAt;
  if (diff < 60 * 60 * 1000) return 'online';       // < 1h → green
  if (diff < 24 * 60 * 60 * 1000) return 'recent';  // < 24h → yellow
  return 'offline';                                  // > 24h → gray
}

function fmtDate(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

const ROLE_COLORS: Record<string, string> = {
  frontend: '#38bdf8',
  backend: '#a78bfa',
  devops: '#fb923c',
  design: '#f472b6',
  pm: '#34d399',
  qa: '#fbbf24',
};

function roleColor(role: string): string {
  return ROLE_COLORS[role.toLowerCase()] ?? '#6b7280';
}

export const NodeList: React.FC<Props> = ({ token }) => {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await api.nodes(token);
        if (!cancelled) setNodes(res.nodes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token]);

  if (loading) {
    return (
      <div className="nodes-loading">
        {[1, 2, 3].map(i => (
          <div key={i} className="node-card skeleton" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="error-state">⚠ {error}</div>;
  }

  if (nodes.length === 0) {
    return <div className="empty-state">暂无已注册节点</div>;
  }

  const online = nodes.filter(n => nodeStatus(n.lastReportAt) === 'online').length;

  return (
    <div className="node-list">
      <div className="node-list-header">
        <span className="node-count">{nodes.length} 节点</span>
        <span className="online-count">
          <span className="pulse-dot" />
          {online} 在线
        </span>
      </div>
      <div className="nodes-grid">
        {nodes.map(node => {
          const status = nodeStatus(node.lastReportAt);
          return (
            <div key={node.nodeId} className={`node-card node-${status}`}>
              <div className="node-card-top">
                <div className="node-status-indicator">
                  <span className={`status-dot dot-${status}`} />
                </div>
                <div className="node-name">{node.name}</div>
                <div
                  className="node-role-badge"
                  style={{ color: roleColor(node.role), borderColor: roleColor(node.role) + '44' }}
                >
                  {node.role}
                </div>
              </div>

              <div className="node-id">{node.nodeId}</div>

              <div className="node-meta-grid">
                <span className="meta-label">注册</span>
                <span className="meta-value">{fmtDate(node.registeredAt)}</span>
                <span className="meta-label">汇报</span>
                <span className="meta-value">{timeAgo(node.lastReportAt)}</span>
              </div>

              {node.capabilities && node.capabilities.length > 0 && (
                <div className="node-caps">
                  {node.capabilities.slice(0, 4).map(cap => (
                    <span key={cap} className="cap-tag">{cap}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
