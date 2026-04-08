// RiskRules — 风控规则管理
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const S = {
  wrap: { padding: 24 } as React.CSSProperties,
  title: { fontSize: 18, marginBottom: 16, color: '#f97316' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '8px 10px', borderBottom: '1px solid #30363d', color: '#8b949e', fontWeight: 600, fontSize: 12 },
  td: { padding: '8px 10px', borderBottom: '1px solid #21262d', color: '#e6edf3' },
  btn: { background: '#f97316', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 },
  btnDanger: { background: '#da3633', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  input: { background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', color: '#e6edf3', fontSize: 13 },
  row: { display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' as const },
  levelBadge: (level: string) => ({
    borderRadius: 10, padding: '2px 8px', fontSize: 11, color: '#fff',
    background: level === 'critical' ? '#da3633' : level === 'high' ? '#d29922' : level === 'medium' ? '#1f6feb' : '#238636',
  }),
};

export const RiskRules: React.FC<{ token: string }> = ({ token }) => {
  const [rules, setRules] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', description: '', level: 'medium', action: 'flag', conditionExpr: '' });

  const load = () => {
    api.risk.rules(token)
      .then(r => setRules(Array.isArray(r) ? r : (r as any).rules ?? []))
      .catch(e => setErr(e.message));
  };

  useEffect(load, [token]);

  const create = async () => {
    if (!form.id || !form.name) return;
    try {
      await api.risk.createRule(token, form);
      setForm({ id: '', name: '', description: '', level: 'medium', action: 'flag', conditionExpr: '' });
      setShowForm(false);
      load();
    } catch (e: any) { setErr(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm('确认删除该规则？')) return;
    try { await api.risk.deleteRule(token, id); load(); } catch (e: any) { setErr(e.message); }
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={S.wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ ...S.title, margin: 0 }}>◎ 风控规则</h2>
        <button style={S.btn} onClick={() => setShowForm(v => !v)}>{showForm ? '取消' : '+ 新建规则'}</button>
      </div>
      {err && <div style={{ color: '#f85149', marginBottom: 12 }}>{err}</div>}
      {showForm && (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={S.row}>
            <input style={S.input} placeholder="规则 ID" value={form.id} onChange={e => set('id', e.target.value)} />
            <input style={S.input} placeholder="名称" value={form.name} onChange={e => set('name', e.target.value)} />
            <select style={S.input} value={form.level} onChange={e => set('level', e.target.value)}>
              <option value="low">低</option><option value="medium">中</option>
              <option value="high">高</option><option value="critical">严重</option>
            </select>
            <select style={S.input} value={form.action} onChange={e => set('action', e.target.value)}>
              <option value="flag">标记</option><option value="block">阻断</option>
              <option value="require_approval">需审批</option><option value="notify">通知</option>
            </select>
          </div>
          <div style={S.row}>
            <input style={{ ...S.input, flex: 1 }} placeholder="条件表达式" value={form.conditionExpr} onChange={e => set('conditionExpr', e.target.value)} />
            <button style={S.btn} onClick={create}>创建</button>
          </div>
        </div>
      )}
      <table style={S.table}>
        <thead><tr>
          <th style={S.th}>ID</th><th style={S.th}>名称</th><th style={S.th}>级别</th>
          <th style={S.th}>动作</th><th style={S.th}>条件</th><th style={S.th}>操作</th>
        </tr></thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id}>
              <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12 }}>{r.id}</td>
              <td style={S.td}>{r.name}</td>
              <td style={S.td}><span style={S.levelBadge(r.level)}>{r.level}</span></td>
              <td style={S.td}>{r.action}</td>
              <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.conditionExpr}</td>
              <td style={S.td}><button style={S.btnDanger} onClick={() => remove(r.id)}>删除</button></td>
            </tr>
          ))}
          {!rules.length && <tr><td colSpan={6} style={{ ...S.td, color: '#8b949e', textAlign: 'center' }}>暂无风控规则</td></tr>}
        </tbody>
      </table>
    </div>
  );
};
