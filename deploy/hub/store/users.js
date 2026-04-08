"use strict";
// JackClaw Hub - User Account Store
// Persists to ~/.jackclaw/hub/users.json
// Passwords: crypto.scrypt with random salt
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userStore = exports.UserStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const server_1 = require("../server");
// ─── Paths ────────────────────────────────────────────────────────────────────
const HUB_DIR = path_1.default.join(process.env.HOME ?? '~', '.jackclaw', 'hub');
const USERS_FILE = path_1.default.join(HUB_DIR, 'users.json');
const DIRECTORY_FILE = path_1.default.join(HUB_DIR, 'directory.json');
// ─── Helpers ─────────────────────────────────────────────────────────────────
function loadJSON(file, fallback) {
    try {
        if (fs_1.default.existsSync(file))
            return JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    }
    catch { /* ignore */ }
    return fallback;
}
function saveJSON(file, data) {
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    fs_1.default.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
function hashPassword(password, salt) {
    return new Promise((resolve, reject) => {
        crypto_1.default.scrypt(password, salt, 64, (err, key) => {
            if (err)
                reject(err);
            else
                resolve(key.toString('hex'));
        });
    });
}
// ─── UserStore ────────────────────────────────────────────────────────────────
class UserStore {
    load() {
        return loadJSON(USERS_FILE, {});
    }
    save(store) {
        saveJSON(USERS_FILE, store);
    }
    /** Normalize @handle: lowercase, strip leading @, resolve federated forms.
     *  @jack → jack
     *  @jack.jackclaw → jack
     *  jack@jackclaw.ai → jack
     */
    normalizeHandle(raw) {
        const trimmed = raw.trim().toLowerCase();
        // Federated email form: jack@jackclaw.ai → jack
        if (trimmed.includes('@') && trimmed.indexOf('@') > 0) {
            const stripped = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
            if (stripped.includes('@')) {
                return stripped.slice(0, stripped.indexOf('@')).replace(/[^a-z0-9_-]/g, '');
            }
        }
        // Dot-separated form: jack.jackclaw → jack (strip domain suffix)
        const stripped = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
        const dotParts = stripped.split('.');
        if (dotParts.length >= 2 && dotParts[dotParts.length - 1] === 'jackclaw') {
            return dotParts[0].replace(/[^a-z0-9_-]/g, '');
        }
        return stripped.replace(/[^a-z0-9_-]/g, '');
    }
    // ─── Registration ──────────────────────────────────────────────────────────
    async register(handle, password, displayName, email, tenantId, orgId) {
        const h = this.normalizeHandle(handle);
        if (h.length < 3)
            throw Object.assign(new Error('handle 至少 3 个字符'), { status: 400 });
        if (password.length < 6)
            throw Object.assign(new Error('密码至少 6 个字符'), { status: 400 });
        const store = this.load();
        if (h in store)
            throw Object.assign(new Error(`@${h} 已被注册`), { status: 409 });
        const salt = crypto_1.default.randomBytes(16).toString('hex');
        const passwordHash = await hashPassword(password, salt);
        const agentNodeId = `user-${crypto_1.default.randomBytes(8).toString('hex')}`;
        const user = {
            handle: h,
            displayName: displayName.trim().slice(0, 64),
            email,
            tenantId,
            orgId,
            passwordHash,
            passwordSalt: salt,
            agentNodeId,
            bio: '',
            avatar: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        store[h] = user;
        this.save(store);
        // Auto-register corresponding Agent identity in directory
        this.registerAgentIdentity(user);
        const token = this.issueToken(user);
        return { token, user: this.toPublic(user) };
    }
    // ─── Login ─────────────────────────────────────────────────────────────────
    async login(handle, password) {
        const h = this.normalizeHandle(handle);
        const store = this.load();
        const user = store[h];
        if (!user)
            throw Object.assign(new Error('账号或密码错误'), { status: 401 });
        const hash = await hashPassword(password, user.passwordSalt);
        if (hash !== user.passwordHash)
            throw Object.assign(new Error('账号或密码错误'), { status: 401 });
        const token = this.issueToken(user);
        return { token, user: this.toPublic(user) };
    }
    // ─── Read ──────────────────────────────────────────────────────────────────
    getUser(handle) {
        const h = this.normalizeHandle(handle);
        const user = this.load()[h];
        return user ? this.toPublic(user) : null;
    }
    // ─── Update ────────────────────────────────────────────────────────────────
    updateProfile(handle, updates) {
        const h = this.normalizeHandle(handle);
        const store = this.load();
        const user = store[h];
        if (!user)
            throw Object.assign(new Error('用户不存在'), { status: 404 });
        if (updates.displayName)
            user.displayName = updates.displayName.trim().slice(0, 64);
        if (updates.bio !== undefined)
            user.bio = updates.bio.slice(0, 500);
        if (updates.avatar !== undefined)
            user.avatar = updates.avatar.slice(0, 500);
        if (updates.email !== undefined)
            user.email = updates.email || undefined;
        user.updatedAt = Date.now();
        store[h] = user;
        this.save(store);
        return this.toPublic(user);
    }
    // ─── Password Change ───────────────────────────────────────────────────────
    async changePassword(handle, oldPwd, newPwd) {
        const h = this.normalizeHandle(handle);
        const store = this.load();
        const user = store[h];
        if (!user)
            throw Object.assign(new Error('用户不存在'), { status: 404 });
        const hash = await hashPassword(oldPwd, user.passwordSalt);
        if (hash !== user.passwordHash)
            throw Object.assign(new Error('当前密码错误'), { status: 401 });
        if (newPwd.length < 6)
            throw Object.assign(new Error('新密码至少 6 个字符'), { status: 400 });
        const newSalt = crypto_1.default.randomBytes(16).toString('hex');
        user.passwordSalt = newSalt;
        user.passwordHash = await hashPassword(newPwd, newSalt);
        user.updatedAt = Date.now();
        store[h] = user;
        this.save(store);
    }
    // ─── Token ─────────────────────────────────────────────────────────────────
    validateToken(token) {
        try {
            const payload = jsonwebtoken_1.default.verify(token, server_1.JWT_SECRET, { algorithms: ['HS256'] });
            if (payload.role !== 'user' || !payload.handle)
                return null;
            return this.getUser(payload.handle);
        }
        catch {
            return null;
        }
    }
    // ─── List ──────────────────────────────────────────────────────────────────
    listUsers(page = 1, limit = 20) {
        const store = this.load();
        const all = Object.values(store).map(u => this.toPublic(u));
        all.sort((a, b) => b.createdAt - a.createdAt);
        const total = all.length;
        const pages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        return { users: all.slice(offset, offset + limit), total, page, pages };
    }
    // ─── Handle Availability ───────────────────────────────────────────────────
    isHandleAvailable(handle) {
        const h = this.normalizeHandle(handle);
        if (h.length < 3)
            return false;
        return !(h in this.load());
    }
    // ─── Private Helpers ───────────────────────────────────────────────────────
    toPublic(user) {
        const { passwordHash: _h, passwordSalt: _s, ...pub } = user;
        return pub;
    }
    issueToken(user) {
        return jsonwebtoken_1.default.sign({ handle: user.handle, displayName: user.displayName, role: 'user' }, server_1.JWT_SECRET, { expiresIn: '30d' });
    }
    /** Write an AgentProfile entry into directory.json for this user */
    registerAgentIdentity(user) {
        const dir = loadJSON(DIRECTORY_FILE, {});
        const handle = `@${user.handle}`;
        if (!(handle in dir)) {
            const profile = {
                nodeId: user.agentNodeId,
                handle,
                displayName: user.displayName,
                role: 'member',
                publicKey: '', // human user — no keypair at registration time
                hubUrl: `http://localhost:${process.env.HUB_PORT ?? 3100}`,
                capabilities: ['human'],
                visibility: 'contacts',
                createdAt: user.createdAt,
                lastSeen: user.createdAt,
            };
            if (user.tenantId) {
                ;
                profile.tenantId = user.tenantId;
            }
            dir[handle] = profile;
            saveJSON(DIRECTORY_FILE, dir);
        }
    }
}
exports.UserStore = UserStore;
exports.userStore = new UserStore();
//# sourceMappingURL=users.js.map