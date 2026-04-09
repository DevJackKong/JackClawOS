"use strict";
/**
 * User Authentication Routes
 *
 * POST /api/auth/register        — 注册（若 Hub 开启 requireInvite，需要邀请码）
 * POST /api/auth/login           — 登录
 * GET  /api/auth/me              — 当前用户 (JWT Bearer)
 * PATCH /api/auth/profile        — 更新资料 (JWT Bearer)
 * POST /api/auth/change-password — 修改密码 (JWT Bearer)
 * POST /api/auth/check-handle    — 检查 @handle 可用性 (无需认证)
 * GET  /api/auth/users           — 用户列表 (JWT Bearer, admin only)
 * POST /api/auth/invite          — 生成邀请码 (CEO/admin only)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const users_1 = require("../store/users");
const directory_1 = require("../store/directory");
const presence_1 = require("../presence");
const server_1 = require("../server");
const router = (0, express_1.Router)();
// ─── Paths ────────────────────────────────────────────────────────────────────
const HUB_DIR = path_1.default.join(process.env.HOME ?? '~', '.jackclaw', 'hub');
const INVITES_FILE = path_1.default.join(HUB_DIR, 'invites.json');
const HUB_CONFIG_FILE = path_1.default.join(HUB_DIR, 'config.json');
function getHubConfig() {
    try {
        if (fs_1.default.existsSync(HUB_CONFIG_FILE)) {
            return { requireInvite: false, admins: [], ...JSON.parse(fs_1.default.readFileSync(HUB_CONFIG_FILE, 'utf-8')) };
        }
    }
    catch { /* ignore */ }
    return { requireInvite: false, admins: [] };
}
function loadInvites() {
    try {
        if (fs_1.default.existsSync(INVITES_FILE)) {
            return JSON.parse(fs_1.default.readFileSync(INVITES_FILE, 'utf-8'));
        }
    }
    catch { /* ignore */ }
    return {};
}
function saveInvites(invites) {
    fs_1.default.mkdirSync(path_1.default.dirname(INVITES_FILE), { recursive: true });
    fs_1.default.writeFileSync(INVITES_FILE, JSON.stringify(invites, null, 2), 'utf-8');
}
function generateInviteCode() {
    // 6-char alphanumeric, URL-safe, easy to share
    return crypto_1.default.randomBytes(12).toString('base64url').slice(0, 12).toUpperCase();
}
/**
 * Validate and consume an invite code.
 * Returns true if used successfully, false if code is invalid/already used.
 */
function consumeInvite(code, handle) {
    const invites = loadInvites();
    const record = invites[code.toUpperCase()];
    if (!record || record.usedBy)
        return false;
    record.usedBy = handle;
    record.usedAt = Date.now();
    saveInvites(invites);
    return true;
}
// ─── Helper ───────────────────────────────────────────────────────────────────
/** Extract authenticated handle from Bearer JWT, or null */
function authedHandle(req) {
    const user = users_1.userStore.validateToken((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    return user?.handle ?? null;
}
function asyncRoute(fn) {
    return (req, res) => {
        fn(req, res).catch((err) => {
            res.status(err.status ?? 500).json({ error: err.message ?? 'Internal error' });
        });
    };
}
function isPublicRegisterHandle(handle) {
    const trimmed = handle.trim().toLowerCase();
    return trimmed.length >= 3
        && trimmed.length <= 50
        && /^@[a-z0-9][a-z0-9_-]{0,47}\.[a-z0-9][a-z0-9_-]{0,47}$/.test(trimmed);
}
function issueUserToken(handle, displayName) {
    return (0, server_1.signJWT)({ handle, displayName, role: 'user' }, '30d');
}
// ─── Public: no JWT required ──────────────────────────────────────────────────
// POST /api/auth/register
router.post('/register', asyncRoute(async (req, res) => {
    const { handle, password, displayName, email, inviteCode, hubUrl } = req.body ?? {};
    if (password) {
        if (!handle || !displayName) {
            res.status(400).json({ error: 'Missing required fields: handle, password, displayName' });
            return;
        }
        const config = getHubConfig();
        if (config.requireInvite) {
            if (!inviteCode || typeof inviteCode !== 'string') {
                res.status(403).json({ error: 'invite_required', message: 'Invite code required for registration' });
                return;
            }
            const invites = loadInvites();
            const record = invites[String(inviteCode).toUpperCase()];
            if (!record) {
                res.status(403).json({ error: 'invalid_invite', message: 'Invalid invite code' });
                return;
            }
            if (record.usedBy) {
                res.status(403).json({ error: 'invite_used', message: 'Invite code already used' });
                return;
            }
        }
        const normalizedHandle = users_1.userStore.normalizeHandle(String(handle));
        const result = await users_1.userStore.register(String(handle), String(password), String(displayName), email ? String(email) : undefined);
        // Consume the invite only after successful registration
        if (config.requireInvite && inviteCode) {
            consumeInvite(String(inviteCode), normalizedHandle);
        }
        // Auto-register in directory so social messaging works immediately.
        // Register both @jack (short) and @jack.jackclaw (canonical) as aliases for the same nodeId.
        const shortHandle = `@${normalizedHandle}`;
        const longHandle = `@${normalizedHandle}.jackclaw`;
        const nodeId = `user-${normalizedHandle}`;
        const existing = directory_1.directoryStore.getProfile(shortHandle) ?? directory_1.directoryStore.getProfile(longHandle);
        if (!existing) {
            const profileBase = {
                nodeId,
                displayName: String(displayName),
                role: 'member',
                publicKey: '',
                hubUrl: `http://localhost:${process.env.HUB_PORT ?? process.env.PORT ?? 3100}`,
                capabilities: [],
                visibility: 'public',
                createdAt: Date.now(),
                lastSeen: Date.now(),
            };
            directory_1.directoryStore.registerHandle(shortHandle, { ...profileBase, handle: shortHandle });
            directory_1.directoryStore.registerHandle(longHandle, { ...profileBase, handle: longHandle });
            // Register in presence so resolveHandle works
            presence_1.presenceManager.setOnline(nodeId);
        }
        res.status(201).json(result);
        return;
    }
    if (!handle || typeof handle !== 'string') {
        res.status(400).json({ error: 'Missing required field: handle' });
        return;
    }
    // SECURITY: enforce invite code even for passwordless registration
    const config2 = getHubConfig();
    if (config2.requireInvite) {
        if (!inviteCode || typeof inviteCode !== 'string') {
            res.status(403).json({ error: 'invite_required', message: 'Invite code required for registration' });
            return;
        }
        const invites2 = loadInvites();
        const record2 = invites2[String(inviteCode).toUpperCase()];
        if (!record2) {
            res.status(403).json({ error: 'invalid_invite', message: 'Invalid invite code' });
            return;
        }
        if (record2.usedBy) {
            res.status(403).json({ error: 'invite_used', message: 'Invite code already used' });
            return;
        }
    }
    const normalizedHandle = String(handle).trim().toLowerCase();
    if (!isPublicRegisterHandle(normalizedHandle)) {
        res.status(400).json({ error: 'Handle must be 3-50 chars in @xxx.yyy format' });
        return;
    }
    if (directory_1.directoryStore.getProfile(normalizedHandle)) {
        res.status(409).json({ error: 'handle_exists', message: `${normalizedHandle} already taken` });
        return;
    }
    const resolvedDisplayName = typeof displayName === 'string' && displayName.trim().length > 0
        ? displayName.trim().slice(0, 64)
        : normalizedHandle.slice(1);
    const nodeId = `public-user-${crypto_1.default.randomBytes(8).toString('hex')}`;
    const now = Date.now();
    directory_1.directoryStore.registerHandle(normalizedHandle, {
        nodeId,
        handle: normalizedHandle,
        displayName: resolvedDisplayName,
        role: 'member',
        publicKey: '',
        hubUrl: typeof hubUrl === 'string' && hubUrl.trim().length > 0
            ? hubUrl.trim()
            : `http://localhost:${process.env.HUB_PORT ?? process.env.PORT ?? 3100}`,
        capabilities: ['human'],
        visibility: 'public',
        createdAt: now,
        lastSeen: now,
    });
    // Consume invite code after successful registration
    if (config2.requireInvite && inviteCode) {
        consumeInvite(String(inviteCode), normalizedHandle);
    }
    res.status(201).json({
        token: issueUserToken(normalizedHandle, resolvedDisplayName),
        user: {
            handle: normalizedHandle,
            displayName: resolvedDisplayName,
            agentNodeId: nodeId,
            createdAt: now,
            updatedAt: now,
        },
    });
}));
// POST /api/auth/login
router.post('/login', asyncRoute(async (req, res) => {
    const { handle, password } = req.body ?? {};
    if (!handle || !password) {
        res.status(400).json({ error: 'Missing required fields: handle, password' });
        return;
    }
    const result = await users_1.userStore.login(String(handle), String(password));
    res.json(result);
}));
// POST /api/auth/check-handle
router.post('/check-handle', (req, res) => {
    const { handle } = req.body ?? {};
    if (!handle) {
        res.status(400).json({ error: 'Missing required field: handle' });
        return;
    }
    const normalized = users_1.userStore.normalizeHandle(String(handle));
    if (normalized.length < 3) {
        res.json({ available: false, reason: 'Handle must be at least 3 characters' });
        return;
    }
    res.json({ available: users_1.userStore.isHandleAvailable(normalized), handle: normalized });
});
// ─── Protected: JWT required ──────────────────────────────────────────────────
// GET /api/auth/me
router.get('/me', (req, res) => {
    const handle = authedHandle(req);
    if (!handle) {
        res.status(401).json({ error: 'Unauthorized — invalid or missing token' });
        return;
    }
    const user = users_1.userStore.getUser(handle);
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    res.json(user);
});
// PATCH /api/auth/profile
router.patch('/profile', (req, res) => {
    const handle = authedHandle(req);
    if (!handle) {
        res.status(401).json({ error: 'Unauthorized — invalid or missing token' });
        return;
    }
    try {
        const { displayName, bio, avatar, email } = req.body ?? {};
        const updated = users_1.userStore.updateProfile(handle, { displayName, bio, avatar, email });
        res.json(updated);
    }
    catch (err) {
        const e = err;
        res.status(e.status ?? 500).json({ error: e.message });
    }
});
// POST /api/auth/change-password
router.post('/change-password', asyncRoute(async (req, res) => {
    const handle = authedHandle(req);
    if (!handle) {
        res.status(401).json({ error: 'Unauthorized — invalid or missing token' });
        return;
    }
    const { oldPassword, newPassword } = req.body ?? {};
    if (!oldPassword || !newPassword) {
        res.status(400).json({ error: 'Missing required fields: oldPassword, newPassword' });
        return;
    }
    await users_1.userStore.changePassword(handle, String(oldPassword), String(newPassword));
    res.json({ ok: true });
}));
// GET /api/auth/users  (简单分页列表 — admin only)
router.get('/users', (req, res) => {
    const handle = authedHandle(req);
    if (!handle) {
        res.status(401).json({ error: 'Unauthorized — invalid or missing token' });
        return;
    }
    const config = getHubConfig();
    if (config.admins.length > 0 && !config.admins.includes(handle)) {
        res.status(403).json({ error: 'admin_only' });
        return;
    }
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    res.json(users_1.userStore.listUsers(page, limit));
});
// POST /api/auth/invite — 生成邀请码 (CEO/admin only)
router.post('/invite', asyncRoute(async (req, res) => {
    const handle = authedHandle(req);
    if (!handle) {
        res.status(401).json({ error: 'Unauthorized — invalid or missing token' });
        return;
    }
    const config = getHubConfig();
    // Must be listed in admins array (or admins list is empty → any user can generate, for dev mode)
    if (config.admins.length > 0 && !config.admins.includes(handle)) {
        res.status(403).json({ error: 'admin_only', message: 'Only admins can generate invite codes' });
        return;
    }
    const { count = 1 } = req.body ?? {};
    const batchSize = Math.min(Math.max(1, parseInt(String(count), 10)), 50);
    const invites = loadInvites();
    const codes = [];
    for (let i = 0; i < batchSize; i++) {
        let code;
        // Ensure uniqueness
        do {
            code = generateInviteCode();
        } while (invites[code]);
        const record = { code, createdBy: handle, createdAt: Date.now() };
        invites[code] = record;
        codes.push(code);
    }
    saveInvites(invites);
    console.log(`[auth] ${handle} generated ${batchSize} invite code(s)`);
    res.status(201).json({ codes, count: codes.length });
}));
exports.default = router;
//# sourceMappingURL=auth.js.map