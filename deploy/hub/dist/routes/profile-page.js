"use strict";
/**
 * Profile Page Route
 * GET /@:handle — 返回公开 HTML 名片页
 *
 * 功能：
 * - 展示用户公开信息（displayName, bio, avatar）
 * - OG meta tags（Twitter Card + OpenGraph）
 * - "发消息"按钮跳转到 dashboard
 * - 无需认证，完全公开
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const users_1 = require("../store/users");
const router = (0, express_1.Router)();
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
function buildProfileHtml(handle, displayName, bio, avatar, hubUrl) {
    const safe = {
        handle: escapeHtml(handle),
        displayName: escapeHtml(displayName),
        bio: escapeHtml(bio),
        avatar: escapeHtml(avatar),
        hubUrl: escapeHtml(hubUrl),
    };
    const avatarHtml = safe.avatar
        ? `<img class="avatar" src="${safe.avatar}" alt="${safe.displayName}" onerror="this.style.display='none';document.getElementById('avatar-fallback').style.display='flex'" />`
        : '';
    const avatarFallback = displayName.slice(0, 2).toUpperCase();
    // 生成 profile URL
    const profileUrl = `${safe.hubUrl}/@${safe.handle}`;
    return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safe.displayName} (@${safe.handle}) — JackClaw</title>

  <!-- OpenGraph -->
  <meta property="og:type" content="profile" />
  <meta property="og:title" content="${safe.displayName} (@${safe.handle})" />
  <meta property="og:description" content="${safe.bio || 'JackClaw 成员'}" />
  <meta property="og:url" content="${profileUrl}" />
  ${safe.avatar ? `<meta property="og:image" content="${safe.avatar}" />` : ''}
  <meta property="og:site_name" content="JackClaw" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${safe.displayName} (@${safe.handle})" />
  <meta name="twitter:description" content="${safe.bio || 'JackClaw 成员'}" />
  ${safe.avatar ? `<meta name="twitter:image" content="${safe.avatar}" />` : ''}

  <!-- Canonical -->
  <link rel="canonical" href="${profileUrl}" />

  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }

    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 16px;
      max-width: 420px;
      width: 100%;
      overflow: hidden;
      box-shadow: 0 16px 64px rgba(0,0,0,0.5);
    }

    .card-top {
      background: linear-gradient(135deg, #161b22 0%, #1c2128 100%);
      border-bottom: 1px solid #30363d;
      padding: 32px 28px 24px;
      display: flex;
      align-items: center;
      gap: 20px;
      position: relative;
    }

    .card-top::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: #f97316;
    }

    .avatar-wrap {
      flex-shrink: 0;
      position: relative;
    }

    .avatar {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid #30363d;
      display: block;
    }

    .avatar-fallback {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: #f97316;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 700;
      color: #fff;
      border: 3px solid rgba(249,115,22,0.3);
      ${safe.avatar ? 'display: none;' : ''}
    }

    .card-info {
      flex: 1;
      min-width: 0;
    }

    .display-name {
      font-size: 22px;
      font-weight: 700;
      color: #e6edf3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .handle {
      font-size: 14px;
      color: #8b949e;
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
      margin-top: 4px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(249,115,22,0.1);
      border: 1px solid rgba(249,115,22,0.3);
      color: #f97316;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 12px;
      margin-top: 10px;
      letter-spacing: 0.03em;
    }

    .card-body {
      padding: 24px 28px;
    }

    .bio {
      color: #8b949e;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 24px;
      min-height: 20px;
    }

    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .btn-primary {
      flex: 1;
      min-width: 140px;
      background: #f97316;
      border: none;
      color: #fff;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      text-align: center;
      display: inline-block;
      transition: background 0.15s, transform 0.1s;
    }

    .btn-primary:hover {
      background: #ea6c10;
      transform: translateY(-1px);
    }

    .btn-secondary {
      flex: 1;
      min-width: 120px;
      background: #21262d;
      border: 1px solid #30363d;
      color: #e6edf3;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      text-align: center;
      display: inline-block;
      transition: background 0.15s;
    }

    .btn-secondary:hover {
      background: #30363d;
    }

    .footer {
      text-align: center;
      color: #484f58;
      font-size: 12px;
      margin-top: 24px;
    }

    .footer span {
      color: #f97316;
      font-weight: 700;
    }

    @media (max-width: 480px) {
      .card-top {
        flex-direction: column;
        text-align: center;
        padding: 24px 20px 20px;
      }
      .card-top::before { display: none; }
      .card-body { padding: 20px; }
      .badge { align-self: center; }
      .display-name { font-size: 20px; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-top">
      <div class="avatar-wrap">
        ${avatarHtml}
        <div class="avatar-fallback" id="avatar-fallback">${escapeHtml(avatarFallback)}</div>
      </div>
      <div class="card-info">
        <div class="display-name">${safe.displayName}</div>
        <div class="handle">@${safe.handle}</div>
        <div class="badge">⬡ JackClaw Member</div>
      </div>
    </div>

    <div class="card-body">
      ${safe.bio ? `<div class="bio">${safe.bio}</div>` : ''}

      <div class="actions">
        <a
          class="btn-primary"
          href="${safe.hubUrl}/?msg=@${safe.handle}"
          rel="noopener"
        >
          ✉ 发消息
        </a>
        <a
          class="btn-secondary"
          href="${safe.hubUrl}/"
          rel="noopener"
        >
          ⬡ 打开 JackClaw
        </a>
      </div>
    </div>
  </div>

  <div class="footer">
    由 <span>JackClaw</span> 提供支持 · 去中心化智能体协作网络
  </div>
</body>
</html>`;
}
// GET /@:handle
router.get('/@:handle', (req, res) => {
    const handle = users_1.userStore.normalizeHandle(req.params.handle ?? '');
    if (!handle) {
        res.status(400).send('<h1>Invalid handle</h1>');
        return;
    }
    const user = users_1.userStore.getUser(handle);
    if (!user) {
        res.status(404).send(`<!DOCTYPE html>
<html><head><title>用户不存在 — JackClaw</title>
<style>body{background:#0d1117;color:#e6edf3;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:12px}
h1{color:#f97316}p{color:#8b949e}</style></head>
<body><h1>⬡ 404</h1><p>用户 @${escapeHtml(handle)} 不存在</p>
<a href="/" style="color:#f97316">返回首页</a></body></html>`);
        return;
    }
    const hubUrl = process.env.HUB_URL ?? `http://localhost:${process.env.HUB_PORT ?? 3100}`;
    const html = buildProfileHtml(user.handle, user.displayName, user.bio ?? '', user.avatar ?? '', hubUrl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // 缓存 5 分钟（公开数据）
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.send(html);
});
exports.default = router;
//# sourceMappingURL=profile-page.js.map