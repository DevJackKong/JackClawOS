// @ts-nocheck
// QRScanner.tsx — 二维码扫描器
// 使用 getUserMedia 开摄像头；实际解码为 TODO（jsQR 依赖项未引入）
// 提供手动输入 @handle 作为备选方案

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface QRScannerProps {
  /** 扫描成功或手动输入后的回调，返回 handle（不含 @） */
  onResult: (handle: string) => void;
  onClose?: () => void;
}

type ScanState = 'idle' | 'requesting' | 'scanning' | 'denied' | 'error';

export const QRScanner: React.FC<QRScannerProps> = ({ onResult, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [state, setState] = useState<ScanState>('idle');
  const [manualHandle, setManualHandle] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [tab, setTab] = useState<'camera' | 'manual'>('camera');

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  // 启动摄像头
  async function startCamera() {
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState('scanning');
      // TODO: 接入 jsQR 或 zxing-wasm 进行实际帧解码
      // 示例帧循环骨架：
      // const tick = () => {
      //   if (!videoRef.current || !canvasRef.current) return;
      //   const ctx = canvasRef.current.getContext('2d')!;
      //   ctx.drawImage(videoRef.current, 0, 0);
      //   const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      //   const code = jsQR(imageData.data, imageData.width, imageData.height);
      //   if (code) handleQRData(code.data);
      //   else requestAnimationFrame(tick);
      // };
      // requestAnimationFrame(tick);
    } catch (err: unknown) {
      stopCamera();
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setState('denied');
      } else {
        setState('error');
        setErrMsg(err instanceof Error ? err.message : '摄像头启动失败');
      }
    }
  }

  // 从 QR 数据中解析 handle
  function handleQRData(data: string) {
    // 支持格式：
    // JACKCLAW/@handle  或  https://…/@handle  或  @handle  或  handle
    const match = data.match(/\/@([a-z0-9_-]+)/i) ?? data.match(/@([a-z0-9_-]+)/i);
    if (match) {
      stopCamera();
      onResult(match[1].toLowerCase());
    } else {
      // 尝试直接作为 handle
      const cleaned = data.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (cleaned.length >= 3) {
        stopCamera();
        onResult(cleaned);
      }
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = manualHandle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (cleaned.length < 3) return;
    onResult(cleaned);
  }

  // 组件卸载时停止摄像头
  useEffect(() => () => stopCamera(), [stopCamera]);

  return (
    <div style={{
      background: '#161b22',
      border: '1px solid #30363d',
      borderRadius: 12,
      overflow: 'hidden',
      width: 360,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      {/* 标题栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #30363d',
        background: '#0d1117',
      }}>
        <span style={{ color: '#e6edf3', fontWeight: 700, fontSize: 15 }}>扫描二维码名片</span>
        {onClose && (
          <button
            onClick={() => { stopCamera(); onClose(); }}
            style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', borderBottom: '1px solid #30363d' }}>
        {(['camera', 'manual'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); if (t === 'manual') stopCamera(); }}
            style={{
              flex: 1,
              padding: '10px',
              background: tab === t ? '#21262d' : 'transparent',
              border: 'none',
              borderBottom: tab === t ? '2px solid #f97316' : '2px solid transparent',
              color: tab === t ? '#f97316' : '#8b949e',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: tab === t ? 700 : 400,
            }}
          >
            {t === 'camera' ? '📷 摄像头扫描' : '⌨️ 手动输入'}
          </button>
        ))}
      </div>

      <div style={{ padding: 20 }}>
        {tab === 'camera' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            {/* 摄像头视图 */}
            <div style={{
              width: 300,
              height: 300,
              background: '#0d1117',
              borderRadius: 8,
              overflow: 'hidden',
              position: 'relative',
              border: '1px solid #30363d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <video
                ref={videoRef}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  display: state === 'scanning' ? 'block' : 'none',
                }}
                playsInline
                muted
              />

              {state !== 'scanning' && (
                <div style={{ textAlign: 'center', color: '#8b949e' }}>
                  {state === 'idle' && (
                    <>
                      <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
                      <div style={{ fontSize: 13 }}>点击下方按钮开启摄像头</div>
                    </>
                  )}
                  {state === 'requesting' && (
                    <>
                      <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
                      <div style={{ fontSize: 13 }}>请求摄像头权限…</div>
                    </>
                  )}
                  {state === 'denied' && (
                    <>
                      <div style={{ fontSize: 32, marginBottom: 12 }}>🚫</div>
                      <div style={{ fontSize: 13, color: '#f85149' }}>摄像头权限被拒绝</div>
                      <div style={{ fontSize: 11, marginTop: 8 }}>请在浏览器设置中允许摄像头访问</div>
                    </>
                  )}
                  {state === 'error' && (
                    <>
                      <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
                      <div style={{ fontSize: 13, color: '#f85149' }}>{errMsg || '摄像头启动失败'}</div>
                    </>
                  )}
                </div>
              )}

              {/* 扫描框叠加层 */}
              {state === 'scanning' && (
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 180,
                  height: 180,
                  border: '2px solid #f97316',
                  borderRadius: 8,
                  pointerEvents: 'none',
                }} />
              )}
            </div>

            {/* TODO 提示（扫码功能待实现） */}
            {state === 'scanning' && (
              <div style={{
                background: '#f97316',
                color: '#fff',
                fontSize: 11,
                padding: '6px 12px',
                borderRadius: 6,
                textAlign: 'center',
                lineHeight: 1.4,
              }}>
                ⚠️ 实际 QR 解码待接入 jsQR 库<br />
                当前版本请使用手动输入
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {state === 'idle' || state === 'denied' || state === 'error' ? (
                <button
                  onClick={startCamera}
                  style={{
                    background: '#f97316',
                    border: 'none',
                    color: '#fff',
                    padding: '8px 20px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  开启摄像头
                </button>
              ) : state === 'scanning' ? (
                <button
                  onClick={() => { stopCamera(); setState('idle'); }}
                  style={{
                    background: '#21262d',
                    border: '1px solid #30363d',
                    color: '#e6edf3',
                    padding: '8px 20px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 14,
                  }}
                >
                  停止
                </button>
              ) : null}
            </div>
          </div>
        )}

        {tab === 'manual' && (
          <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ color: '#8b949e', fontSize: 13 }}>输入对方的 @handle 来查找并添加联系人：</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{
                background: '#21262d',
                border: '1px solid #30363d',
                borderRight: 'none',
                color: '#8b949e',
                padding: '8px 12px',
                borderRadius: '6px 0 0 6px',
                fontSize: 16,
                display: 'flex',
                alignItems: 'center',
              }}>@</span>
              <input
                type="text"
                value={manualHandle}
                onChange={e => setManualHandle(e.target.value)}
                placeholder="handle"
                autoFocus
                style={{
                  flex: 1,
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: '0 6px 6px 0',
                  color: '#e6edf3',
                  padding: '8px 12px',
                  fontSize: 14,
                  outline: 'none',
                }}
                pattern="[a-zA-Z0-9_-]+"
                minLength={3}
                maxLength={32}
              />
            </div>
            <button
              type="submit"
              disabled={manualHandle.replace(/^@/, '').length < 3}
              style={{
                background: '#f97316',
                border: 'none',
                color: '#fff',
                padding: '10px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 700,
                opacity: manualHandle.replace(/^@/, '').length < 3 ? 0.5 : 1,
              }}
            >
              查找用户
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
