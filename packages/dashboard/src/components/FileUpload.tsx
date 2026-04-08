import React, { useCallback, useMemo, useRef, useState } from 'react';
import { api, type FileUploadResponse } from '../api.js';
import { FilePreview } from './FilePreview.js';

const ACCEPTED_MIME_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'],
  document: [
    'application/pdf',
    'text/plain',
    'application/json',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4'],
} as const;

const ACCEPT = [
  ...ACCEPTED_MIME_TYPES.image,
  ...ACCEPTED_MIME_TYPES.document,
  ...ACCEPTED_MIME_TYPES.audio,
].join(',');

interface Props {
  token: string;
  disabled?: boolean;
  multiple?: boolean;
  onUploaded?: (files: FileUploadResponse[]) => void;
}

function fileAllowed(file: File): boolean {
  return Object.values(ACCEPTED_MIME_TYPES).some(group => group.includes(file.type as never));
}

function resolveUrl(path?: string): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  if (typeof window === 'undefined') return path;
  return `${window.location.protocol}//${window.location.host}${path}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : '上传失败';
}

export const FileUpload: React.FC<Props> = ({ token, disabled = false, multiple = false, onUploaded }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<FileUploadResponse[]>([]);
  const [localPreviewUrls, setLocalPreviewUrls] = useState<Record<string, string>>({});

  const acceptHint = useMemo(() => '图片 / 文档 / 音频', []);

  const handleDownload = useCallback(async (file: FileUploadResponse) => {
    const blob = await api.files.downloadFile(token, file.fileId);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = file.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }, [token]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!files.length || disabled || uploading) return;

    const invalid = files.find(file => !fileAllowed(file));
    if (invalid) {
      setError(`不支持的文件类型: ${invalid.name}`);
      return;
    }

    setError('');
    setUploading(true);
    setProgress(0);

    const uploaded: FileUploadResponse[] = [];
    const previewMap: Record<string, string> = {};

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]!;
        if (file.type.startsWith('image/')) {
          previewMap[file.name] = URL.createObjectURL(file);
        }

        const response = await api.files.uploadFile(token, file, {
          onProgress: percent => {
            const current = ((index + percent / 100) / files.length) * 100;
            setProgress(Math.round(current));
          },
        });
        uploaded.push(response);
      }

      setUploadedFiles(prev => (multiple ? [...uploaded, ...prev] : uploaded));
      setLocalPreviewUrls(prev => ({ ...prev, ...previewMap }));
      onUploaded?.(uploaded);
      setProgress(100);
    } catch (err) {
      Object.values(previewMap).forEach(url => URL.revokeObjectURL(url));
      setError(formatError(err));
    } finally {
      setUploading(false);
      window.setTimeout(() => setProgress(0), 800);
    }
  }, [disabled, multiple, onUploaded, token, uploading]);

  const handleInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    void uploadFiles(multiple ? files : files.slice(0, 1));
    event.target.value = '';
  }, [multiple, uploadFiles]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    void uploadFiles(multiple ? files : files.slice(0, 1));
  }, [multiple, uploadFiles]);

  return (
    <div className="file-upload">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={handleInputChange}
      />

      <div
        className={`file-upload-dropzone ${isDragging ? 'file-upload-dragging' : ''} ${disabled ? 'file-upload-disabled' : ''}`.trim()}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragEnter={event => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragOver={event => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={event => {
          event.preventDefault();
          if (event.currentTarget === event.target) setIsDragging(false);
        }}
        onDrop={handleDrop}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={event => {
          if ((event.key === 'Enter' || event.key === ' ') && !disabled) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <div className="file-upload-icon">⬆</div>
        <div className="file-upload-title">拖拽文件到这里，或点击选择</div>
        <div className="file-upload-subtitle">支持 {acceptHint}</div>
      </div>

      {uploading && (
        <div className="file-upload-progress-wrap">
          <div className="file-upload-progress-bar">
            <div className="file-upload-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="file-upload-progress-text">上传中 {progress}%</div>
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}

      {uploadedFiles.length > 0 && (
        <div className="file-upload-list">
          {uploadedFiles.map(file => (
            <div key={file.fileId} className="file-upload-item">
              {file.mimeType.startsWith('image/') && localPreviewUrls[file.filename] && !file.thumbnailUrl ? (
                <img
                  className="file-upload-thumb"
                  src={localPreviewUrls[file.filename] ?? resolveUrl(file.url)}
                  alt={file.filename}
                />
              ) : null}
              <FilePreview file={file} onDownload={handleDownload} />
              <div className="file-upload-url">URL: {resolveUrl(file.url) ?? file.url}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
