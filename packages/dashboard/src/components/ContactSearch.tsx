// ContactSearch.tsx — Search and add new contacts by @handle

import React, { useState } from 'react';

interface SearchResult {
  id: string;
  name: string;
  handle: string;
  bio?: string;
  skills?: string[];
  isOnline: boolean;
}

// Mock directory — replace with real API call when backend supports it
const MOCK_DIRECTORY: SearchResult[] = [
  { id: 'u1', name: '李明',       handle: 'liming',    bio: '全栈工程师，10年经验',      skills: ['Node.js', 'React', 'Go'],     isOnline: true  },
  { id: 'u2', name: 'Sarah Chen', handle: 'sarahchen', bio: 'AI/ML 研究员',              skills: ['Python', 'TensorFlow'],       isOnline: false },
  { id: 'u3', name: '王磊',       handle: 'wanglei',   bio: '产品经理，前腾讯',          skills: ['产品设计', 'Figma'],          isOnline: true  },
  { id: 'u4', name: 'Alex Wang',  handle: 'alexw',     bio: '区块链开发者',              skills: ['Rust', 'Solidity'],           isOnline: false },
  { id: 'u5', name: '张伟',       handle: 'zhangwei',  bio: '移动端开发，React Native',  skills: ['React Native', 'Swift'],      isOnline: true  },
  { id: 'u6', name: 'Mei Liu',    handle: 'meiliu',    bio: 'UX 设计师',                skills: ['Figma', 'Sketch', 'CSS'],     isOnline: false },
];

interface Props {
  onClose: () => void;
  onRequestSent: (handle: string) => void;
}

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

export const ContactSearch: React.FC<Props> = ({ onClose, onRequestSent }) => {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [sent, setSent]         = useState<Set<string>>(new Set());
  const [sending, setSending]   = useState<string | null>(null);

  function search() {
    const q = query.trim().replace(/^@/, '').toLowerCase();
    if (!q) return;
    const found = MOCK_DIRECTORY.filter(u =>
      u.handle.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)
    );
    setResults(found);
    setSearched(true);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') search();
  }

  async function sendRequest(user: SearchResult) {
    setSending(user.id);
    // Simulate network latency
    await new Promise<void>(resolve => setTimeout(resolve, 600));
    setSent(prev => new Set(prev).add(user.id));
    setSending(null);
    onRequestSent(user.handle);
  }

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
          padding: 24, width: 440, maxWidth: '90vw', maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#e6edf3', fontSize: 15, fontWeight: 600 }}>添加联系人</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 2 }}
          >
            ×
          </button>
        </div>

        {/* ── Search bar ── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入 @handle 或名字搜索…"
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 8,
              background: '#0d1117', border: '1px solid #30363d',
              color: '#e6edf3', fontSize: 13, outline: 'none',
            }}
          />
          <button
            onClick={search}
            style={{
              padding: '8px 16px', borderRadius: 8,
              background: '#f97316', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13,
            }}
          >
            搜索
          </button>
        </div>

        {/* ── Results ── */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {!searched && (
            <div style={{ textAlign: 'center', color: '#8b949e', padding: '24px 0', fontSize: 13 }}>
              输入用户名或 @handle 开始搜索
            </div>
          )}

          {searched && results.length === 0 && (
            <div style={{ textAlign: 'center', color: '#8b949e', padding: '24px 0', fontSize: 13 }}>
              未找到用户 "@{query.replace(/^@/, '')}"
            </div>
          )}

          {results.map(user => (
            <div
              key={user.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 0', borderBottom: '1px solid #21262d',
              }}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: '#30363d', color: '#e6edf3', fontSize: 14, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {initials(user.name)}
                </div>
                {user.isOnline && (
                  <div style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 10, height: 10, borderRadius: '50%',
                    background: '#3fb950', border: '2px solid #161b22',
                  }} />
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: '#e6edf3', fontSize: 14 }}>{user.name}</div>
                <div style={{ color: '#8b949e', fontSize: 12 }}>@{user.handle}</div>
                {user.bio != null && user.bio !== '' && (
                  <div style={{
                    color: '#6e7681', fontSize: 12, marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {user.bio}
                  </div>
                )}
              </div>

              {sent.has(user.id) ? (
                <span style={{ color: '#3fb950', fontSize: 13, flexShrink: 0 }}>✓ 已发送</span>
              ) : (
                <button
                  disabled={sending === user.id}
                  onClick={() => { void sendRequest(user); }}
                  style={{
                    padding: '6px 14px', borderRadius: 8, flexShrink: 0,
                    background: 'none', color: '#f97316', border: '1px solid #f97316',
                    fontSize: 13, opacity: sending === user.id ? 0.5 : 1,
                    cursor: sending === user.id ? 'default' : 'pointer',
                  }}
                >
                  {sending === user.id ? '发送中…' : '添加'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
