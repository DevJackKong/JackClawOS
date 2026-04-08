#!/bin/bash
# inbox-push.sh — 检查 JackClaw inbox 新消息，通过 OpenClaw gateway 推送飞书
INBOX="$HOME/.jackclaw/hub/messages.jsonl"
STATE="/tmp/inbox-push-lastline"
WATCH="@jack.jackclaw"

# 初始化
[[ ! -f "$STATE" ]] && wc -l < "$INBOX" | tr -d ' ' > "$STATE"

LAST=$(cat "$STATE")
CURRENT=$(wc -l < "$INBOX" | tr -d ' ')

if (( CURRENT > LAST )); then
  # 提取新行并筛选
  MSGS=$(tail -n +"$((LAST + 1))" "$INBOX" | python3 -c "
import sys, json
results = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        m = json.loads(line)
        to = m.get('toAgent', m.get('recipient', ''))
        fr = m.get('fromAgent', m.get('sender', ''))
        ct = str(m.get('content', ''))
        if '$WATCH' in to and fr != '$WATCH':
            results.append(f'{fr}: {ct}')
    except:
        pass
if results:
    print('\n'.join(results))
" 2>/dev/null)

  if [[ -n "$MSGS" ]]; then
    # 写到临时文件让 openclaw 读取
    echo "$MSGS" > /tmp/inbox-new-msgs.txt
  fi
  echo "$CURRENT" > "$STATE"
fi
