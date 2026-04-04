// ContactCard.tsx — Contact profile card modal

import React from 'react';

export interface Contact {
  id: string;
  name: string;
  handle: string;
  bio?: string;
  skills?: string[];
  trustLevel: 'trusted' | 'verified' | 'unknown';
  isOnline: boolean;
  lastSeen?: number;
  nodeId?: string;
}

interface Props {
  contact: Contact;
  onClose: () => void;
  onMessage: () => void;
  onDelete: () => void;
  onBlock: () => void;
}

const TRUST: Record<Contact['trustLevel'], { bg: string; color: string; label: string }> = {
  trusted:  { bg: '#0f2d16', color: '#3fb950', label: '受信任' },
  verified: { bg: '#0c1d33', color: '#58a6ff', label: '已验证' },
  unknown:  { bg: '#1c1c24', color: '#8b949e', label: '未知'   },
};

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

export const ContactCard: React.FC<Props> = ({ contact, onClose, onMessage, onDelete, onBlock }) => {
  const trust = TRUST[contact.trustLevel];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
          padding: 24, width: 360, maxWidth: '90vw',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
            background: '#f97316', color: '#fff', fontSize: 20, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {initials(contact.name)}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 16, color: '#e6edf3' }}>{contact.name}</span>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 100,
                background: trust.bg, color: trust.color, border: `1px solid ${trust.color}44`,
              }}>
                {trust.label}
              </span>
            </div>
            <div style={{ color: '#8b949e', fontSize: 13, marginTop: 2 }}>@{contact.handle}</div>
            {contact.isOnline ? (
              <div style={{ fontSize: 12, color: '#3fb950', marginTop: 4 }}>● 在线</div>
            ) : contact.lastSeen != null ? (
              <div style={{ fontSize: 12, color: '#8b949e', marginTop: 4 }}>
                最后在线 {new Date(contact.lastSeen).toLocaleString('zh-CN', {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </div>
            ) : null}
          </div>

          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 2 }}
          >
            ×
          </button>
        </div>

        {/* ── Bio ── */}
        {contact.bio != null && contact.bio !== '' && (
          <p style={{ color: '#8b949e', fontSize: 13, margin: '0 0 16px', lineHeight: 1.6 }}>
            {contact.bio}
          </p>
        )}

        {/* ── Skills ── */}
        {contact.skills != null && contact.skills.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              技能
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {contact.skills.map(s => (
                <span key={s} style={{
                  fontSize: 12, padding: '3px 10px', borderRadius: 100,
                  background: '#21262d', border: '1px solid #30363d', color: '#e6edf3',
                }}>
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div style={{ display: 'flex', gap: 8, paddingTop: 16, borderTop: '1px solid #30363d' }}>
          <button
            onClick={onMessage}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8,
              background: '#f97316', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13,
            }}
          >
            发消息
          </button>
          <button
            onClick={onDelete}
            style={{
              padding: '8px 12px', borderRadius: 8, background: 'none',
              color: '#f85149', border: '1px solid #f8514933', fontSize: 13,
            }}
          >
            删除
          </button>
          <button
            onClick={onBlock}
            style={{
              padding: '8px 12px', borderRadius: 8, background: 'none',
              color: '#8b949e', border: '1px solid #30363d', fontSize: 13,
            }}
          >
            屏蔽
          </button>
        </div>
      </div>
    </div>
  );
};
