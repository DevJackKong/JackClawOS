// ChatInput — 消息输入区：多行文本，Enter 发送，文件上传，表情，语音预留

import React, { useCallback, useRef } from 'react';

type MsgType = 'human' | 'task' | 'ask';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
  sending: boolean;
  msgType: MsgType;
  onMsgTypeChange: (t: MsgType) => void;
  onEmojiClick: () => void;
}

const MSG_TYPES: { id: MsgType; label: string }[] = [
  { id: 'human', label: 'Human' },
  { id: 'task',  label: 'Task'  },
  { id: 'ask',   label: 'Ask'   },
];

export const ChatInput: React.FC<Props> = ({
  value,
  onChange,
  onSend,
  disabled,
  sending,
  msgType,
  onMsgTypeChange,
  onEmojiClick,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Insert file reference as placeholder text
    onChange(value + `[file] ${file.name}`);
    e.target.value = '';
  }

  return (
    <div className="ci-wrap">
      {/* Message type selector */}
      <div className="ci-toolbar">
        <div className="ci-types">
          {MSG_TYPES.map(t => (
            <button
              key={t.id}
              className={`ci-type-btn ${msgType === t.id ? 'ci-type-active' : ''}`}
              onClick={() => onMsgTypeChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ci-actions">
          {/* File upload */}
          <button
            className="ci-action-btn"
            title="上传文件"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          {/* Emoji */}
          <button
            className="ci-action-btn"
            title="表情"
            onClick={onEmojiClick}
            disabled={disabled}
          >
            😊
          </button>
          {/* Voice — reserved */}
          <button
            className="ci-action-btn ci-btn-muted"
            title="语音消息（即将推出）"
            disabled
          >
            🎤
          </button>
        </div>
      </div>

      {/* Text area + send button row */}
      <div className="ci-input-row">
        <textarea
          className="ci-textarea"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled && !sending ? '请先选择节点' : '输入消息… (Enter 发送, Shift+Enter 换行)'}
          disabled={disabled}
          rows={3}
        />
        <button
          className={`ci-send-btn ${sending ? 'ci-send-loading' : ''}`}
          onClick={onSend}
          disabled={disabled || sending || !value.trim()}
          title="发送 (Enter)"
        >
          {sending ? '…' : '发送'}
        </button>
      </div>
    </div>
  );
};
