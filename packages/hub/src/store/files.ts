/**
 * FileStore — 文件元数据管理 + 磁盘存储
 *
 * 文件存储到 ~/.jackclaw/hub/files/<uuid>.<ext>
 * 元数据持久化到 ~/.jackclaw/hub/files-meta.json
 */

import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'

export interface FileMetadata {
  fileId: string
  filename: string
  mimeType: string
  size: number
  ext: string
  uploadedAt: number
  url: string
  thumbnailUrl?: string
}

const HUB_DIR  = path.join(process.env.HOME || '~', '.jackclaw', 'hub')
const FILES_DIR = path.join(HUB_DIR, 'files')
const META_FILE = path.join(HUB_DIR, 'files-meta.json')

// mime → extension 映射
const MIME_EXT: Record<string, string> = {
  'image/jpeg':       '.jpg',
  'image/jpg':        '.jpg',
  'image/png':        '.png',
  'image/gif':        '.gif',
  'image/webp':       '.webp',
  'image/bmp':        '.bmp',
  'image/tiff':       '.tiff',
  'application/pdf':  '.pdf',
  'text/plain':       '.txt',
  'application/json': '.json',
  'application/zip':  '.zip',
  'video/mp4':        '.mp4',
  'audio/mpeg':       '.mp3',
}

export class FileStore {
  private meta: Record<string, FileMetadata> = {}

  constructor() {
    fs.mkdirSync(FILES_DIR, { recursive: true })
    this.loadMeta()
  }

  private loadMeta(): void {
    try {
      if (fs.existsSync(META_FILE)) {
        this.meta = JSON.parse(fs.readFileSync(META_FILE, 'utf-8')) as Record<string, FileMetadata>
      }
    } catch {
      this.meta = {}
    }
  }

  private saveMeta(): void {
    fs.writeFileSync(META_FILE, JSON.stringify(this.meta, null, 2), 'utf-8')
  }

  private extFromMime(mimeType: string): string {
    return MIME_EXT[mimeType] ?? ''
  }

  /** 保存文件到磁盘，返回元数据 */
  save(buffer: Buffer, filename: string, mimeType: string): FileMetadata {
    const fromFilename = path.extname(filename).toLowerCase()
    const ext = fromFilename || this.extFromMime(mimeType)
    const fileId = randomUUID()
    const filePath = path.join(FILES_DIR, `${fileId}${ext}`)

    fs.writeFileSync(filePath, buffer)

    const isImage = mimeType.startsWith('image/')
    const entry: FileMetadata = {
      fileId,
      filename,
      mimeType,
      size:        buffer.length,
      ext,
      uploadedAt:  Date.now(),
      url:         `/api/files/${fileId}`,
      thumbnailUrl: isImage ? `/api/files/${fileId}/thumb` : undefined,
    }

    this.meta[fileId] = entry
    this.saveMeta()
    return entry
  }

  /** 获取文件元数据 */
  get(fileId: string): FileMetadata | null {
    return this.meta[fileId] ?? null
  }

  /** 删除文件及缩略图 */
  delete(fileId: string): boolean {
    const entry = this.meta[fileId]
    if (!entry) return false

    const filePath = this.getFilePath(fileId)
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath)

    const thumbPath = this.getThumbnailPath(fileId)
    if (thumbPath && fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath)

    delete this.meta[fileId]
    this.saveMeta()
    return true
  }

  /** 分页列表 */
  list(page: number, limit: number): { files: FileMetadata[]; total: number; page: number; limit: number } {
    const all = Object.values(this.meta).sort((a, b) => b.uploadedAt - a.uploadedAt)
    const offset = (page - 1) * limit
    return { files: all.slice(offset, offset + limit), total: all.length, page, limit }
  }

  /** 获取文件磁盘路径 */
  getFilePath(fileId: string): string | null {
    const entry = this.meta[fileId]
    if (!entry) return null
    return path.join(FILES_DIR, `${fileId}${entry.ext}`)
  }

  /** 获取缩略图磁盘路径（不保证存在）*/
  getThumbnailPath(fileId: string): string | null {
    const entry = this.meta[fileId]
    if (!entry) return null
    return path.join(FILES_DIR, `${fileId}_thumb${entry.ext}`)
  }

  /** 已用存储空间（字节）*/
  getTotalSize(): number {
    return Object.values(this.meta).reduce((sum, f) => sum + f.size, 0)
  }
}

export const fileStore = new FileStore()
