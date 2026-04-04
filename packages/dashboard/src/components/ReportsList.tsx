// ReportsList — daily summary reports grouped by role

import React, { useEffect, useState } from 'react';
import { api, type SummaryResponse } from '../api.js';

interface Props {
  token: string;
}

function fmtDate(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export const ReportsList: React.FC<Props> = ({ token }) => {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await api.summary(token);
        if (!cancelled) { setSummary(res); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [token]);

  if (loading) return <div className="empty-state">加载中…</div>;
  if (error) return <div className="error-state">⚠ {error}</div>;
  if (!summary) return <div className="empty-state">暂无汇报</div>;

  const roles = Object.keys(summary.byRole ?? {});

  return (
    <div className="reports-list">
      <div className="reports-header">
        <span className="reports-date">{summary.date}</span>
        <span className="reports-count">
          {summary.reportingNodes}/{summary.totalNodes} 节点汇报
        </span>
      </div>

      {roles.length === 0 ? (
        <div className="empty-state">今日暂无汇报</div>
      ) : (
        <div className="reports-grid">
          {roles.map(role => (
            <div key={role} className="report-group">
              <div className="report-group-header">{role}</div>
              {summary.byRole[role].nodes.map((n, i) => (
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
