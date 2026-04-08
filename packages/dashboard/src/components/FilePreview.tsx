import React, { useMemo, useState } from 'react';
import type { FileItem, FileUploadResponse } from '../api.js';

type PreviewFile = FileItem | FileUploadResponse;

interface Props {
  file: PreviewFile;
  token?: string;
  className?: string;
  onDownload?: (file: PreviewFile) => Promise<void> | void;
}

function isImageFile(file: PreviewFile): boolean {
  return file.mimeType.startsWith('image/');
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function resolveUrl(path?: string): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  if (typeof window === 'undefined') return path;
  return `${window.location.protocol}//${window.location.host}${path}`;
}

export const FilePreview: React.FC<Props> = ({ file, token: _token, className, onDownload }) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const thumbnailUrl = useMemo(() => resolveUrl(file.thumbnailUrl ?? file.url), [file.thumbnailUrl, file.url]);
  const originalUrl = useMemo(() => resolveUrl(file.url), [file.url]);

  return (
    <>
      <div className={`file-preview-card ${className ?? ''}`.trim()}>
        <div className="file-preview-media">
          {isImageFile(file) && thumbnailUrl ? (
            <button
              type="button"
              className="file-preview-image-btn"
              onClick={() => setLightboxOpen(true)}
              title="点击放大"
            >
              <img className="file-preview-image" src={thumbnailUrl} alt={file.filename} />
            </button>
          ) : (
            <div className="file-preview-icon" aria-hidden="true">
              {file.mimeType.startsWith('audio/') ? '🎵' : file.mimeType.startsWith('application/') ? '📄' : '📎'}
            </div>
          )}
        </div>

        <div className="file-preview-body">
          <div className="file-preview-name" title={file.filename}>{file.filename}</div>
          <div className="file-preview-meta">
            <span>{formatBytes(file.size)}</span>
            <span>•</span>
            <span>{file.mimeType}</span>
          </div>
          <div className="file-preview-actions">
            <a
              className="file-preview-link"
              href={originalUrl}
              target="_blank"
              rel="noreferrer"
            >
              打开
            </a>
            <button
              type="button"
              className="file-preview-download"
              onClick={() => { void onDownload?.(file); }}
            >
              下载
            </button>
          </div>
        </div>
      </div>

      {lightboxOpen && isImageFile(file) && originalUrl && (
        <div className="file-lightbox" onClick={() => setLightboxOpen(false)}>
          <button
            type="button"
            className="file-lightbox-close"
            onClick={() => setLightboxOpen(false)}
          >
            ×
          </button>
          <img
            className="file-lightbox-image"
            src={originalUrl}
            alt={file.filename}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
};
