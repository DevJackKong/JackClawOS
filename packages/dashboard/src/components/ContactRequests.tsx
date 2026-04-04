// ContactRequests.tsx — Incoming contact requests list

import React from 'react';
import type { Contact } from './ContactCard.js';

export interface ContactRequest {
  id: string;
  from: Contact;
  message?: string;
  sentAt: number;
  direction: 'incoming' | 'outgoing';
}

interface Props {
  requests: ContactRequest[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

export const ContactRequests: React.FC<Props> = ({ requests, onAccept, onReject }) => {
  if (requests.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: '#8b949e', padding: '32px 16px', fontSize: 13 }}>
        暂无待处理请求
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
      {requests.map(req => (
        <div
          key={req.id}
          style={{
            background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
            padding: '12px', display: 'flex', alignItems: 'flex-start', gap: 10,
          }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {initials(req.from.name)}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: '#e6edf3', fontSize: 13 }}>{req.from.name}</div>
            <div style={{ color: '#8b949e', fontSize: 12 }}>@{req.from.handle}</div>
            {req.message != null && req.message !== '' && (
              <div style={{
                color: '#6e7681', fontSize: 12, marginTop: 4,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                "{req.message}"
              </div>
            )}
            <div style={{ fontSize: 11, color: '#6e7681', marginTop: 4 }}>
              {new Date(req.sentAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => onAccept(req.id)}
              style={{
                padding: '5px 10px', borderRadius: 6,
                background: '#238636', color: '#fff', border: 'none', fontSize: 12, fontWeight: 600,
              }}
            >
              接受
            </button>
            <button
              onClick={() => onReject(req.id)}
              style={{
                padding: '5px 10px', borderRadius: 6, background: 'none',
                color: '#f85149', border: '1px solid #f8514933', fontSize: 12,
              }}
            >
              拒绝
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
