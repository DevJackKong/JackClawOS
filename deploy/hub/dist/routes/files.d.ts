/**
 * Hub File Upload/Download Routes
 *
 * POST   /api/files/upload        — 上传文件（multipart/form-data, 单文件 50MB）
 * GET    /api/files/list          — 文件列表（分页）
 * GET    /api/files/:fileId       — 下载文件
 * GET    /api/files/:fileId/thumb — 缩略图（图片自动生成；否则返回原图）
 * DELETE /api/files/:fileId       — 删除文件
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=files.d.ts.map