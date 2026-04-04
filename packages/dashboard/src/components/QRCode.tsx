// @ts-nocheck
// QRCode.tsx — 二维码名片组件
// 纯 Canvas 实现 QR Code（Version 2，字母数字模式）+ 名片样式

import React, { useEffect, useRef, useState } from 'react';

// ─── QR Code Matrix Generator ─────────────────────────────────────────────────
// 实现 QR Code Version 2 (25×25)，字母数字模式，纠错等级 M
// 支持短文本（最多 25 个字母数字字符）

// 字母数字字符集
const ALPHANUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function alphanumEncode(text: string): boolean[] {
  const upper = text.toUpperCase();
  const bits: boolean[] = [];
  // 模式指示符：0010 (alphanumeric)
  bits.push(false, false, true, false);
  // 字符计数（9 bit for V2 alphanum）
  const len = upper.length;
  for (let i = 8; i >= 0; i--) bits.push(!!(len & (1 << i)));

  // 数据：每对字符 = 11 bit；单字符 = 6 bit
  for (let i = 0; i < upper.length; i += 2) {
    if (i + 1 < upper.length) {
      const val = ALPHANUM.indexOf(upper[i]) * 45 + ALPHANUM.indexOf(upper[i + 1]);
      for (let b = 10; b >= 0; b--) bits.push(!!(val & (1 << b)));
    } else {
      const val = ALPHANUM.indexOf(upper[i]);
      for (let b = 5; b >= 0; b--) bits.push(!!(val & (1 << b)));
    }
  }
  // 终止符（最多 4 bit）
  for (let i = 0; i < 4 && bits.length < 44 * 8; i++) bits.push(false);
  // 补齐到 8 倍数
  while (bits.length % 8 !== 0) bits.push(false);
  // 填充码字（V2-M 数据容量 = 44 码字）
  const pads = [0xec, 0x11];
  let pi = 0;
  while (bits.length < 44 * 8) {
    const pad = pads[pi++ % 2];
    for (let b = 7; b >= 0; b--) bits.push(!!(pad & (1 << b)));
  }
  return bits;
}

// GF(256) 运算，生成多项式 x^8 + x^4 + x^3 + x^2 + 1
function gfMul(a: number, b: number): number {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) result ^= a;
    const hiBit = a & 0x80;
    a = (a << 1) & 0xff;
    if (hiBit) a ^= 0x1d; // x^4+x^3+x^2+1 = 0x1d (after dropping x^8)
    b >>= 1;
  }
  return result;
}

// V2-M：10 个纠错码字，生成多项式系数
const EC_POLY = [251, 67, 46, 61, 118, 70, 64, 94, 32, 45];

function calcECC(data: number[]): number[] {
  const msg = [...data];
  for (let i = 0; i < data.length; i++) {
    const coef = msg.shift()!;
    if (coef === 0) { msg.push(0); continue; }
    // 找 log
    let log = 0;
    let x = coef;
    while (x > 1) { x = gfMul(x, 1); log++; } // 简化：直接计算
    // 实际用查表更快，此处直接用乘法
    for (let j = 0; j < EC_POLY.length; j++) {
      msg[j] = (msg[j] ?? 0) ^ gfMul(coef, EC_POLY[j]);
    }
    msg.push(0);
  }
  return msg.slice(0, 10);
}

// ─── 构建 25×25 矩阵 ──────────────────────────────────────────────────────────

type Matrix = (boolean | null)[][]; // null = 未填充

function makeMatrix(): Matrix {
  return Array.from({ length: 25 }, () => Array(25).fill(null));
}

function setFinder(m: Matrix, row: number, col: number) {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const dark =
        r === 0 || r === 6 || c === 0 || c === 6 ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      m[row + r][col + c] = dark;
    }
  }
}

function setAlignmentPattern(m: Matrix, row: number, col: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const dark = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
      m[row + r][col + c] = dark;
    }
  }
}

function reserveFormatArea(m: Matrix) {
  // 水平格式信息带（行 8，列 0-8 和 17-24）
  for (let i = 0; i <= 8; i++) if (m[8][i] === null) m[8][i] = false;
  for (let i = 17; i < 25; i++) if (m[8][i] === null) m[8][i] = false;
  // 垂直格式信息带（列 8，行 0-8 和 17-24）
  for (let i = 0; i <= 8; i++) if (m[i][8] === null) m[i][8] = false;
  for (let i = 17; i < 25; i++) if (m[i][8] === null) m[i][8] = false;
  // 暗模块
  m[17][8] = true;
}

// V2 对齐图案位置：(18,18)
function buildModuleMatrix(dataBits: boolean[]): Matrix {
  const m = makeMatrix();

  // 查找图案（3 个角）
  setFinder(m, 0, 0);
  setFinder(m, 0, 18);
  setFinder(m, 18, 0);

  // 分隔符（已由查找图案边界自动填充为 false，此处补全）
  for (let i = 0; i < 8; i++) {
    setIfNull(m, 7, i, false); setIfNull(m, i, 7, false);   // TL
    setIfNull(m, 7, 17 + i, false); setIfNull(m, i, 17, false); // TR
    setIfNull(m, 18 + i, 7, false); setIfNull(m, 17, i, false); // BL
  }
  setIfNull(m, 7, 7, false);

  // 对齐图案
  setAlignmentPattern(m, 18, 18);

  // 时序图案
  for (let i = 8; i <= 16; i++) {
    setIfNull(m, 6, i, i % 2 === 0);
    setIfNull(m, i, 6, i % 2 === 0);
  }

  // 预留格式信息区域
  reserveFormatArea(m);

  // 填充数据位（Z 形扫描，从右下角开始）
  let bitIdx = 0;
  let up = true;
  let col = 24;

  while (col >= 0 && bitIdx < dataBits.length) {
    if (col === 6) col--; // 跳过时序列

    for (let rowStep = 0; rowStep < 25; rowStep++) {
      const row = up ? 24 - rowStep : rowStep;
      for (let dc = 0; dc <= 1; dc++) {
        const c = col - dc;
        if (c < 0) continue;
        if (m[row][c] === null) {
          m[row][c] = dataBits[bitIdx++] ?? false;
        }
      }
    }
    col -= 2;
    up = !up;
  }

  // 掩码 0: (row+col) % 2 === 0 翻转数据模块
  applyMask(m, 0);

  // 写入格式信息（M 纠错级，掩码 0 → 格式字 = 0b100010100110）
  writeFormatInfo(m, 0b100010100110);

  return m;
}

function setIfNull(m: Matrix, r: number, c: number, v: boolean) {
  if (m[r][c] === null) m[r][c] = v;
}

function applyMask(m: Matrix, pattern: number) {
  for (let r = 0; r < 25; r++) {
    for (let c = 0; c < 25; c++) {
      if (m[r][c] === null) continue;
      // 跳过功能区（finder / separator / timing / alignment / format）
      // 只翻转数据模块（即之前通过 dataBits 填充的格子）
      // 简单判断：已有固定图案的格子在 buildModuleMatrix 中先设置，之后被 dataBits 覆盖的为数据
      // 这里用保守策略：只翻转非 null 且不属于功能区的格子
      if (isData(r, c) && m[r][c] !== null) {
        let flip = false;
        if (pattern === 0) flip = (r + c) % 2 === 0;
        if (flip) m[r][c] = !m[r][c];
      }
    }
  }
}

function isData(r: number, c: number): boolean {
  // 查找图案区域（含分隔符）
  if (r < 9 && c < 9) return false;
  if (r < 9 && c > 15) return false;
  if (r > 15 && c < 9) return false;
  // 时序行列
  if (r === 6 || c === 6) return false;
  // 对齐图案
  if (r >= 16 && r <= 20 && c >= 16 && c <= 20) return false;
  // 格式信息行/列
  if (r === 8 && (c <= 8 || c >= 17)) return false;
  if (c === 8 && (r <= 8 || r >= 17)) return false;
  return true;
}

// 格式信息写入（15 bit，双轨）
function writeFormatInfo(m: Matrix, fmt: number) {
  // 水平轨（行 8）
  const hCols = [0,1,2,3,4,5,7,8,17,18,19,20,21,22,23,24];
  // 垂直轨（列 8）
  const vRows = [0,1,2,3,4,5,7,8,17,18,19,20,21,22,23,24];
  for (let i = 0; i < 15; i++) {
    const bit = !!(fmt & (1 << (14 - i)));
    if (i < 8) {
      m[8][hCols[i]] = bit;
      m[vRows[14 - i]][8] = bit;
    } else {
      m[8][hCols[i]] = bit;
      m[vRows[14 - i]][8] = bit;
    }
  }
  m[17][8] = true; // 暗模块不变
}

// ─── 公开 API：将文本编码为 25×25 布尔矩阵 ───────────────────────────────────

export function encodeQR(text: string): boolean[][] {
  // 限制到 25 个字母数字字符
  const safe = text.toUpperCase().replace(/[^0-9A-Z $%*+\-./:]/g, '').slice(0, 25);
  const dataBits = alphanumEncode(safe);

  // 数据码字
  const dataBytes: number[] = [];
  for (let i = 0; i < dataBits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | (dataBits[i + b] ? 1 : 0);
    dataBytes.push(byte);
  }

  // 纠错码字
  const eccBytes = calcECC(dataBytes);

  // 合并成位流
  const allBits: boolean[] = [];
  for (const byte of [...dataBytes, ...eccBytes]) {
    for (let b = 7; b >= 0; b--) allBits.push(!!(byte & (1 << b)));
  }

  const matrix = buildModuleMatrix(allBits);
  return matrix.map(row => row.map(cell => cell ?? false));
}

// ─── Canvas 渲染 ──────────────────────────────────────────────────────────────

interface QRCanvasProps {
  text: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
}

export const QRCanvas: React.FC<QRCanvasProps> = ({
  text,
  size = 200,
  fgColor = '#0d1117',
  bgColor = '#ffffff',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const matrix = encodeQR(text);
    const n = matrix.length; // 25
    const cellSize = size / n;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = fgColor;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          ctx.fillRect(
            Math.round(c * cellSize),
            Math.round(r * cellSize),
            Math.ceil(cellSize),
            Math.ceil(cellSize),
          );
        }
      }
    }
  }, [text, size, fgColor, bgColor]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated', display: 'block' }}
    />
  );
};

// ─── 名片组件 ─────────────────────────────────────────────────────────────────

interface BusinessCardProps {
  handle: string;
  displayName: string;
  bio?: string;
  avatar?: string;
  hubUrl?: string;
}

export const BusinessCard: React.FC<BusinessCardProps> = ({
  handle,
  displayName,
  bio,
  avatar,
  hubUrl,
}) => {
  const [copied, setCopied] = useState(false);

  // 名片二维码编码内容（profile URL 或 handle）
  const profileUrl = hubUrl
    ? `${hubUrl}/@${handle}`.toUpperCase()
    : `JACKCLAW/@${handle}`.toUpperCase();

  // Canvas 引用用于下载
  const cardRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);

  function handleDownload() {
    // 创建离屏 canvas 合并名片
    const W = 400, H = 220;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    // 背景
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, W, H);

    // 边框
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // QR 区（右侧）
    const qrCanvas = qrRef.current;
    if (qrCanvas) {
      ctx.drawImage(qrCanvas, W - 190, 10, 180, 180);
    }

    // 橙色竖线
    ctx.fillStyle = '#f97316';
    ctx.fillRect(10, 10, 3, 160);

    // 显示名
    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(displayName.slice(0, 20), 24, 50);

    // Handle
    ctx.fillStyle = '#8b949e';
    ctx.font = '14px monospace';
    ctx.fillText(`@${handle}`, 24, 75);

    // Bio
    if (bio) {
      ctx.fillStyle = '#8b949e';
      ctx.font = '12px system-ui, sans-serif';
      const words = bio.slice(0, 80).split(' ');
      let line = '';
      let y = 105;
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > 180) {
          ctx.fillText(line, 24, y);
          line = word;
          y += 18;
          if (y > 165) break;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, 24, y);
    }

    // Badge
    ctx.fillStyle = '#f97316';
    ctx.font = 'bold 10px system-ui';
    ctx.fillText('JackClaw Member', 24, 195);

    // 触发下载
    const link = document.createElement('a');
    link.download = `jackclaw-${handle}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  function handleShare() {
    const url = hubUrl ? `${hubUrl}/@${handle}` : `https://jackclaw.app/@${handle}`;
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      {/* 名片主体 */}
      <div
        ref={cardRef}
        style={{
          width: 400,
          height: 220,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          position: 'relative',
        }}
      >
        {/* 橙色竖线 */}
        <div style={{
          width: 3,
          alignSelf: 'stretch',
          background: '#f97316',
          margin: '10px 0',
          marginLeft: 10,
          borderRadius: 2,
        }} />

        {/* 信息区 */}
        <div style={{ flex: 1, padding: '20px 16px', minWidth: 0 }}>
          {/* 头像 + 名字 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            {avatar ? (
              <img
                src={avatar}
                alt={displayName}
                style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid #30363d' }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: '#f97316', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 18,
                flexShrink: 0,
              }}>
                {displayName.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#e6edf3', fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {displayName}
              </div>
              <div style={{ color: '#8b949e', fontSize: 13, fontFamily: 'monospace' }}>
                @{handle}
              </div>
            </div>
          </div>

          {bio && (
            <div style={{
              color: '#8b949e', fontSize: 12, lineHeight: 1.5,
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
              overflow: 'hidden', marginBottom: 8,
            }}>
              {bio}
            </div>
          )}

          <div style={{
            display: 'inline-block',
            background: '#f97316',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 4,
            letterSpacing: '0.05em',
          }}>
            JackClaw Member
          </div>
        </div>

        {/* QR 区 */}
        <div style={{
          padding: 10,
          background: '#fff',
          margin: 10,
          borderRadius: 8,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <QRCanvas
            text={profileUrl}
            size={160}
            fgColor="#0d1117"
            bgColor="#ffffff"
            // 通过 ref 引用内部 canvas
          />
          {/* 隐藏的 canvas 引用供下载使用 */}
          <canvas ref={qrRef} style={{ display: 'none' }} />
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={handleDownload}
          style={{
            background: '#21262d',
            border: '1px solid #30363d',
            color: '#e6edf3',
            padding: '8px 18px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          ↓ 下载名片
        </button>
        <button
          onClick={handleShare}
          style={{
            background: copied ? '#238636' : '#f97316',
            border: 'none',
            color: '#fff',
            padding: '8px 18px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            transition: 'background 0.2s',
          }}
        >
          {copied ? '✓ 已复制链接' : '⬡ 分享链接'}
        </button>
      </div>
    </div>
  );
};
