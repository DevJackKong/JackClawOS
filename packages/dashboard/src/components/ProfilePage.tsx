// ProfilePage — 个人资料编辑 + 二维码名片 + 扫码

import React, { useEffect, useState } from 'react';
import { api, type UserProfile } from '../api.js';
import { useAuth } from './AuthContext.js';
import { BusinessCard } from './QRCode.js';
import { QRScanner } from './QRScanner.js';

export const ProfilePage: React.FC = () => {
  const { user, token, logout, updateUser } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio]                 = useState(user?.bio ?? '');
  const [avatar, setAvatar]           = useState(user?.avatar ?? '');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');
  const [previewTab, setPreviewTab] = useState<'card' | 'scanner'>('card');

  // Sync form when user changes (e.g. initial load)
  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setBio(user?.bio ?? '');
    setAvatar(user?.avatar ?? '');
  }, [user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const updated: UserProfile = await api.auth.updateProfile(token, {
        displayName: displayName.trim() || undefined,
        bio,
        avatar,
      });
      updateUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (!user) return null;

  // Preview uses live form values
  const preview: UserProfile = {
    handle: user.handle,
    displayName: displayName || user.displayName,
    bio,
    avatar,
    agentNodeId: user.agentNodeId ?? '',
  };

  return (    <div className="profile-page">
      <div className="profile-layout">
        {/* ── Edit form ── */}
        <div className="profile-form-col">
          <h2 className="profile-section-title">个人资料</h2>

          <form className="profile-form" onSubmit={handleSave}>
            {/* Handle — readonly */}
            <div className="profile-field">
              <label className="profile-label">Handle（不可更改）</label>
              <div className="profile-handle-display">
                <span className="profile-at">@</span>
                <span className="profile-handle-value">{user.handle}</span>
              </div>
            </div>

            <div className="profile-field">
              <label className="profile-label">显示名</label>
              <input
                className="profile-input"
                type="text"
                value={displayName}
                maxLength={64}
                placeholder={user.displayName}
                onChange={e => setDisplayName(e.target.value)}
              />
            </div>

            <div className="profile-field">
              <label className="profile-label">Bio</label>
              <textarea
                className="profile-textarea"
                rows={3}
                maxLength={500}
                placeholder="一句话介绍自己…"
                value={bio}
                onChange={e => setBio(e.target.value)}
              />
              <div className="profile-char-count">{bio.length} / 500</div>
            </div>

            <div className="profile-field">
              <label className="profile-label">头像 URL</label>
              <input
                className="profile-input"
                type="url"
                value={avatar}
                placeholder="https://…"
                onChange={e => setAvatar(e.target.value)}
              />
            </div>

            {error && <div className="auth-error">{error}</div>}
            {saved && <div className="profile-saved">✓ 已保存</div>}

            <div className="profile-actions">
              <button className="auth-btn profile-save-btn" type="submit" disabled={saving}>
                {saving ? '保存中…' : '保存更改'}
              </button>
              <button
                className="profile-logout-btn"
                type="button"
                onClick={logout}
              >
                退出登录
              </button>
            </div>
          </form>
        </div>

        {/* ── 二维码名片 / 扫码 ── */}
        <div className="profile-preview-col">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              className={`tab-btn ${previewTab === 'card' ? 'tab-active' : ''}`}
              onClick={() => setPreviewTab('card')}
            >
              ⬡ 我的名片
            </button>
            <button
              className={`tab-btn ${previewTab === 'scanner' ? 'tab-active' : ''}`}
              onClick={() => setPreviewTab('scanner')}
            >
              📷 扫码添加
            </button>
          </div>

          {previewTab === 'card' && (
            <BusinessCard
              handle={user.handle}
              displayName={preview.displayName || user.displayName}
              bio={preview.bio}
              avatar={preview.avatar}
            />
          )}

          {previewTab === 'scanner' && (
            <QRScanner
              onResult={(handle) => {
                // TODO: 触发联系人搜索/添加流程
                alert(`扫描到 @${handle}，请在联系人页面搜索添加`);
                setPreviewTab('card');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
