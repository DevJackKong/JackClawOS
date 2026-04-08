const http = require('http');
const https = require('https');
const fs = require('fs');

const APP_ID = 'cli_a9493f1e31395ccd';
const APP_SECRET = '5LE4rJODeHJDBqsHOx8zndjZnv7QHHRQ';
const CHAT_ID = 'oc_7c4e6adc8b06f74780c3652709920135';
const LOG = '/tmp/inbox-bridge.log';

let tenantToken = '';
let tokenExpiry = 0;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG, line);
  process.stdout.write(line);
}

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function getTenantToken() {
  if (tenantToken && Date.now() < tokenExpiry) return tenantToken;
  try {
    const res = await httpsPost('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      app_id: APP_ID,
      app_secret: APP_SECRET,
    });
    tenantToken = res.tenant_access_token;
    tokenExpiry = Date.now() + (res.expire - 60) * 1000;
    log(`Got tenant token, expires in ${res.expire}s`);
    return tenantToken;
  } catch (e) {
    log(`Token error: ${e.message}`);
    return '';
  }
}

async function sendFeishuMsg(text) {
  const token = await getTenantToken();
  if (!token) { log('No token, skip'); return; }
  try {
    const res = await httpsPost(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      {
        receive_id: CHAT_ID,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
      { Authorization: `Bearer ${token}` }
    );
    log(`Feishu: code=${res.code} msg=${res.msg}`);
  } catch (e) {
    log(`Feishu error: ${e.message}`);
  }
}

http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        if (data.event === 'message' && !data.data?.test) {
          const from = data.data?.fromAgent || '?';
          const content = String(data.data?.content || '').slice(0, 500);
          log(`New: ${from} -> ${content.slice(0, 80)}`);
          await sendFeishuMsg(`📨 JackClaw 新消息\n来自: ${from}\n内容: ${content}`);
        }
        if (data.event === 'contact_request') {
          const from = data.data?.fromAgent || '?';
          const msg = data.data?.message || '';
          log(`Contact req: ${from}`);
          await sendFeishuMsg(`🤝 JackClaw 联系请求\n来自: ${from}\n留言: ${msg}`);
        }
      } catch (e) { log(`Error: ${e.message}`); }
      res.writeHead(200);
      res.end('ok');
    });
  } else {
    res.writeHead(200);
    res.end('ok');
  }
}).listen(19876, () => log('Feishu bridge listening on :19876'));
