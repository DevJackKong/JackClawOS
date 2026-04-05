// NodeList — node status cards with online pulse, role badge, last-active time
// Click a card to expand the detail drawer.

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

const STATUS_LABEL: Record<NodeStatus, string> = {
  online: '在线',
  recent: '近期',
  offline: '离线',
};

// ── Detail drawer ────────────────────────────────────────────────────────────

interface DetailProps {
  node: NodeInfo;
  onClose: () => void;
}

const NodeDetail: React.FC<DetailProps> = ({ node, onClose }) => {
  const status = nodeStatus(node.lastReportAt);
  const color = roleColor(node.role);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
        width: 440, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid #30363d',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span className={`status-dot dot-${status}`} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, fontWeight: 700, fontSize: 15 }}>{node.name}</span>
          <span style={{
            fontSize: 11, padding: '2px 8px', border: `1px solid ${color}44`,
            borderRadius: 20, color,
          }}>{node.role}</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Status row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              fontSize: 12, padding: '3px 10px', borderRadius: 20,
              background: status === 'online' ? 'rgba(34,197,94,.1)' : status === 'recent' ? 'rgba(234,179,8,.1)' : 'rgba(107,114,128,.1)',
              color: status === 'online' ? '#22c55e' : status === 'recent' ? '#eab308' : '#6b7280',
              border: `1px solid ${status === 'online' ? '#22c55e44' : status === 'recent' ? '#eab30844' : '#6b728044'}`,
            }}>
              {STATUS_LABEL[status]}
            </span>
          </div>

          {/* Info table */}
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <tbody>
              {([
                ['节点 ID', node.nodeId],
                ['注册时间', fmtDate(node.registeredAt)],
                ['最后汇报', fmtDate(node.lastReportAt)],
                ['汇报时间', timeAgo(node.lastReportAt)],
              ] as [string, string][]).map(([label, val]) => (
                <tr key={label}>
                  <td style={{ padding: '5px 0', color: '#8b949e', width: 90, verticalAlign: 'top' }}>{label}</td>
                  <td style={{ padding: '5px 0', color: '#e6edf3', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 12 }}>{val}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Capabilities */}
          {node.capabilities && node.capabilities.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>能力</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {node.capabilities.map(cap => (
                  <span key={cap} className="cap-tag">{cap}</span>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          {node.metadata && Object.keys(node.metadata).length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>元数据</div>
              <pre style={{
                background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
                padding: '10px 12px', fontSize: 11, color: '#c4c9d4',
                overflowX: 'auto', lineHeight: 1.6,
              }}>
                {JSON.stringify(node.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── NodeList ─────────────────────────────────────────────────────────────────

export const NodeList: React.FC<Props> = ({ token }) => {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NodeInfo | null>(null);

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
            <button
              key={node.nodeId}
              className={`node-card node-${status}`}
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
              onClick={() => setSelected(node)}
              title="点击查看详情"
            >
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
            </button>
          );
        })}
      </div>

      {selected && <NodeDetail node={selected} onClose={() => setSelected(null)} />}
    </div>
  );
};
