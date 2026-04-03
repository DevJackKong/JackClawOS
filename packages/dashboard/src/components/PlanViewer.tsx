// PlanViewer — 任务规划展示：输入任务标题/描述，调用 /api/plan/estimate，展示结构化结果

import React, { useState } from 'react';
import { api, type ExecutionPlan } from '../api.js';

interface Props {
  token: string;
}

const COMPLEXITY_COLOR: Record<string, string> = {
  trivial:  '#6b7280',
  simple:   '#22c55e',
  moderate: '#eab308',
  complex:  '#f97316',
  epic:     '#ef4444',
};

const COMPLEXITY_LABEL: Record<string, string> = {
  trivial:  '极简',
  simple:   '简单',
  moderate: '中等',
  complex:  '复杂',
  epic:     '史诗',
};

function fmtMins(m: number): string {
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h} 小时`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const MetricCard: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div style={{
    background: '#0d1117',
    borderRadius: 8,
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  }}>
    <div style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    <div style={{ color: '#e2e4e9', fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    {sub && <div style={{ color: '#6b7280', fontSize: 12 }}>{sub}</div>}
  </div>
);

const PlanResult: React.FC<{ plan: ExecutionPlan; note?: string }> = ({ plan, note }) => {
  const complexColor = COMPLEXITY_COLOR[plan.complexity] ?? '#6366f1';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Title row + complexity badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, color: '#e2e4e9', fontSize: 16 }}>{plan.title}</h3>
        <span style={{
          background: complexColor + '22',
          color: complexColor,
          border: `1px solid ${complexColor}55`,
          borderRadius: 20,
          padding: '2px 10px',
          fontSize: 12,
          fontWeight: 600,
        }}>
          {COMPLEXITY_LABEL[plan.complexity] ?? plan.complexity}
        </span>
        {plan.needsParallel && (
          <span style={{
            background: '#6366f122',
            color: '#6366f1',
            border: '1px solid #6366f155',
            borderRadius: 20,
            padding: '2px 10px',
            fontSize: 12,
          }}>
            ⚡ 并行
          </span>
        )}
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        <MetricCard
          label="串行耗时"
          value={fmtMins(plan.estimatedMinutesSerial)}
        />
        <MetricCard
          label="并行耗时"
          value={fmtMins(plan.estimatedMinutesParallel)}
          sub={`加速 ×${plan.parallelSpeedup.toFixed(1)}`}
        />
        <MetricCard
          label="预估 Token"
          value={fmtTokens(plan.estimatedTotalTokens)}
        />
        <MetricCard
          label="预估费用"
          value={`$${plan.estimatedCostUsd.toFixed(2)}`}
          sub={`建议 ${plan.suggestedAgentCount} 个 Agent`}
        />
      </div>

      {/* Subtasks */}
      {plan.subtasks.length > 0 && (
        <div>
          <div style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            子任务（{plan.subtasks.length}）
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {plan.subtasks.map((t, i) => (
              <div key={t.id ?? i} style={{
                background: '#0d1117',
                borderRadius: 6,
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}>
                <span style={{ color: '#c4c9d4', fontSize: 13 }}>{t.title}</span>
                <span style={{ color: '#6b7280', fontSize: 12, flexShrink: 0 }}>{fmtMins(t.estimatedMinutes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks */}
      {plan.risks.length > 0 && (
        <div style={{ background: '#2d1012', border: '1px solid #7f1d1d', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ color: '#fca5a5', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>风险提示</div>
          {plan.risks.map((r, i) => (
            <div key={i} style={{ color: '#fca5a5', fontSize: 13, marginTop: 2 }}>• {r}</div>
          ))}
        </div>
      )}

      {/* Note from planner */}
      {note && (
        <div style={{ color: '#6b7280', fontSize: 12, fontStyle: 'italic' }}>{note}</div>
      )}
    </div>
  );
};

export const PlanViewer: React.FC<Props> = ({ token }) => {
  const [title, setTitle]       = useState('');
  const [desc, setDesc]         = useState('');
  const [plan, setPlan]         = useState<ExecutionPlan | null>(null);
  const [note, setNote]         = useState<string | undefined>(undefined);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const estimate = async () => {
    const t = title.trim();
    const d = desc.trim();
    if (!t || !d) { setError('请填写任务标题和描述'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await api.plan(token, { title: t, description: d });
      setPlan(res.plan);
      setNote(res.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : '规划失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Input form */}
      <div style={{
        background: '#16181c',
        border: '1px solid #2a2d35',
        borderRadius: 10,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
        <h3 style={{ margin: 0, color: '#6366f1', fontSize: 15 }}>◎ 任务规划器</h3>
        <input
          style={{
            background: '#0d1117',
            border: '1px solid #2a2d35',
            borderRadius: 6,
            color: '#e2e4e9',
            padding: '8px 12px',
            fontSize: 14,
            outline: 'none',
            width: '100%',
          }}
          type="text"
          placeholder="任务标题"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void estimate()}
        />
        <textarea
          style={{
            background: '#0d1117',
            border: '1px solid #2a2d35',
            borderRadius: 6,
            color: '#e2e4e9',
            padding: '8px 12px',
            fontSize: 13,
            outline: 'none',
            resize: 'vertical',
            minHeight: 80,
            fontFamily: 'inherit',
            width: '100%',
          }}
          placeholder="任务描述（越详细，估算越准确）"
          value={desc}
          onChange={e => setDesc(e.target.value)}
        />
        <button
          style={{
            background: loading ? '#2a2d35' : '#6366f1',
            color: loading ? '#6b7280' : '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 20px',
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            alignSelf: 'flex-start',
            transition: 'opacity .15s',
          }}
          onClick={() => void estimate()}
          disabled={loading}
        >
          {loading ? '规划中…' : '生成计划'}
        </button>
        {error && (
          <div style={{ color: '#fca5a5', fontSize: 13 }}>⚠ {error}</div>
        )}
      </div>

      {/* Result */}
      {plan && (
        <div style={{
          background: '#16181c',
          border: '1px solid #2a2d35',
          borderRadius: 10,
          padding: 16,
        }}>
          <PlanResult plan={plan} note={note} />
        </div>
      )}
    </div>
  );
};
