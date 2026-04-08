// TenantManager — 租户管理页面
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const S = {
  wrap: { padding: 24 } as React.CSSProperties,
  title: { fontSize: 18, marginBottom: 16, color: '#f97316' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 14 },
  th: { textAlign: 'left' as const, padding: '10px 12px', borderBottom: '1px solid #30363d', color: '#8b949e', fontWeight: 600 },
  td: { padding: '10px 12px', borderBottom: '1px solid #21262d', color: '#e6edf3' },
  btn: { background: '#f97316', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 },
  btnDanger: { background: '#da3633', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 },
  input: { background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', color: '#e6edf3', fontSize: 13, marginRight: 8 },
  row: { display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' as const },
  badge: (color: string) => ({ background: color, color: '#fff', borderRadius: 10, padding: '2px 10px', fontSize: 12 }),
};

export const TenantManager: React.FC<{ token: string }> = ({ token }) => {
  const [tenants, setTenants] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const load = () => {
    api.tenant.list(token)
      .then(r => setTenants(Array.isArray(r) ? r : (r as any).tenants ?? []))
      .catch(e => setErr(e.message));
  };

  useEffect(load, [token]);

  const create = async () => {
    if (!name.trim() || !slug.trim()) return;
    try {
      await api.tenant.create(token, { name: name.trim(), slug: slug.trim() });
      setName(''); setSlug('');
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm('确认删除该租户？')) return;
    try { await api.tenant.delete(token, id); load(); } catch (e: any) { setErr(e.message); }
  };

  return (
    <div style={S.wrap}>
      <h2 style={S.title}>◈ 租户管理</h2>
      {err && <div style={{ color: '#f85149', marginBottom: 12 }}>{err}</div>}
      <div style={S.row}>
        <input style={S.input} placeholder="租户名称" value={name} onChange={e => setName(e.target.value)} />
        <input style={S.input} placeholder="slug" value={slug} onChange={e => setSlug(e.target.value)} />
        <button style={S.btn} onClick={create}>创建租户</button>
      </div>
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>ID</th><th style={S.th}>名称</th><th style={S.th}>Slug</th>
          <th style={S.th}>计划</th><th style={S.th}>状态</th><th style={S.th}>操作</th>
        </tr></thead>
        <tbody>
          {tenants.map(t => (
            <tr key={t.id}>
              <td style={S.td}><code style={{ fontSize: 12 }}>{t.id?.slice(0, 8)}</code></td>
              <td style={S.td}>{t.name}</td>
              <td style={S.td}>{t.slug}</td>
              <td style={S.td}><span style={S.badge('#238636')}>{t.plan ?? 'free'}</span></td>
              <td style={S.td}><span style={S.badge(t.status === 'active' ? '#1f6feb' : '#da3633')}>{t.status ?? 'active'}</span></td>
              <td style={S.td}><button style={S.btnDanger} onClick={() => remove(t.id)}>删除</button></td>
            </tr>
          ))}
          {!tenants.length && <tr><td colSpan={6} style={{ ...S.td, color: '#8b949e', textAlign: 'center' }}>暂无租户</td></tr>}
        </tbody>
      </table>
    </div>
  );
};
