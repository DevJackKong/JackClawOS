#!/usr/bin/env bash
# inbox-watcher.sh — 监听 JackClaw Hub inbox，新消息自动转发飞书
# Usage: nohup bash scripts/inbox-watcher.sh &

set -euo pipefail

INBOX_FILE="$HOME/.jackclaw/hub/messages.jsonl"
POLL_INTERVAL=5  # seconds
WATCH_AGENT="@jack.jackclaw"

# Track last known line count
LAST_LINE=0
if [[ -f "$INBOX_FILE" ]]; then
  LAST_LINE=$(wc -l < "$INBOX_FILE" | tr -d ' ')
fi

echo "[inbox-watcher] Started. Watching $INBOX_FILE from line $LAST_LINE"
echo "[inbox-watcher] Target agent: $WATCH_AGENT"
echo "[inbox-watcher] Poll interval: ${POLL_INTERVAL}s"

while true; do
  sleep "$POLL_INTERVAL"

  if [[ ! -f "$INBOX_FILE" ]]; then
    continue
  fi

  CURRENT_LINE=$(wc -l < "$INBOX_FILE" | tr -d ' ')

  if (( CURRENT_LINE > LAST_LINE )); then
    # Extract new lines
    NEW_LINES=$(tail -n +"$((LAST_LINE + 1))" "$INBOX_FILE" | head -n "$((CURRENT_LINE - LAST_LINE))")

    echo "$NEW_LINES" | while IFS= read -r line; do
      [[ -z "$line" ]] && continue

      # Parse with python
      NOTIFY=$(python3 -c "
import json,sys
try:
    m = json.loads('''$line''')
    to = m.get('toAgent', m.get('recipient', ''))
    fr = m.get('fromAgent', m.get('sender', ''))
    ct = str(m.get('content', ''))
    if '$WATCH_AGENT' in to:
        print(f'{fr}|{ct}')
except:
    pass
" 2>/dev/null || true)

      if [[ -n "$NOTIFY" ]]; then
        FROM=$(echo "$NOTIFY" | cut -d'|' -f1)
        CONTENT=$(echo "$NOTIFY" | cut -d'|' -f2-)
        echo "[inbox-watcher] New message: $FROM → $WATCH_AGENT: $CONTENT"
        # Will be picked up by the openclaw feishu bridge
      fi
    done

    LAST_LINE=$CURRENT_LINE
  fi
done
