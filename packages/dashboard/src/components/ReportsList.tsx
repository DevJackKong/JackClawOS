// ReportsList — daily summary reports grouped by role, with date picker

import React, { useEffect, useState } from 'react';
import { api, type SummaryResponse } from '../api.js';

interface Props {
  token: string;
}

function fmtDate(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const ReportsList: React.FC<Props> = ({ token }) => {
  const [date, setDate] = useState(today);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        const res = await api.summary(token, date);
        if (!cancelled) { setSummary(res); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    // Auto-refresh only when viewing today's report
    if (date === today()) {
      const interval = setInterval(load, 60_000);
      return () => { cancelled = true; clearInterval(interval); };
    }
    return () => { cancelled = true; };
  }, [token, date]);

  const roles = Object.keys(summary?.byRole ?? {});

  return (
    <div className="reports-list">
      {/* ── Header with date picker ── */}
      <div className="reports-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="reports-date">{summary?.date ?? date}</span>
          {summary && (
            <span className="reports-count">
              {summary.reportingNodes}/{summary.totalNodes} 节点汇报
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="date"
            value={date}
            max={today()}
            onChange={e => setDate(e.target.value)}
            style={{
              background: '#21262d', border: '1px solid #30363d', borderRadius: 6,
              color: '#e6edf3', padding: '4px 8px', fontSize: 12,
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          />
          <button
            onClick={() => setDate(today())}
            disabled={date === today()}
            style={{
              background: 'none', border: '1px solid #30363d', borderRadius: 6,
              color: date === today() ? '#8b949e' : '#f97316',
              padding: '4px 10px', fontSize: 12, cursor: date === today() ? 'default' : 'pointer',
            }}
          >
            今天
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="empty-state">加载中…</div>
      ) : error ? (
        <div className="error-state">⚠ {error}</div>
      ) : !summary || roles.length === 0 ? (
        <div className="empty-state">当日暂无汇报</div>
      ) : (
        <div className="reports-grid">
          {roles.map(role => (
            <div key={role} className="report-group">
              <div className="report-group-header">{role}</div>
              {summary.byRole[role]?.nodes?.map((n, i) => (
                <div key={i} className="report-node">
                  <div className="report-node-name">{n.name}</div>
                  <div className="report-node-summary">{n.summary}</div>
                  <div className="report-node-time">{fmtDate(n.reportedAt)}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
