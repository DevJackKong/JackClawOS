// AdminOverview — 管理后台概览 Dashboard
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

interface OverviewData {
  totalNodes: number;
  onlineNodes: number;
  totalMessages: number;
  totalTasks: number;
  pendingApprovals: number;
  totalContacts: number;
}

const card = (label: string, value: number | string, color: string) => (
  <div style={{
    background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
    padding: '20px 24px', minWidth: 140, flex: 1,
  }}>
    <div style={{ fontSize: 13, color: '#8b949e', marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
  </div>
);

export const AdminOverview: React.FC<{ token: string }> = ({ token }) => {
  const [data, setData] = useState<OverviewData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.dashboard.overview(token).then(setData).catch(e => setErr(e.message));
  }, [token]);

  if (err) return <div style={{ color: '#f85149', padding: 24 }}>加载失败: {err}</div>;
  if (!data) return <div style={{ color: '#8b949e', padding: 24 }}>加载中…</div>;

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 18, marginBottom: 20, color: '#f97316' }}>⬡ 系统概览</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {card('节点总数', data.totalNodes, '#58a6ff')}
        {card('在线节点', data.onlineNodes, '#3fb950')}
        {card('消息总数', data.totalMessages, '#d2a8ff')}
        {card('任务总数', data.totalTasks, '#f97316')}
        {card('待审批', data.pendingApprovals, '#f85149')}
        {card('联系人', data.totalContacts, '#79c0ff')}
      </div>
    </div>
  );
};
