#!/usr/bin/env node
/**
 * inbox-multi-bridge.js — JackClaw Hub → 多渠道消息推送
 * 
 * 支持渠道: 飞书 / Telegram / WeChat / WhatsApp
 * 
 * Hub 收到新消息 → webhook POST → 本脚本 → 推送到所有已配置渠道
 * 
 * 配置: ~/.jackclaw/hub/push-channels.json
 * 
 * Usage: node scripts/inbox-multi-bridge.js
 *   或:  nohup node scripts/inbox-multi-bridge.js &
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Config ───

const CONFIG_FILE = path.join(process.env.HOME || '~', '.jackclaw/hub/push-channels.json');
const LOG_FILE = '/tmp/inbox-bridge.log';
const PORT = 19876;

// Default config (will be created if not exists)
const DEFAULT_CONFIG = {
  feishu: {
    enabled: true,
    appId: 'cli_a9493f1e31395ccd',
    appSecret: '5LE4rJODeHJDBqsHOx8zndjZnv7QHHRQ',
    chatId: 'oc_7c4e6adc8b06f74780c3652709920135',
  },
  telegram: {
    enabled: true,
    botToken: '8770001826:AAFIcJR0ESjdKtLXj_Ds7L09oeEs4y2HCws',
    chatId: '8116734311',
  },
  wechat: {
    enabled: false,
    webhookUrl: '',  // 企业微信群机器人 webhook URL
    // 或者用公众号/小程序推送:
    appId: '',
    appSecret: '',
    templateId: '',
    openId: '',
  },
  whatsapp: {
    enabled: false,
    // Meta Cloud API
    phoneNumberId: '',
    accessToken: '',
    recipientPhone: '',  // 接收者手机号 (带国家代码，如 +8613800138000)
  },
};

// ─── Logging ───

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

// ─── Config Management ───

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) { log(`Config load error: ${e.message}`); }
  
  // Create default config
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  log(`Created default config at ${CONFIG_FILE}`);
  return DEFAULT_CONFIG;
}

let config = loadConfig();

// Watch config for changes
fs.watchFile(CONFIG_FILE, { interval: 5000 }, () => {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    log('Config reloaded');
  } catch {}
});

// ─── HTTP Helper ───

function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const proto = u.protocol === 'https:' ? https : http;
    const req = proto.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Feishu Push ───

let feishuToken = '';
let feishuTokenExpiry = 0;

async function getFeishuToken() {
  if (feishuToken && Date.now() < feishuTokenExpiry) return feishuToken;
  const cfg = config.feishu;
  if (!cfg?.appId || !cfg?.appSecret) return '';
  try {
    const res = await httpsPost('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      app_id: cfg.appId,
      app_secret: cfg.appSecret,
    });
    feishuToken = res.tenant_access_token;
    feishuTokenExpiry = Date.now() + (res.expire - 60) * 1000;
    return feishuToken;
  } catch (e) {
    log(`[feishu] Token error: ${e.message}`);
    return '';
  }
}

async function pushFeishu(text) {
  const cfg = config.feishu;
  if (!cfg?.enabled || !cfg?.chatId) return;
  const token = await getFeishuToken();
  if (!token) return;
  try {
    const res = await httpsPost(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      { receive_id: cfg.chatId, msg_type: 'text', content: JSON.stringify({ text }) },
      { Authorization: `Bearer ${token}` }
    );
    log(`[feishu] ${res.code === 0 ? '✅' : '❌'} code=${res.code}`);
  } catch (e) {
    log(`[feishu] ❌ ${e.message}`);
  }
}

// ─── Telegram Push ───

async function pushTelegram(text) {
  const cfg = config.telegram;
  if (!cfg?.enabled || !cfg?.botToken || !cfg?.chatId) return;
  try {
    const { execSync } = require('child_process');
    const payload = JSON.stringify({ chat_id: cfg.chatId, text, parse_mode: 'HTML' });
    const proxyArg = cfg.proxy ? `--proxy ${cfg.proxy}` : '';
    const cmd = `curl -s ${proxyArg} -X POST "https://api.telegram.org/bot${cfg.botToken}/sendMessage" -H "Content-Type: application/json" -d '${payload.replace(/'/g, "'\''")}'`;
    const result = execSync(cmd, { timeout: 15000, encoding: 'utf8' });
    const res = JSON.parse(result);
    log(`[telegram] ${res.ok ? '✅' : '❌'} ${res.description || ''}`);
  } catch (e) {
    log(`[telegram] ❌ ${e.message}`);
  }
}

// ─── WeChat Push ───

// 方式1: 企业微信群机器人 webhook
async function pushWechatWebhook(text) {
  const cfg = config.wechat;
  if (!cfg?.enabled || !cfg?.webhookUrl) return;
  try {
    const res = await httpsPost(cfg.webhookUrl, {
      msgtype: 'text',
      text: { content: text },
    });
    log(`[wechat-webhook] ${res.errcode === 0 ? '✅' : '❌'} ${res.errmsg || ''}`);
  } catch (e) {
    log(`[wechat-webhook] ❌ ${e.message}`);
  }
}

// 方式2: 微信公众号模板消息
let wechatToken = '';
let wechatTokenExpiry = 0;

async function getWechatToken() {
  if (wechatToken && Date.now() < wechatTokenExpiry) return wechatToken;
  const cfg = config.wechat;
  if (!cfg?.appId || !cfg?.appSecret) return '';
  try {
    const res = await httpsPost(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${cfg.appId}&secret=${cfg.appSecret}`,
      ''
    );
    wechatToken = res.access_token;
    wechatTokenExpiry = Date.now() + (res.expires_in - 60) * 1000;
    return wechatToken;
  } catch (e) {
    log(`[wechat] Token error: ${e.message}`);
    return '';
  }
}

async function pushWechatTemplate(from, content) {
  const cfg = config.wechat;
  if (!cfg?.enabled || !cfg?.templateId || !cfg?.openId) return;
  if (cfg.webhookUrl) return; // Use webhook mode instead
  const token = await getWechatToken();
  if (!token) return;
  try {
    const res = await httpsPost(
      `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${token}`,
      {
        touser: cfg.openId,
        template_id: cfg.templateId,
        data: {
          first: { value: '📨 JackClaw 新消息' },
          keyword1: { value: from },
          keyword2: { value: content.slice(0, 200) },
          keyword3: { value: new Date().toLocaleString('zh-CN') },
        },
      }
    );
    log(`[wechat-template] ${res.errcode === 0 ? '✅' : '❌'} ${res.errmsg || ''}`);
  } catch (e) {
    log(`[wechat-template] ❌ ${e.message}`);
  }
}

async function pushWechat(text, from, content) {
  const cfg = config.wechat;
  if (!cfg?.enabled) return;
  if (cfg.webhookUrl) {
    await pushWechatWebhook(text);
  } else {
    await pushWechatTemplate(from, content);
  }
}

// ─── WhatsApp Push (Meta Cloud API) ───

async function pushWhatsApp(text) {
  const cfg = config.whatsapp;
  if (!cfg?.enabled || !cfg?.phoneNumberId || !cfg?.accessToken || !cfg?.recipientPhone) return;
  try {
    const res = await httpsPost(
      `https://graph.facebook.com/v18.0/${cfg.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: cfg.recipientPhone,
        type: 'text',
        text: { body: text },
      },
      { Authorization: `Bearer ${cfg.accessToken}` }
    );
    log(`[whatsapp] ${res.messages ? '✅' : '❌'} ${JSON.stringify(res).slice(0, 100)}`);
  } catch (e) {
    log(`[whatsapp] ❌ ${e.message}`);
  }
}

// ─── Unified Push ───

async function pushAll(from, content) {
  const text = `📨 JackClaw 新消息\n来自: ${from}\n内容: ${content}`;
  const htmlText = `📨 <b>JackClaw 新消息</b>\n来自: <code>${from}</code>\n内容: ${content}`;
  
  const promises = [
    pushFeishu(text),
    pushTelegram(htmlText),
    pushWechat(text, from, content),
    pushWhatsApp(text),
  ];
  
  await Promise.allSettled(promises);
}

async function pushContactRequest(from, message) {
  const text = `🤝 JackClaw 联系请求\n来自: ${from}\n留言: ${message}`;
  const htmlText = `🤝 <b>JackClaw 联系请求</b>\n来自: <code>${from}</code>\n留言: ${message}`;
  
  await Promise.allSettled([
    pushFeishu(text),
    pushTelegram(htmlText),
    pushWechat(text, from, message),
    pushWhatsApp(text),
  ]);
}

// ─── Webhook Server ───

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
          log(`📨 ${from}: ${content.slice(0, 80)}`);
          await pushAll(from, content);
        }
        
        if (data.event === 'contact_request') {
          const from = data.data?.fromAgent || '?';
          const msg = String(data.data?.message || '');
          log(`🤝 ${from}: ${msg.slice(0, 80)}`);
          await pushContactRequest(from, msg);
        }
      } catch (e) {
        log(`Parse error: ${e.message}`);
      }
      res.writeHead(200);
      res.end('ok');
    });
  } else if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({
      status: 'ok',
      channels: {
        feishu: config.feishu?.enabled || false,
        telegram: config.telegram?.enabled || false,
        wechat: config.wechat?.enabled || false,
        whatsapp: config.whatsapp?.enabled || false,
      },
      uptime: process.uptime(),
    }));
  } else if (req.method === 'GET' && req.url === '/config') {
    // Return sanitized config (no secrets)
    const safe = {};
    for (const [k, v] of Object.entries(config)) {
      safe[k] = { enabled: v.enabled || false };
    }
    res.writeHead(200);
    res.end(JSON.stringify(safe));
  } else {
    res.writeHead(200);
    res.end('ok');
  }
}).listen(PORT, () => {
  log(`Multi-channel bridge listening on :${PORT}`);
  log(`Channels: feishu=${config.feishu?.enabled} telegram=${config.telegram?.enabled} wechat=${config.wechat?.enabled} whatsapp=${config.whatsapp?.enabled}`);
  log(`Config: ${CONFIG_FILE}`);
});
