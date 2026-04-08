// ApprovalList — 审批流管理
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const S = {
  wrap: { padding: 24 } as React.CSSProperties,
  title: { fontSize: 18, marginBottom: 16, color: '#f97316' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '8px 10px', borderBottom: '1px solid #30363d', color: '#8b949e', fontWeight: 600, fontSize: 12 },
  td: { padding: '8px 10px', borderBottom: '1px solid #21262d', color: '#e6edf3' },
  btn: (bg: string) => ({ background: bg, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, marginRight: 6 }),
  stateBadge: (state: string) => ({
    borderRadius: 10, padding: '2px 8px', fontSize: 11, color: '#fff',
    background: state === 'approved' ? '#238636' : state === 'rejected' ? '#da3633' : '#d29922',
  }),
};

export const ApprovalList: React.FC<{ token: string }> = ({ token }) => {
  const [items, setItems] = useState<any[]>([]);
  const [err, setErr] = useState('');

  const load = () => {
    api.approval.list(token)
      .then(r => setItems(Array.isArray(r) ? r : (r as any).approvals ?? []))
      .catch(e => setErr(e.message));
  };

  useEffect(load, [token]);

  const approve = async (id: string) => {
    try { await api.approval.approve(token, id); load(); } catch (e: any) { setErr(e.message); }
  };

  const reject = async (id: string) => {
    const reason = prompt('拒绝原因（可选）');
    try { await api.approval.reject(token, id, reason ?? undefined); load(); } catch (e: any) { setErr(e.message); }
  };

  const fmtTime = (ts: number) => ts ? new Date(ts).toLocaleString('zh-CN') : '-';

  return (
    <div style={S.wrap}>
      <h2 style={S.title}>◐ 审批流</h2>
      {err && <div style={{ color: '#f85149', marginBottom: 12 }}>{err}</div>}
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>ID</th><th style={S.th}>类型</th><th style={S.th}>发起人</th>
          <th style={S.th}>状态</th><th style={S.th}>时间</th><th style={S.th}>操作</th>
        </tr></thead>
        <tbody>
          {items.map(a => (
            <tr key={a.id}>
              <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{a.id?.slice(0, 8)}</td>
              <td style={S.td}>{a.type ?? a.action ?? '-'}</td>
              <td style={S.td}>{a.requesterId ?? a.userId ?? '-'}</td>
              <td style={S.td}><span style={S.stateBadge(a.state ?? a.status)}>{a.state ?? a.status}</span></td>
              <td style={{ ...S.td, fontSize: 12, whiteSpace: 'nowrap' }}>{fmtTime(a.createdAt ?? a.ts)}</td>
              <td style={S.td}>
                {(a.state === 'pending' || a.status === 'pending') && (
                  <>
                    <button style={S.btn('#238636')} onClick={() => approve(a.id)}>通过</button>
                    <button style={S.btn('#da3633')} onClick={() => reject(a.id)}>拒绝</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={6} style={{ ...S.td, color: '#8b949e', textAlign: 'center' }}>暂无审批项</td></tr>}
        </tbody>
      </table>
    </div>
  );
};
