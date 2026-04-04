/**
 * Hub File Upload/Download Routes
 *
 * POST   /api/files/upload        — 上传文件（multipart/form-data, 单文件 50MB）
 * GET    /api/files/list          — 文件列表（分页）
 * GET    /api/files/:fileId       — 下载文件
 * GET    /api/files/:fileId/thumb — 缩略图（图片自动生成；否则返回原图）
 * DELETE /api/files/:fileId       — 删除文件
 */

import { Router, Request, Response } from 'express'
import fs from 'fs'
import { fileStore } from '../store/files'

const router = Router()

const MAX_FILE_SIZE = 50 * 1024 * 1024  // 50 MB

// ─── Multipart Parser ─────────────────────────────────────────────────────────

interface MultipartPart {
  name?: string
  filename?: string
  mimeType?: string
  data: Buffer
}

/**
 * 手动解析 multipart/form-data — 不依赖任何第三方库
 * 返回所有 part，文件 part 包含 filename 和 mimeType
 */
function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const delim    = Buffer.from(`\r\n--${boundary}`)
  const endMark  = Buffer.from('--')
  const crlf     = Buffer.from('\r\n')
  const parts: MultipartPart[] = []

  // 找到第一个 boundary（无前缀 CRLF）
  const firstDelim = Buffer.from(`--${boundary}`)
  let pos = body.indexOf(firstDelim)
  if (pos === -1) return parts
  pos += firstDelim.length

  while (pos < body.length) {
    // 跳过 boundary 后的 CRLF
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) {
      pos += 2
    } else if (body[pos] === 0x2d && body[pos + 1] === 0x2d) {
      // `--` 标志结束
      break
    } else {
      break
    }

    // 解析该 part 的 headers（以空行结束）
    const headers: Record<string, string> = {}
    while (pos < body.length) {
      const lineEnd = body.indexOf(crlf, pos)
      if (lineEnd === -1) { pos = body.length; break }
      if (lineEnd === pos) { pos += 2; break }  // 空行 = headers 结束

      const line = body.slice(pos, lineEnd).toString('latin1')
      pos = lineEnd + 2

      const colon = line.indexOf(':')
      if (colon !== -1) {
        headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim()
      }
    }

    // 找到下一个 boundary 作为本 part body 的结尾
    const nextDelimPos = body.indexOf(delim, pos)
    if (nextDelimPos === -1) break

    const partData = body.slice(pos, nextDelimPos)
    pos = nextDelimPos + delim.length

    // 解析 Content-Disposition
    const disp = headers['content-disposition'] ?? ''
    const nameMatch     = disp.match(/;\s*name="([^"]*)"/)
    const filenameMatch = disp.match(/;\s*filename="([^"]*)"/)

    parts.push({
      name:     nameMatch?.[1],
      filename: filenameMatch?.[1],
      mimeType: headers['content-type'],
      data:     partData,
    })

    // 检查下一个 part 开头是否是 --（结束标志）
    if (body.slice(pos, pos + 2).equals(endMark)) break
  }

  return parts
}

// ─── Thumbnail Generation ─────────────────────────────────────────────────────

const THUMB_MAX = 200  // 最大边长像素

/**
 * 尝试用 canvas 模块生成缩略图。
 * canvas 未安装时静默失败返回 false，由调用方 fallback 到原图。
 */
async function tryGenerateThumbnail(
  srcPath: string,
  thumbPath: string,
  mimeType: string,
): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { createCanvas, loadImage } = await (Function('m', 'return import(m)')('canvas') as Promise<any>)

    const img = await loadImage(srcPath)
    const scale = Math.min(THUMB_MAX / img.width, THUMB_MAX / img.height, 1)
    const w = Math.max(1, Math.round(img.width  * scale))
    const h = Math.max(1, Math.round(img.height * scale))

    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext('2d')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(ctx as any).drawImage(img, 0, 0, w, h)

    const out = fs.createWriteStream(thumbPath)
    const stream = mimeType === 'image/png'
      ? canvas.createPNGStream()
      : canvas.createJPEGStream({ quality: 0.8 })

    stream.pipe(out)
    return await new Promise<boolean>((resolve) => {
      out.on('finish', () => resolve(true))
      out.on('error',  () => resolve(false))
    })
  } catch {
    return false
  }
}

// ─── POST /upload ─────────────────────────────────────────────────────────────

router.post('/upload', (req: Request, res: Response): void => {
  const contentType = req.headers['content-type'] ?? ''
  const match = contentType.match(/multipart\/form-data;\s*boundary=([^\s;]+)/)
  if (!match) {
    res.status(400).json({ error: 'Content-Type must be multipart/form-data' })
    return
  }
  const boundary = match[1].replace(/^"(.*)"$/, '$1')  // strip optional quotes

  const chunks: Buffer[] = []
  let received = 0

  req.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (received > MAX_FILE_SIZE + 4096) {  // +4096 for headers overhead
      req.destroy()
      res.status(413).json({ error: 'File too large. Maximum: 50MB' })
      return
    }
    chunks.push(chunk)
  })

  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const parts = parseMultipart(body, boundary)
    const filePart = parts.find(p => p.filename && p.data.length > 0)

    if (!filePart || !filePart.filename) {
      res.status(400).json({ error: 'No file found in request' })
      return
    }

    if (filePart.data.length > MAX_FILE_SIZE) {
      res.status(413).json({ error: 'File too large. Maximum: 50MB' })
      return
    }

    const mimeType = filePart.mimeType ?? 'application/octet-stream'
    const meta = fileStore.save(filePart.data, filePart.filename, mimeType)

    // 异步生成缩略图（不阻塞响应）
    if (mimeType.startsWith('image/')) {
      const srcPath   = fileStore.getFilePath(meta.fileId)!
      const thumbPath = fileStore.getThumbnailPath(meta.fileId)!
      tryGenerateThumbnail(srcPath, thumbPath, mimeType).then((ok) => {
        if (ok) console.log(`[files] Thumbnail generated: ${meta.fileId}`)
      }).catch(() => { /* fallback to original */ })
    }

    console.log(`[files] Uploaded: ${meta.fileId} (${meta.filename}, ${meta.size} bytes)`)
    res.status(201).json({
      fileId:   meta.fileId,
      url:      meta.url,
      filename: meta.filename,
      size:     meta.size,
      mimeType: meta.mimeType,
      thumbnailUrl: meta.thumbnailUrl,
    })
  })

  req.on('error', () => {
    res.status(500).json({ error: 'Upload failed' })
  })
})

// ─── GET /list ────────────────────────────────────────────────────────────────

router.get('/list', (req: Request, res: Response) => {
  const page  = Math.max(1, parseInt((req.query.page  as string) ?? '1',  10))
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? '20', 10)))
  const result = fileStore.list(page, limit)
  res.json({ ...result, totalSize: fileStore.getTotalSize() })
})

// ─── GET /:fileId/thumb ───────────────────────────────────────────────────────

router.get('/:fileId/thumb', (req: Request, res: Response): void => {
  const { fileId } = req.params
  if (!/^[0-9a-f-]{36}$/.test(fileId)) { res.status(400).json({ error: 'Invalid fileId' }); return }

  const meta = fileStore.get(fileId)
  if (!meta) { res.status(404).json({ error: 'File not found' }); return }

  // Try thumbnail first; fall back to original
  const thumbPath = fileStore.getThumbnailPath(fileId)
  const servePath = (thumbPath && fs.existsSync(thumbPath))
    ? thumbPath
    : fileStore.getFilePath(fileId)

  if (!servePath || !fs.existsSync(servePath)) {
    res.status(404).json({ error: 'File not found on disk' })
    return
  }

  res.setHeader('Content-Type', meta.mimeType)
  res.setHeader('Cache-Control', 'public, max-age=86400')
  fs.createReadStream(servePath).pipe(res)
})

// ─── GET /:fileId ─────────────────────────────────────────────────────────────

router.get('/:fileId', (req: Request, res: Response): void => {
  const { fileId } = req.params
  if (!/^[0-9a-f-]{36}$/.test(fileId)) { res.status(400).json({ error: 'Invalid fileId' }); return }

  const meta = fileStore.get(fileId)
  if (!meta) { res.status(404).json({ error: 'File not found' }); return }

  const filePath = fileStore.getFilePath(fileId)
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found on disk' })
    return
  }

  res.setHeader('Content-Type', meta.mimeType)
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.filename)}"`)
  res.setHeader('Content-Length', meta.size.toString())
  res.setHeader('Cache-Control', 'public, max-age=3600')
  fs.createReadStream(filePath).pipe(res)
})

// ─── DELETE /:fileId ──────────────────────────────────────────────────────────

router.delete('/:fileId', (req: Request, res: Response): void => {
  const { fileId } = req.params
  if (!/^[0-9a-f-]{36}$/.test(fileId)) { res.status(400).json({ error: 'Invalid fileId' }); return }

  const deleted = fileStore.delete(fileId)
  if (!deleted) { res.status(404).json({ error: 'File not found' }); return }

  console.log(`[files] Deleted: ${fileId}`)
  res.json({ status: 'ok', fileId })
})

export default router
