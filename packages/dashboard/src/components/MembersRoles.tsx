// MembersRoles — 成员 & RBAC 角色管理
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const S = {
  wrap: { padding: 24 } as React.CSSProperties,
  title: { fontSize: 18, marginBottom: 16, color: '#f97316' } as React.CSSProperties,
  section: { marginBottom: 32 } as React.CSSProperties,
  subTitle: { fontSize: 15, marginBottom: 12, color: '#e6edf3' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '8px 10px', borderBottom: '1px solid #30363d', color: '#8b949e', fontWeight: 600, fontSize: 12 },
  td: { padding: '8px 10px', borderBottom: '1px solid #21262d', color: '#e6edf3' },
  btn: { background: '#f97316', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 },
  btnDanger: { background: '#da3633', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  input: { background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', color: '#e6edf3', fontSize: 13 },
  row: { display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' as const },
  badge: { background: '#1f6feb', color: '#fff', borderRadius: 10, padding: '2px 8px', fontSize: 11, marginRight: 4 },
};

export const MembersRoles: React.FC<{ token: string }> = ({ token }) => {
  const [members, setMembers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [err, setErr] = useState('');

  // Member form
  const [mForm, setMForm] = useState({ tenantId: '', orgId: '', userId: '', role: 'member' });
  // Role form
  const [rForm, setRForm] = useState({ name: '', permissions: '' });

  const loadMembers = () => {
    api.members.list(token)
      .then(r => setMembers(Array.isArray(r) ? r : (r as any).members ?? []))
      .catch(e => setErr(e.message));
  };

  const loadRoles = () => {
    api.roles.list(token)
      .then(r => setRoles(Array.isArray(r) ? r : (r as any).roles ?? []))
      .catch(e => setErr(e.message));
  };

  useEffect(() => { loadMembers(); loadRoles(); }, [token]);

  const addMember = async () => {
    if (!mForm.userId) return;
    try {
      await api.members.add(token, mForm);
      setMForm({ tenantId: '', orgId: '', userId: '', role: 'member' });
      loadMembers();
    } catch (e: any) { setErr(e.message); }
  };

  const removeMember = async (id: string) => {
    if (!confirm('移除该成员？')) return;
    try { await api.members.remove(token, id); loadMembers(); } catch (e: any) { setErr(e.message); }
  };

  const createRole = async () => {
    if (!rForm.name) return;
    const perms = rForm.permissions.split(',').map(s => s.trim()).filter(Boolean);
    try {
      await api.roles.create(token, { name: rForm.name, permissions: perms });
      setRForm({ name: '', permissions: '' });
      loadRoles();
    } catch (e: any) { setErr(e.message); }
  };

  const deleteRole = async (id: string) => {
    if (!confirm('删除该角色？')) return;
    try { await api.roles.delete(token, id); loadRoles(); } catch (e: any) { setErr(e.message); }
  };

  return (
    <div style={S.wrap}>
      <h2 style={S.title}>◫ 成员 & 角色</h2>
      {err && <div style={{ color: '#f85149', marginBottom: 12 }}>{err}</div>}

      {/* Members */}
      <div style={S.section}>
        <h3 style={S.subTitle}>成员管理</h3>
        <div style={S.row}>
          <input style={S.input} placeholder="用户 ID" value={mForm.userId} onChange={e => setMForm({ ...mForm, userId: e.target.value })} />
          <input style={S.input} placeholder="租户 ID" value={mForm.tenantId} onChange={e => setMForm({ ...mForm, tenantId: e.target.value })} />
          <input style={S.input} placeholder="组织 ID" value={mForm.orgId} onChange={e => setMForm({ ...mForm, orgId: e.target.value })} />
          <select style={S.input} value={mForm.role} onChange={e => setMForm({ ...mForm, role: e.target.value })}>
            <option value="owner">owner</option><option value="admin">admin</option>
            <option value="member">member</option><option value="viewer">viewer</option>
          </select>
          <button style={S.btn} onClick={addMember}>添加</button>
        </div>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>ID</th><th style={S.th}>用户</th><th style={S.th}>组织</th>
            <th style={S.th}>角色</th><th style={S.th}>操作</th>
          </tr></thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id}>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{m.id?.slice(0, 8)}</td>
                <td style={S.td}>{m.userId}</td>
                <td style={S.td}>{m.orgId?.slice(0, 8) ?? '-'}</td>
                <td style={S.td}><span style={S.badge}>{m.role}</span></td>
                <td style={S.td}><button style={S.btnDanger} onClick={() => removeMember(m.id)}>移除</button></td>
              </tr>
            ))}
            {!members.length && <tr><td colSpan={5} style={{ ...S.td, color: '#8b949e', textAlign: 'center' }}>暂无成员</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Roles */}
      <div style={S.section}>
        <h3 style={S.subTitle}>角色管理 (RBAC)</h3>
        <div style={S.row}>
          <input style={S.input} placeholder="角色名称" value={rForm.name} onChange={e => setRForm({ ...rForm, name: e.target.value })} />
          <input style={{ ...S.input, flex: 1 }} placeholder="权限（逗号分隔）: read,write,admin" value={rForm.permissions} onChange={e => setRForm({ ...rForm, permissions: e.target.value })} />
          <button style={S.btn} onClick={createRole}>创建角色</button>
        </div>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>ID</th><th style={S.th}>名称</th><th style={S.th}>权限</th>
            <th style={S.th}>类型</th><th style={S.th}>操作</th>
          </tr></thead>
          <tbody>
            {roles.map(r => (
              <tr key={r.id}>
                <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.id?.slice(0, 8)}</td>
                <td style={S.td}>{r.name}</td>
                <td style={S.td}>
                  {(r.permissions ?? []).map((p: string) => (
                    <span key={p} style={S.badge}>{p}</span>
                  ))}
                </td>
                <td style={S.td}>{r.builtIn ? '内置' : '自定义'}</td>
                <td style={S.td}>
                  {!r.builtIn && <button style={S.btnDanger} onClick={() => deleteRole(r.id)}>删除</button>}
                </td>
              </tr>
            ))}
            {!roles.length && <tr><td colSpan={5} style={{ ...S.td, color: '#8b949e', textAlign: 'center' }}>暂无角色</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
