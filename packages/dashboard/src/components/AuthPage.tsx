// AuthPage — 登录 / 注册 Tab 切换页

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from './AuthContext.js';

type Tab = 'login' | 'register';

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeHandle(v: string): string {
  return v.replace(/^@/, '').replace(/[^a-z0-9_-]/gi, '').toLowerCase();
}

// ── Sub-forms ─────────────────────────────────────────────────────────────────

const LoginForm: React.FC = () => {
  const { login } = useAuth();
  const [handle, setHandle]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!handle || !password) { setError('请填写所有字段'); return; }
    setBusy(true);
    setError('');
    try {
      await login(handle, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-field">
        <label className="auth-label">Handle</label>
        <div className="auth-handle-wrap">
          <span className="auth-at">@</span>
          <input
            className="auth-input auth-handle-input"
            type="text"
            placeholder="your_handle"
            value={handle}
            autoComplete="username"
            autoFocus
            onChange={e => setHandle(normalizeHandle(e.target.value))}
          />
        </div>
      </div>

      <div className="auth-field">
        <label className="auth-label">密码</label>
        <input
          className="auth-input"
          type="password"
          placeholder="••••••••"
          value={password}
          autoComplete="current-password"
          onChange={e => setPassword(e.target.value)}
        />
      </div>

      {error && <div className="auth-error">{error}</div>}

      <button className="auth-btn" type="submit" disabled={busy}>
        {busy ? '登录中…' : '登录'}
      </button>
    </form>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

type HandleStatus = 'idle' | 'checking' | 'available' | 'taken' | 'short';

const RegisterForm: React.FC = () => {
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle]           = useState('');
  const [handleStatus, setHandleStatus] = useState<HandleStatus>('idle');
  const [password, setPassword]       = useState('');
  const [confirm, setConfirm]         = useState('');
  const [error, setError]             = useState('');
  const [busy, setBusy]               = useState(false);
  const debounceRef                   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced handle availability check
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!handle) { setHandleStatus('idle'); return; }
    if (handle.length < 3) { setHandleStatus('short'); return; }

    setHandleStatus('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.auth.checkHandle(handle);
        setHandleStatus(res.available ? 'available' : 'taken');
      } catch {
        setHandleStatus('idle');
      }
    }, 500);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [handle]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName || !handle || !password || !confirm) {
      setError('请填写所有字段');
      return;
    }
    if (password !== confirm) {
      setError('两次密码不一致');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 个字符');
      return;
    }
    if (handleStatus !== 'available') {
      setError('Handle 不可用，请换一个');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await register(displayName, handle, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setBusy(false);
    }
  }

  const handleHint =
    handleStatus === 'checking'  ? <span className="auth-hint auth-hint-checking">检查中…</span>
    : handleStatus === 'available' ? <span className="auth-hint auth-hint-ok">✓ 可用</span>
    : handleStatus === 'taken'     ? <span className="auth-hint auth-hint-err">✗ 已被占用</span>
    : handleStatus === 'short'     ? <span className="auth-hint auth-hint-warn">至少 3 个字符</span>
    : null;

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-field">
        <label className="auth-label">显示名</label>
        <input
          className="auth-input"
          type="text"
          placeholder="Jack Zhang"
          value={displayName}
          maxLength={64}
          autoFocus
          onChange={e => setDisplayName(e.target.value)}
        />
      </div>

      <div className="auth-field">
        <label className="auth-label">Handle {handleHint}</label>
        <div className="auth-handle-wrap">
          <span className="auth-at">@</span>
          <input
            className={`auth-input auth-handle-input ${
              handleStatus === 'available' ? 'auth-input-ok'
              : handleStatus === 'taken' ? 'auth-input-err'
              : ''
            }`}
            type="text"
            placeholder="your_handle"
            value={handle}
            autoComplete="username"
            onChange={e => setHandle(normalizeHandle(e.target.value))}
          />
        </div>
      </div>

      <div className="auth-field">
        <label className="auth-label">密码</label>
        <input
          className="auth-input"
          type="password"
          placeholder="至少 6 个字符"
          value={password}
          autoComplete="new-password"
          onChange={e => setPassword(e.target.value)}
        />
      </div>

      <div className="auth-field">
        <label className="auth-label">确认密码</label>
        <input
          className={`auth-input ${confirm && confirm !== password ? 'auth-input-err' : ''}`}
          type="password"
          placeholder="再次输入密码"
          value={confirm}
          autoComplete="new-password"
          onChange={e => setConfirm(e.target.value)}
        />
      </div>

      {error && <div className="auth-error">{error}</div>}

      <button
        className="auth-btn"
        type="submit"
        disabled={busy || handleStatus === 'taken' || handleStatus === 'short' || handleStatus === 'checking'}
      >
        {busy ? '注册中…' : '创建账号'}
      </button>
    </form>
  );
};

// ── AuthPage ──────────────────────────────────────────────────────────────────

export const AuthPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('login');

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Brand */}
        <div className="auth-brand">
          <span className="auth-logo">⬡</span>
          <span className="auth-brand-name">JackClaw</span>
        </div>

        {/* Tab switcher */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === 'login' ? 'auth-tab-active' : ''}`}
            onClick={() => setTab('login')}
          >
            登录
          </button>
          <button
            className={`auth-tab ${tab === 'register' ? 'auth-tab-active' : ''}`}
            onClick={() => setTab('register')}
          >
            注册
          </button>
        </div>

        {/* Form */}
        {tab === 'login' ? <LoginForm /> : <RegisterForm />}
      </div>
    </div>
  );
};
