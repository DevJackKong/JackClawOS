// EmojiPicker — 常用 emoji 分类面板

import React from 'react';

interface Props {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: '常用',
    emojis: ['😀', '😂', '🤣', '😊', '😍', '🥰', '😎', '🤔', '😅', '😭', '😤', '😡', '🥳', '🤩', '😴'],
  },
  {
    label: '手势',
    emojis: ['👍', '👎', '👋', '🙏', '👏', '🤝', '💪', '🤞', '✌️', '🤙', '👌', '🤌', '🖐️', '☝️', '🤜'],
  },
  {
    label: '活动',
    emojis: ['🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '⭐', '🌟', '💡', '🔥', '✅', '❌', '⚡', '💯', '🚀'],
  },
  {
    label: '自然',
    emojis: ['🌸', '🌺', '🌻', '🌹', '🍀', '🌈', '☀️', '🌙', '⭐', '❄️', '🌊', '🔥', '🌿', '🍁', '🌴'],
  },
  {
    label: '食物',
    emojis: ['🍎', '🍊', '🍋', '🍇', '🍓', '🍕', '🍔', '🌮', '🍜', '🍱', '🍣', '🍦', '☕', '🧋', '🎂'],
  },
];

export const EmojiPicker: React.FC<Props> = ({ onSelect, onClose }) => {
  return (
    <div className="emoji-overlay" onClick={onClose}>
      <div className="emoji-picker" onClick={e => e.stopPropagation()}>
        <div className="emoji-header">
          <span className="emoji-title">表情</span>
          <button className="emoji-close" onClick={onClose}>✕</button>
        </div>
        {EMOJI_CATEGORIES.map(cat => (
          <div key={cat.label} className="emoji-category">
            <div className="emoji-cat-label">{cat.label}</div>
            <div className="emoji-grid">
              {cat.emojis.map(em => (
                <button
                  key={em}
                  className="emoji-btn"
                  onClick={() => onSelect(em)}
                  title={em}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
