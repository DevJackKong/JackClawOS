// App.tsx — Tab navigation integrating NodeList, ChatPanel, TokenStats, ReportsList, PlanViewer

import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { NodeList } from './components/NodeList.js';
import { ChatPanel } from './components/ChatPanel.js';
import { TokenStats } from './components/TokenStats.js';
import { ReportsList } from './components/ReportsList.js';
import { PlanViewer } from './components/PlanViewer.js';
import { ContactsPage } from './components/ContactsPage.js';

type Tab = 'nodes' | 'chat' | 'reports' | 'plan' | 'stats' | 'contacts';
type HubStatus = 'checking' | 'ok' | 'error';

const LS_URL   = 'jackclaw_hub_url';
const LS_TOKEN = 'jackclaw_hub_token';

function getStored(key: string): string {
  return localStorage.getItem(key) ?? '';
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'nodes',    label: '节点', icon: '⬡' },
  { id: 'chat',     label: '对话', icon: '◈' },
  { id: 'reports',  label: '汇报', icon: '◉' },
  { id: 'plan',     label: '计划', icon: '◐' },
  { id: 'stats',    label: '统计', icon: '◑' },
  { id: 'contacts', label: '联系人', icon: '◫' },
];

const App: React.FC = () => {
  const [tab, setTab]   = useState<Tab>('nodes');
  const [url, setUrl]   = useState(() => getStored(LS_URL));
  const [token, setTok] = useState(() => getStored(LS_TOKEN));
  const [tempUrl, setTempUrl]   = useState(() => getStored(LS_URL));
  const [tempTok, setTempTok]   = useState(() => getStored(LS_TOKEN));
  const [configOpen, setConfigOpen] = useState(!getStored(LS_URL));
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hubStatus, setHubStatus] = useState<HubStatus>('checking');

  // Hub health probe — every 30s
  useEffect(() => {
    if (!url) { setHubStatus('error'); return; }
    let cancelled = false;

    const check = () => {
      api.health()
        .then(() => { if (!cancelled) setHubStatus('ok'); })
        .catch(() => { if (!cancelled) setHubStatus('error'); });
    };

    check();
    const iv = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [url]);

  function saveConfig() {
    const u = tempUrl.trim().replace(/\/$/, '');
    const t = tempTok.trim();
    localStorage.setItem(LS_URL, u);
    localStorage.setItem(LS_TOKEN, t);
    setUrl(u);
    setTok(t);
    setConfigOpen(false);
  }

  return (
    <div className="app" style={{ background: '#0d1117', minHeight: '100vh', color: '#e6edf3' }}>
      {/* ── Header ── */}
      <header className="app-header" style={{ background: '#161b22', borderBottom: '1px solid #30363d' }}>
        <div className="header-brand">
          <span className="brand-logo" style={{ color: '#f97316' }}>⬡</span>
          <span className="brand-name">JackClaw</span>
          <span className="brand-tag">HUB</span>
        </div>

        <nav className="tab-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab-btn ${tab === t.id ? 'tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="tab-icon">{t.icon}</span>
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="header-right">
          <div className={`hub-status hub-${hubStatus}`} title={`Hub: ${hubStatus}`}>
            <span className="hub-dot" />
            <span className="hub-status-text">
              {hubStatus === 'ok' ? 'HUB' : hubStatus === 'checking' ? '…' : '断开'}
            </span>
          </div>

          <button
            className={`config-toggle ${configOpen ? 'config-open' : ''}`}
            onClick={() => setConfigOpen(v => !v)}
            title="配置"
          >
            ◎
          </button>
        </div>
      </header>

      {/* ── Config drawer ── */}
      {configOpen && (
        <div className="config-drawer" style={{ background: '#161b22', borderBottom: '1px solid #30363d' }}>
          <div className="config-row">
            <input
              className="config-input"
              type="url"
              placeholder="Hub URL — http://localhost:3100"
              value={tempUrl}
              onChange={e => setTempUrl(e.target.value)}
            />
            <input
              className="config-input config-token"
              type="password"
              placeholder="JWT Token"
              value={tempTok}
              onChange={e => setTempTok(e.target.value)}
            />
            <button className="config-save" onClick={saveConfig}
              style={{ background: '#f97316', color: '#fff' }}>保存</button>
          </div>
          {url && (
            <div className="config-status">
              <span className="config-connected-dot" />
              <span className="config-url">{url}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Node selector (shown when Chat tab active) ── */}
      {tab === 'chat' && (
        <div className="node-selector-bar" style={{ background: '#161b22', borderBottom: '1px solid #30363d' }}>
          <span className="ns-label">目标节点：</span>
          <input
            className="ns-input"
            type="text"
            placeholder="nodeId (留空 = 广播)"
            value={selectedNode ?? ''}
            onChange={e => setSelectedNode(e.target.value || null)}
          />
        </div>
      )}

      {/* ── Main content ── */}
      <main className="app-main">
        {!url ? (
          <div className="no-config">
            <div className="no-config-icon" style={{ color: '#f97316' }}>⬡</div>
            <div className="no-config-text">请先配置 Hub URL 和 Token</div>
            <button className="no-config-btn" onClick={() => setConfigOpen(true)}
              style={{ background: '#f97316', color: '#fff' }}>
              打开配置
            </button>
          </div>
        ) : (
          <>
            {tab === 'nodes'   && <NodeList token={token} />}
            {tab === 'chat'    && <ChatPanel token={token} nodeId={selectedNode} />}
            {tab === 'reports' && <ReportsList token={token} />}
            {tab === 'plan'     && <PlanViewer token={token} />}
            {tab === 'stats'    && <TokenStats token={token} />}
            {tab === 'contacts' && (
              <ContactsPage
                token={token}
                onStartChat={nodeId => { setSelectedNode(nodeId); setTab('chat'); }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default App;
