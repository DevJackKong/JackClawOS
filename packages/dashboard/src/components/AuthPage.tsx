import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from './AuthContext.js';

type Tab = 'login' | 'register';
type HandleStatus = 'idle' | 'checking' | 'available' | 'taken' | 'short';

interface FormErrors {
  email?: string;
  password?: string;
  confirm?: string;
  handle?: string;
  displayName?: string;
  terms?: string;
  form?: string;
}

function normalizeHandle(v: string): string {
  return v.replace(/^@/, '').replace(/[^a-z0-9_-]/gi, '').toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getPasswordStrength(password: string): {
  score: number;
  label: '弱' | '中' | '强';
  hint: string;
} {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) {
    return { score, label: '弱', hint: '至少 8 位，包含大小写字母、数字、特殊字符更安全' };
  }
  if (score <= 3) {
    return { score, label: '中', hint: '再加入特殊字符或更长密码会更安全' };
  }
  return { score, label: '强', hint: '密码强度不错' };
}

function mapAuthError(err: unknown, mode: Tab): string {
  const fallback = mode === 'login' ? '登录失败，请稍后重试' : '注册失败，请稍后重试';
  const message = err instanceof Error ? err.message : '';

  if (!message) return fallback;
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return '网络异常，请检查连接后重试';
  }
  if (/http 401|invalid|密码错误|handle 和密码|未登录或 token 无效/i.test(message)) {
    return mode === 'login' ? '账号或密码错误' : fallback;
  }
  if (/http 409|already exists|已存在|handle.*taken|占用/i.test(message)) {
    return '账号已存在，请更换邮箱或 Handle';
  }
  if (/invite_required|invalid_invite|invite_used/i.test(message)) {
    return '当前站点注册需要邀请码';
  }
  if (/http 429|too many|rate limit/i.test(message)) {
    return '操作过于频繁，请稍后再试';
  }

  const serverMessage = message.replace(/^HTTP\s+\d+:\s*/i, '').trim();
  return serverMessage || fallback;
}

const LoginForm: React.FC = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);

  const emailId = useId();
  const passwordId = useId();
  const formErrorId = useId();
  const forgotPasswordId = useId();

  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!email.trim()) {
      next.email = '请输入邮箱';
    } else if (!isValidEmail(email.trim())) {
      next.email = '请输入有效的邮箱地址';
    }

    if (!password) {
      next.password = '请输入密码';
    }

    return next;
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setBusy(true);
    setErrors({});
    try {
      await login(email.trim(), password);
    } catch (err: unknown) {
      setErrors({ form: mapAuthError(err, 'login') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy}>
      <div className="auth-field">
        <label className="auth-label" htmlFor={emailId}>邮箱</label>
        <input
          id={emailId}
          className={`auth-input ${errors.email ? 'auth-input-err' : ''}`}
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          autoComplete="username email"
          autoFocus
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? `${emailId}-error` : undefined}
          onChange={e => setEmail(e.target.value)}
        />
        {errors.email && (
          <div id={`${emailId}-error`} className="auth-error" role="alert">
            {errors.email}
          </div>
        )}
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor={passwordId}>密码</label>
        <input
          id={passwordId}
          className={`auth-input ${errors.password ? 'auth-input-err' : ''}`}
          type="password"
          placeholder="请输入密码"
          value={password}
          autoComplete="current-password"
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? `${passwordId}-error` : forgotPasswordId}
          onChange={e => setPassword(e.target.value)}
        />
        {errors.password && (
          <div id={`${passwordId}-error`} className="auth-error" role="alert">
            {errors.password}
          </div>
        )}
      </div>

      <div className="auth-field" style={{ marginTop: -4 }}>
        <button
          id={forgotPasswordId}
          type="button"
          className="auth-link-btn"
          aria-label="忘记密码，功能即将开放"
          title="忘记密码功能即将开放"
        >
          忘记密码？
        </button>
      </div>

      {errors.form && (
        <div id={formErrorId} className="auth-error" role="alert">
          {errors.form}
        </div>
      )}

      <button className="auth-btn" type="submit" disabled={busy} aria-disabled={busy}>
        {busy ? '登录中…' : '登录'}
      </button>
    </form>
  );
};

const RegisterForm: React.FC = () => {
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [handleStatus, setHandleStatus] = useState<HandleStatus>('idle');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayNameId = useId();
  const emailId = useId();
  const handleId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const termsId = useId();

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!handle) {
      setHandleStatus('idle');
      return;
    }
    if (handle.length < 3) {
      setHandleStatus('short');
      return;
    }

    setHandleStatus('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.auth.checkHandle(handle);
        setHandleStatus(res.available ? 'available' : 'taken');
      } catch {
        setHandleStatus('idle');
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [handle]);

  function validate(): FormErrors {
    const next: FormErrors = {};

    if (!displayName.trim()) next.displayName = '请输入显示名';

    if (!email.trim()) {
      next.email = '请输入邮箱';
    } else if (!isValidEmail(email.trim())) {
      next.email = '请输入有效的邮箱地址';
    }

    if (!handle.trim()) {
      next.handle = '请输入 Handle';
    } else if (handle.length < 3) {
      next.handle = 'Handle 至少 3 个字符';
    } else if (handleStatus === 'taken') {
      next.handle = 'Handle 已被占用';
    }

    if (!password) {
      next.password = '请输入密码';
    } else if (password.length < 8) {
      next.password = '密码至少 8 个字符';
    } else if (passwordStrength.score <= 1) {
      next.password = '密码强度过弱，请包含大小写字母、数字或特殊字符';
    }

    if (!confirm) {
      next.confirm = '请再次输入密码';
    } else if (confirm !== password) {
      next.confirm = '两次输入的密码不一致';
    }

    if (!agreeTerms) {
      next.terms = '请先同意服务条款';
    }

    return next;
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setBusy(true);
    setErrors({});
    try {
      await register(displayName.trim(), email.trim(), password);
    } catch (err: unknown) {
      setErrors({ form: mapAuthError(err, 'register') });
    } finally {
      setBusy(false);
    }
  }

  const handleHint =
    handleStatus === 'checking' ? <span className="auth-hint auth-hint-checking">检查中…</span>
    : handleStatus === 'available' ? <span className="auth-hint auth-hint-ok">✓ 可用</span>
    : handleStatus === 'taken' ? <span className="auth-hint auth-hint-err">✗ 已被占用</span>
    : handleStatus === 'short' ? <span className="auth-hint auth-hint-warn">至少 3 个字符</span>
    : null;

  return (
    <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy}>
      <div className="auth-field">
        <label className="auth-label" htmlFor={displayNameId}>显示名</label>
        <input
          id={displayNameId}
          className={`auth-input ${errors.displayName ? 'auth-input-err' : ''}`}
          type="text"
          placeholder="Jack Zhang"
          value={displayName}
          maxLength={64}
          autoFocus
          aria-invalid={Boolean(errors.displayName)}
          aria-describedby={errors.displayName ? `${displayNameId}-error` : undefined}
          onChange={e => setDisplayName(e.target.value)}
        />
        {errors.displayName && (
          <div id={`${displayNameId}-error`} className="auth-error" role="alert">
            {errors.displayName}
          </div>
        )}
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor={emailId}>邮箱</label>
        <input
          id={emailId}
          className={`auth-input ${errors.email ? 'auth-input-err' : ''}`}
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          autoComplete="email"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? `${emailId}-error` : undefined}
          onChange={e => setEmail(e.target.value)}
        />
        {errors.email && (
          <div id={`${emailId}-error`} className="auth-error" role="alert">
            {errors.email}
          </div>
        )}
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor={handleId}>Handle {handleHint}</label>
        <div className="auth-handle-wrap">
          <span className="auth-at">@</span>
          <input
            id={handleId}
            className={`auth-input auth-handle-input ${
              errors.handle || handleStatus === 'taken' ? 'auth-input-err'
              : handleStatus === 'available' ? 'auth-input-ok'
              : ''
            }`}
            type="text"
            placeholder="your_handle"
            value={handle}
            autoComplete="nickname"
            aria-invalid={Boolean(errors.handle)}
            aria-describedby={errors.handle ? `${handleId}-error` : undefined}
            onChange={e => setHandle(normalizeHandle(e.target.value))}
          />
        </div>
        {errors.handle && (
          <div id={`${handleId}-error`} className="auth-error" role="alert">
            {errors.handle}
          </div>
        )}
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor={passwordId}>密码</label>
        <input
          id={passwordId}
          className={`auth-input ${errors.password ? 'auth-input-err' : ''}`}
          type="password"
          placeholder="至少 8 个字符"
          value={password}
          autoComplete="new-password"
          aria-invalid={Boolean(errors.password)}
          aria-describedby={`${passwordId}-hint${errors.password ? ` ${passwordId}-error` : ''}`}
          onChange={e => setPassword(e.target.value)}
        />
        <div id={`${passwordId}-hint`} className="auth-hint" aria-live="polite">
          密码强度：{password ? passwordStrength.label : '—'} · {passwordStrength.hint}
        </div>
        {errors.password && (
          <div id={`${passwordId}-error`} className="auth-error" role="alert">
            {errors.password}
          </div>
        )}
      </div>

      <div className="auth-field">
        <label className="auth-label" htmlFor={confirmId}>确认密码</label>
        <input
          id={confirmId}
          className={`auth-input ${errors.confirm ? 'auth-input-err' : ''}`}
          type="password"
          placeholder="再次输入密码"
          value={confirm}
          autoComplete="new-password"
          aria-invalid={Boolean(errors.confirm)}
          aria-describedby={errors.confirm ? `${confirmId}-error` : undefined}
          onChange={e => setConfirm(e.target.value)}
        />
        {errors.confirm && (
          <div id={`${confirmId}-error`} className="auth-error" role="alert">
            {errors.confirm}
          </div>
        )}
      </div>

      <div className="auth-field">
        <label className="auth-checkbox" htmlFor={termsId}>
          <input
            id={termsId}
            type="checkbox"
            checked={agreeTerms}
            aria-invalid={Boolean(errors.terms)}
            aria-describedby={errors.terms ? `${termsId}-error` : undefined}
            onChange={e => setAgreeTerms(e.target.checked)}
          />
          <span>我已阅读并同意服务条款与隐私政策</span>
        </label>
        {errors.terms && (
          <div id={`${termsId}-error`} className="auth-error" role="alert">
            {errors.terms}
          </div>
        )}
      </div>

      {errors.form && (
        <div className="auth-error" role="alert">
          {errors.form}
        </div>
      )}

      <button
        className="auth-btn"
        type="submit"
        disabled={busy || handleStatus === 'taken' || handleStatus === 'short' || handleStatus === 'checking'}
        aria-disabled={busy || handleStatus === 'taken' || handleStatus === 'short' || handleStatus === 'checking'}
      >
        {busy ? '注册中…' : '创建账号'}
      </button>
    </form>
  );
};

export const AuthPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('login');

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo">🦞</span>
          <span className="auth-brand-name">JackClaw</span>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="认证方式切换">
          <button
            className={`auth-tab ${tab === 'login' ? 'auth-tab-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            aria-controls="auth-panel-login"
            id="auth-tab-login"
            onClick={() => setTab('login')}
          >
            登录
          </button>
          <button
            className={`auth-tab ${tab === 'register' ? 'auth-tab-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === 'register'}
            aria-controls="auth-panel-register"
            id="auth-tab-register"
            onClick={() => setTab('register')}
          >
            注册
          </button>
        </div>

        <div
          id={tab === 'login' ? 'auth-panel-login' : 'auth-panel-register'}
          role="tabpanel"
          aria-labelledby={tab === 'login' ? 'auth-tab-login' : 'auth-tab-register'}
        >
          {tab === 'login' ? <LoginForm /> : <RegisterForm />}
        </div>
      </div>
    </div>
  );
};
