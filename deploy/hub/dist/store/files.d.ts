/**
 * FileStore — 文件元数据管理 + 磁盘存储
 *
 * 文件存储到 ~/.jackclaw/hub/files/<uuid>.<ext>
 * 元数据持久化到 ~/.jackclaw/hub/files-meta.json
 */
export interface FileMetadata {
    fileId: string;
    filename: string;
    mimeType: string;
    size: number;
    ext: string;
    uploadedAt: number;
    url: string;
    thumbnailUrl?: string;
}
export declare class FileStore {
    private meta;
    constructor();
    private loadMeta;
    private saveMeta;
    private extFromMime;
    /** 保存文件到磁盘，返回元数据 */
    save(buffer: Buffer, filename: string, mimeType: string): FileMetadata;
    /** 获取文件元数据 */
    get(fileId: string): FileMetadata | null;
    /** 删除文件及缩略图 */
    delete(fileId: string): boolean;
    /** 分页列表 */
    list(page: number, limit: number): {
        files: FileMetadata[];
        total: number;
        page: number;
        limit: number;
    };
    /** 获取文件磁盘路径 */
    getFilePath(fileId: string): string | null;
    /** 获取缩略图磁盘路径（不保证存在）*/
    getThumbnailPath(fileId: string): string | null;
    /** 已用存储空间（字节）*/
    getTotalSize(): number;
}
export declare const fileStore: FileStore;
//# sourceMappingURL=files.d.ts.map