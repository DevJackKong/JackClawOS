"use strict";
/**
 * FileStore — 文件元数据管理 + 磁盘存储
 *
 * 文件存储到 ~/.jackclaw/hub/files/<uuid>.<ext>
 * 元数据持久化到 ~/.jackclaw/hub/files-meta.json
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileStore = exports.FileStore = void 0;
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const HUB_DIR = path_1.default.join(process.env.HOME || '~', '.jackclaw', 'hub');
const FILES_DIR = path_1.default.join(HUB_DIR, 'files');
const META_FILE = path_1.default.join(HUB_DIR, 'files-meta.json');
// mime → extension 映射
const MIME_EXT = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/json': '.json',
    'application/zip': '.zip',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3',
};
class FileStore {
    meta = {};
    constructor() {
        fs_1.default.mkdirSync(FILES_DIR, { recursive: true });
        this.loadMeta();
    }
    loadMeta() {
        try {
            if (fs_1.default.existsSync(META_FILE)) {
                this.meta = JSON.parse(fs_1.default.readFileSync(META_FILE, 'utf-8'));
            }
        }
        catch {
            this.meta = {};
        }
    }
    saveMeta() {
        fs_1.default.writeFileSync(META_FILE, JSON.stringify(this.meta, null, 2), 'utf-8');
    }
    extFromMime(mimeType) {
        return MIME_EXT[mimeType] ?? '';
    }
    /** 保存文件到磁盘，返回元数据 */
    save(buffer, filename, mimeType) {
        const fromFilename = path_1.default.extname(filename).toLowerCase();
        const ext = fromFilename || this.extFromMime(mimeType);
        const fileId = (0, crypto_1.randomUUID)();
        const filePath = path_1.default.join(FILES_DIR, `${fileId}${ext}`);
        fs_1.default.writeFileSync(filePath, buffer);
        const isImage = mimeType.startsWith('image/');
        const entry = {
            fileId,
            filename,
            mimeType,
            size: buffer.length,
            ext,
            uploadedAt: Date.now(),
            url: `/api/files/${fileId}`,
            thumbnailUrl: isImage ? `/api/files/${fileId}/thumb` : undefined,
        };
        this.meta[fileId] = entry;
        this.saveMeta();
        return entry;
    }
    /** 获取文件元数据 */
    get(fileId) {
        return this.meta[fileId] ?? null;
    }
    /** 删除文件及缩略图 */
    delete(fileId) {
        const entry = this.meta[fileId];
        if (!entry)
            return false;
        const filePath = this.getFilePath(fileId);
        if (filePath && fs_1.default.existsSync(filePath))
            fs_1.default.unlinkSync(filePath);
        const thumbPath = this.getThumbnailPath(fileId);
        if (thumbPath && fs_1.default.existsSync(thumbPath))
            fs_1.default.unlinkSync(thumbPath);
        delete this.meta[fileId];
        this.saveMeta();
        return true;
    }
    /** 分页列表 */
    list(page, limit) {
        const all = Object.values(this.meta).sort((a, b) => b.uploadedAt - a.uploadedAt);
        const offset = (page - 1) * limit;
        return { files: all.slice(offset, offset + limit), total: all.length, page, limit };
    }
    /** 获取文件磁盘路径 */
    getFilePath(fileId) {
        const entry = this.meta[fileId];
        if (!entry)
            return null;
        return path_1.default.join(FILES_DIR, `${fileId}${entry.ext}`);
    }
    /** 获取缩略图磁盘路径（不保证存在）*/
    getThumbnailPath(fileId) {
        const entry = this.meta[fileId];
        if (!entry)
            return null;
        return path_1.default.join(FILES_DIR, `${fileId}_thumb${entry.ext}`);
    }
    /** 已用存储空间（字节）*/
    getTotalSize() {
        return Object.values(this.meta).reduce((sum, f) => sum + f.size, 0);
    }
}
exports.FileStore = FileStore;
exports.fileStore = new FileStore();
//# sourceMappingURL=files.js.map