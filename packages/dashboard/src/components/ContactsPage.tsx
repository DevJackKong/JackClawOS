// ContactsPage.tsx — Contacts list with groups, search, and navigation

import React, { useEffect, useState } from 'react';
import { ContactCard, type Contact } from './ContactCard.js';
import { ContactRequests, type ContactRequest } from './ContactRequests.js';
import { ContactSearch } from './ContactSearch.js';

const LS_CONTACTS = 'jackclaw_contacts';
const LS_REQUESTS = 'jackclaw_contact_requests';

const SEED_CONTACTS: Contact[] = [
  {
    id: 'c1', name: '李明', handle: 'liming',
    bio: '全栈工程师，专注于分布式系统与高可用架构',
    skills: ['Node.js', 'React', 'Go', 'Kubernetes'],
    trustLevel: 'trusted', isOnline: true, lastSeen: Date.now(),
    nodeId: 'node-liming',
  },
  {
    id: 'c2', name: 'Sarah Chen', handle: 'sarahchen',
    bio: 'AI/ML 研究员，斯坦福博士，专注 LLM 微调',
    skills: ['Python', 'TensorFlow', 'PyTorch', 'CUDA'],
    trustLevel: 'verified', isOnline: false, lastSeen: Date.now() - 2 * 3_600_000,
  },
  {
    id: 'c3', name: '王磊', handle: 'wanglei',
    bio: '产品经理，前腾讯微信事业群',
    skills: ['产品设计', 'Figma', '数据分析', '用户研究'],
    trustLevel: 'verified', isOnline: true, lastSeen: Date.now(),
  },
  {
    id: 'c4', name: 'Alex Wang', handle: 'alexw',
    bio: '区块链开发者，Solana 生态',
    skills: ['Rust', 'Solidity', 'Web3'],
    trustLevel: 'unknown', isOnline: false, lastSeen: Date.now() - 5 * 86_400_000,
  },
];

const SEED_REQUESTS: ContactRequest[] = [
  {
    id: 'r1',
    from: {
      id: 'u10', name: 'Mei Liu', handle: 'meiliu',
      bio: 'UX 设计师，专注交互设计与无障碍',
      skills: ['Figma', 'Sketch', 'CSS'],
      trustLevel: 'unknown', isOnline: true,
    },
    message: '嗨，我是 Mei，在 JackClaw 社区认识你，想保持联系',
    sentAt: Date.now() - 3_600_000,
    direction: 'incoming',
  },
];

type Group = 'recent' | 'all' | 'requests';

interface Props {
  token: string;
  onStartChat?: (nodeId: string) => void;
}

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw != null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const ContactsPage: React.FC<Props> = ({ token: _token, onStartChat }) => {
  const [contacts, setContacts]     = useState<Contact[]>(() => loadFromStorage(LS_CONTACTS, SEED_CONTACTS));
  const [requests, setRequests]     = useState<ContactRequest[]>(() => loadFromStorage(LS_REQUESTS, SEED_REQUESTS));
  const [group, setGroup]           = useState<Group>('all');
  const [query, setQuery]           = useState('');
  const [selected, setSelected]     = useState<Contact | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [toast, setToast]           = useState<string | null>(null);

  // Persist state
  useEffect(() => { localStorage.setItem(LS_CONTACTS, JSON.stringify(contacts)); }, [contacts]);
  useEffect(() => { localStorage.setItem(LS_REQUESTS, JSON.stringify(requests)); }, [requests]);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const incomingRequests = requests.filter(r => r.direction === 'incoming');
  const pendingCount = incomingRequests.length;

  const recentContacts = [...contacts]
    .filter(c => c.lastSeen != null && c.lastSeen > Date.now() - 7 * 86_400_000)
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
    .slice(0, 8);

  const filteredContacts = (() => {
    const base = group === 'recent' ? recentContacts : contacts;
    if (!query) return base;
    const q = query.toLowerCase().replace(/^@/, '');
    return base.filter(c =>
      c.name.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q)
    );
  })();

  function handleAccept(id: string) {
    const req = requests.find(r => r.id === id);
    if (req) {
      setContacts(prev => [...prev, { ...req.from }]);
      setToast(`已添加 ${req.from.name} 为联系人`);
    }
    setRequests(prev => prev.filter(r => r.id !== id));
  }

  function handleReject(id: string) {
    setRequests(prev => prev.filter(r => r.id !== id));
    setToast('已拒绝请求');
  }

  function handleDelete(contact: Contact) {
    setContacts(prev => prev.filter(c => c.id !== contact.id));
    setSelected(null);
    setToast(`已删除 ${contact.name}`);
  }

  function handleBlock(contact: Contact) {
    setContacts(prev => prev.filter(c => c.id !== contact.id));
    setSelected(null);
    setToast(`已屏蔽 @${contact.handle}`);
  }

  function handleMessage(contact: Contact) {
    setSelected(null);
    if (contact.nodeId != null && onStartChat) {
      onStartChat(contact.nodeId);
    } else {
      setToast(`正在打开与 ${contact.name} 的对话…`);
    }
  }

  function handleRequestSent(handle: string) {
    setShowSearch(false);
    setToast(`已向 @${handle} 发送好友请求`);
  }

  const GROUPS: { id: Group; label: string; badge?: number }[] = [
    { id: 'recent',   label: '最近联系',   badge: recentContacts.length || undefined },
    { id: 'all',      label: '所有联系人', badge: contacts.length || undefined },
    { id: 'requests', label: '待处理请求', badge: pendingCount || undefined },
  ];

  return (
    <div style={{
      display: 'flex', height: 'calc(100vh - 96px)',
      background: '#0d1117', overflow: 'hidden',
    }}>
      {/* ── Sidebar ── */}
      <div style={{
        width: 280, flexShrink: 0, background: '#161b22',
        borderRight: '1px solid #30363d', display: 'flex', flexDirection: 'column',
      }}>
        {/* Search */}
        <div style={{ padding: '14px 14px 8px' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索联系人…"
            style={{
              width: '100%', padding: '7px 11px', borderRadius: 8,
              background: '#0d1117', border: '1px solid #30363d',
              color: '#e6edf3', fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Group selector */}
        <div style={{ padding: '0 10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {GROUPS.map(g => (
            <button
              key={g.id}
              onClick={() => setGroup(g.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 10px', borderRadius: 6, width: '100%', textAlign: 'left',
                background: group === g.id ? '#21262d' : 'none',
                border: group === g.id ? '1px solid #30363d' : '1px solid transparent',
                color: group === g.id ? '#e6edf3' : '#8b949e',
                fontSize: 13, transition: 'all .12s',
              }}
            >
              <span>{g.label}</span>
              {g.badge != null && g.badge > 0 && (
                <span style={{
                  fontSize: 11, padding: '1px 7px', borderRadius: 100, fontWeight: 600,
                  background: g.id === 'requests' ? '#f97316' : '#30363d',
                  color:      g.id === 'requests' ? '#fff'     : '#8b949e',
                }}>
                  {g.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ width: '100%', height: 1, background: '#30363d' }} />

        {/* Contact list / Requests */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
          {group === 'requests' ? (
            <ContactRequests
              requests={incomingRequests}
              onAccept={handleAccept}
              onReject={handleReject}
            />
          ) : filteredContacts.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#8b949e', padding: '32px 16px', fontSize: 13 }}>
              {query ? '未找到匹配联系人' : group === 'recent' ? '最近无联系记录' : '暂无联系人'}
            </div>
          ) : (
            filteredContacts.map(contact => (
              <button
                key={contact.id}
                onClick={() => setSelected(contact)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 8px', borderRadius: 8, width: '100%', textAlign: 'left',
                  background: selected?.id === contact.id ? '#21262d' : 'none',
                  border: 'none', cursor: 'pointer', transition: 'background .12s',
                }}
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {initials(contact.name)}
                  </div>
                  {contact.isOnline && (
                    <div style={{
                      position: 'absolute', bottom: 0, right: 0,
                      width: 10, height: 10, borderRadius: '50%',
                      background: '#3fb950', border: '2px solid #161b22',
                    }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    color: '#e6edf3', fontSize: 13, fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {contact.name}
                  </div>
                  <div style={{ color: '#8b949e', fontSize: 12 }}>@{contact.handle}</div>
                </div>
                {contact.isOnline && (
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3fb950', flexShrink: 0 }} />
                )}
              </button>
            ))
          )}
        </div>

        {/* Add contact */}
        <div style={{ padding: '12px 14px', borderTop: '1px solid #30363d' }}>
          <button
            onClick={() => setShowSearch(true)}
            style={{
              width: '100%', padding: '8px 0', borderRadius: 8,
              background: '#f97316', color: '#fff', border: 'none',
              fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            + 添加联系人
          </button>
        </div>
      </div>

      {/* ── Main panel ── */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12,
      }}>
        <div style={{ fontSize: 48, opacity: 0.15 }}>◈</div>
        <div style={{ color: '#8b949e', fontSize: 14 }}>选择联系人查看名片</div>
        <div style={{ color: '#6e7681', fontSize: 12 }}>
          {contacts.length} 位联系人
          {pendingCount > 0 && (
            <span style={{ color: '#f97316', marginLeft: 8 }}>· {pendingCount} 条待处理请求</span>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      {selected != null && (
        <ContactCard
          contact={selected}
          onClose={() => setSelected(null)}
          onMessage={() => handleMessage(selected)}
          onDelete={() => handleDelete(selected)}
          onBlock={() => handleBlock(selected)}
        />
      )}

      {showSearch && (
        <ContactSearch
          onClose={() => setShowSearch(false)}
          onRequestSent={handleRequestSent}
        />
      )}

      {/* ── Toast ── */}
      {toast != null && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1f2937', border: '1px solid #30363d', borderRadius: 8,
          padding: '10px 20px', color: '#e6edf3', fontSize: 13, zIndex: 2000,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
};
