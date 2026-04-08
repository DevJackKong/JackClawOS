// AuditLog — 审计日志查看
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const S = {
  wrap: { padding: 24 } as React.CSSProperties,
  title: { fontSize: 18, marginBottom: 16, color: '#f97316' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '8px 10px', borderBottom: '1px solid #30363d', color: '#8b949e', fontWeight: 600, fontSize: 12 },
  td: { padding: '8px 10px', borderBottom: '1px solid #21262d', color: '#e6edf3' },
  badge: (ok: boolean) => ({ background: ok ? '#238636' : '#da3633', color: '#fff', borderRadius: 10, padding: '2px 8px', fontSize: 11 }),
};

export const AuditLog: React.FC<{ token: string }> = ({ token }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.audit.list(token)
      .then(r => setLogs(Array.isArray(r) ? r : (r as any).logs ?? []))
      .catch(e => setErr(e.message));
  }, [token]);

  const fmtTime = (ts: number) => ts ? new Date(ts).toLocaleString('zh-CN') : '-';

  return (
    <div style={S.wrap}>
      <h2 style={S.title}>◉ 审计日志</h2>
      {err && <div style={{ color: '#f85149', marginBottom: 12 }}>{err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>时间</th><th style={S.th}>用户</th><th style={S.th}>方法</th>
            <th style={S.th}>路径</th><th style={S.th}>状态码</th><th style={S.th}>结果</th>
          </tr></thead>
          <tbody>
            {logs.map((l, i) => (
              <tr key={l.id ?? i}>
                <td style={{ ...S.td, whiteSpace: 'nowrap', fontSize: 12 }}>{fmtTime(l.timestamp ?? l.ts)}</td>
                <td style={S.td}>{l.userId ?? l.user ?? '-'}</td>
                <td style={{ ...S.td, fontFamily: 'monospace' }}>{l.method}</td>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{l.path}</td>
                <td style={S.td}>{l.statusCode}</td>
                <td style={S.td}><span style={S.badge(l.result === 'success')}>{l.result}</span></td>
              </tr>
            ))}
            {!logs.length && <tr><td colSpan={6} style={{ ...S.td, color: '#8b949e', textAlign: 'center' }}>暂无审计日志</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
