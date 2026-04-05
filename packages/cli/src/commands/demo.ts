/**
 * jackclaw demo
 *
 * One-command showcase: starts Hub + 3 Nodes, runs a simulated work day.
 * Shows registration, task dispatch, reporting, and collaboration.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import net from 'net';

const DEMO_HUB_PORT = 3100;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function request(method: string, urlPath: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, `http://localhost:${DEMO_HUB_PORT}`);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method, headers, timeout: 5000 };
    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode!, body: d }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => { s.close(); resolve(false); });
    s.listen(port, '127.0.0.1');
  });
}

function log(emoji: string, msg: string) {
  console.log(`  ${emoji}  ${msg}`);
}

export function registerDemo(program: Command): void {
  program
    .command('demo')
    .description('Run a live demo: Hub + 3 AI employees collaborate')
    .option('--team', 'Run team mode: AI executives discuss strategy with Human-in-Loop approval')
    .action(async (opts: { team?: boolean }) => {
      if (opts.team) {
        await runTeamDemo();
        return;
      }
      console.log(chalk.bold(`
╔═══════════════════════════════════════════════════╗
║  🦞  JackClaw Demo — Your AI Company in Action   ║
╚═══════════════════════════════════════════════════╝
`));

      // Check port
      if (await isPortInUse(DEMO_HUB_PORT)) {
        console.log(chalk.red(`  Port ${DEMO_HUB_PORT} is in use. Stop existing Hub first.`));
        process.exit(1);
      }

      // Start Hub
      log('🏢', chalk.blue('Starting Hub (HQ)...'));
      const hubScript = require.resolve('@jackclaw/hub');
      const hubProc = spawn('node', [hubScript], {
        env: { ...process.env, HUB_PORT: String(DEMO_HUB_PORT) },
        stdio: 'pipe',
      });
      const procs: ChildProcess[] = [hubProc];

      // Wait for Hub
      for (let i = 0; i < 30; i++) {
        await sleep(300);
        try {
          const r = await request('GET', '/health');
          if (r.status === 200) break;
        } catch {}
      }
      log('✅', chalk.green(`Hub ready — http://localhost:${DEMO_HUB_PORT}`));

      // ── Act 1: CEO Registration ───────────────────────────────────
      console.log(chalk.bold('\n📋 Act 1: CEO Takes the Stage'));
      await sleep(500);

      const ceo = await request('POST', '/api/register', {
        nodeId: 'ceo-jack',
        name: '🧑‍💼 CEO Jack',
        role: 'ceo',
        publicKey: 'demo-key-ceo',
      });
      log('👔', `CEO registered — token received`);
      const ceoToken = ceo.body?.token;

      // ── Act 2: Employees Report for Duty ──────────────────────────
      console.log(chalk.bold('\n👥 Act 2: Employees Report for Duty'));
      await sleep(500);

      const employees = [
        { id: 'alice', name: '👩‍💻 Engineer Alice', role: 'engineer' },
        { id: 'bob', name: '🎨 Designer Bob', role: 'designer' },
        { id: 'carol', name: '📊 Analyst Carol', role: 'analyst' },
      ];

      const tokens: Record<string, string> = {};
      for (const emp of employees) {
        const r = await request('POST', '/api/register', {
          nodeId: emp.id,
          name: emp.name,
          role: emp.role,
          publicKey: `demo-key-${emp.id}`,
        });
        tokens[emp.id] = r.body?.token;
        log('🤝', `${emp.name} joined the team`);
        await sleep(300);
      }

      // ── Act 3: Team Status ────────────────────────────────────────
      console.log(chalk.bold('\n📡 Act 3: CEO Checks the Team'));
      await sleep(500);

      const nodesRes = await request('GET', '/api/nodes', null, ceoToken);
      const nodes = nodesRes.body?.nodes || [];
      log('📊', `${nodes.length} nodes online:`);
      for (const n of nodes) {
        const icon = n.role === 'ceo' ? '👔' : n.role === 'engineer' ? '💻' : n.role === 'designer' ? '🎨' : '📊';
        console.log(`       ${icon} ${n.name} (${n.role})`);
      }

      // ── Act 4: Daily Reports ──────────────────────────────────────
      console.log(chalk.bold('\n📝 Act 4: Daily Reports'));
      await sleep(500);

      const reports = [
        { from: 'alice', summary: 'Completed login page (3h). Auth API 50% done. No blockers.' },
        { from: 'bob', summary: 'Designed dashboard mockup (2h). Waiting for Alice\'s API.' },
        { from: 'carol', summary: 'Analyzed user metrics. Conversion up 15%. Report attached.' },
      ];

      for (const r of reports) {
        await request('POST', '/api/reports', {
          summary: r.summary,
          period: 'daily',
          visibility: 'ceo',
        }, tokens[r.from]);
        const emp = employees.find(e => e.id === r.from)!;
        log('📄', `${emp.name}: "${r.summary.slice(0, 60)}..."`);
        await sleep(400);
      }

      // ── Act 5: Team Chat ──────────────────────────────────────────
      console.log(chalk.bold('\n💬 Act 5: Team Chat'));
      await sleep(500);

      const messages = [
        { from: 'alice', to: 'bob', content: 'Hey Bob, the login API is ready. You can connect the UI now.' },
        { from: 'bob', to: 'alice', content: 'Great! I\'ll start integrating tomorrow morning.' },
        { from: 'carol', to: 'ceo-jack', content: 'CEO, the Q1 report is ready. Should I share with the team?' },
      ];

      for (const m of messages) {
        await request('POST', '/api/chat/send', {
          id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          from: m.from,
          to: m.to,
          content: m.content,
          type: 'human',
          ts: Date.now(),
          signature: '',
          encrypted: false,
        }, tokens[m.from] || ceoToken);
        const fromName = m.from === 'ceo-jack' ? '👔 CEO' : employees.find(e => e.id === m.from)?.name || m.from;
        const toName = m.to === 'ceo-jack' ? '👔 CEO' : employees.find(e => e.id === m.to)?.name || m.to;
        log('💬', `${fromName} → ${toName}: "${m.content.slice(0, 55)}..."`);
        await sleep(300);
      }

      // ── Act 6: Daily Summary ──────────────────────────────────────
      console.log(chalk.bold('\n📋 Act 6: CEO Reviews Daily Summary'));
      await sleep(500);

      const today = new Date().toISOString().slice(0, 10);
      const summary = await request('GET', `/api/summary?date=${today}`, null, ceoToken);
      log('📊', `Date: ${summary.body?.date}`);
      log('📊', `Reporting: ${summary.body?.reportingNodes}/${summary.body?.totalNodes} nodes`);

      const byRole = summary.body?.byRole || {};
      for (const [role, data] of Object.entries(byRole) as [string, any][]) {
        for (const node of data.nodes || []) {
          console.log(`       [${role}] ${node.name}: ${node.summary?.slice(0, 50)}...`);
        }
      }

      // ── Finale ────────────────────────────────────────────────────
      console.log(chalk.bold(`
╔═══════════════════════════════════════════════════╗
║  ✅ Demo Complete!                                ║
║                                                   ║
║  Your AI company just ran a full work day:        ║
║  • 1 CEO + 3 AI employees registered              ║
║  • 3 daily reports submitted                      ║
║  • 3 cross-team messages exchanged                ║
║  • Daily summary aggregated by role               ║
║                                                   ║
║  👉 Try it yourself:                              ║
║     npx jackclaw start                            ║
║     npx jackclaw chat --to alice                  ║
║                                                   ║
║  📖 Full guide: QUICKSTART.md                     ║
║  🦞 https://github.com/DevJackKong/JackClawOS    ║
╚═══════════════════════════════════════════════════╝
`));

      // Cleanup
      hubProc.kill('SIGTERM');
      setTimeout(() => process.exit(0), 500);
    });
}

// ── Team Demo ─────────────────────────────────────────────────────────────────

async function runTeamDemo(): Promise<void> {
  console.log(chalk.bold(`
╔═══════════════════════════════════════════════════╗
║  🦞  JackClaw Team Mode — AI Executive Board      ║
║      CEO × CTO × CMO × CDO Strategy Session      ║
╚═══════════════════════════════════════════════════╝
`));

  // Check port
  if (await isPortInUse(DEMO_HUB_PORT)) {
    console.log(chalk.red(`  Port ${DEMO_HUB_PORT} is in use. Stop existing Hub first.`));
    process.exit(1);
  }

  // ── Start Hub ──────────────────────────────────────────────────────────────
  log('🏢', chalk.blue('Starting Hub (HQ)...'));
  const hubScript = require.resolve('@jackclaw/hub');
  const hubProc = spawn('node', [hubScript], {
    env: { ...process.env, HUB_PORT: String(DEMO_HUB_PORT) },
    stdio: 'pipe',
  });

  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      const r = await request('GET', '/health');
      if (r.status === 200) break;
    } catch {}
  }
  log('✅', chalk.green(`Hub ready — http://localhost:${DEMO_HUB_PORT}`));
  await sleep(800);

  // ── Register CEO ───────────────────────────────────────────────────────────
  console.log(chalk.bold('\n👔 Step 1: CEO 入场'));
  await sleep(500);

  const ceoRes = await request('POST', '/api/register', {
    nodeId: 'ceo',
    name: '👑 CEO',
    role: 'ceo',
    publicKey: 'demo-key-ceo',
  });
  const ceoToken = ceoRes.body?.token;
  log('✅', chalk.cyan('CEO 已上线'));
  await sleep(2000);

  // ── Register AI Executive Nodes ────────────────────────────────────────────
  console.log(chalk.bold('\n🤖 Step 2: AI 高管团队就位'));
  await sleep(500);

  const executives = [
    { id: 'cto', handle: '@cto', name: '🔧 CTO', role: 'cto', desc: '技术总监，负责架构决策' },
    { id: 'cmo', handle: '@cmo', name: '📣 CMO', role: 'cmo', desc: '市场总监，负责增长策略' },
    { id: 'cdo', handle: '@cdo', name: '📊 CDO', role: 'cdo', desc: '数据总监，负责数据洞察' },
  ];

  const execTokens: Record<string, string> = {};
  for (const exec of executives) {
    const r = await request('POST', '/api/register', {
      nodeId: exec.id,
      name: exec.name,
      role: exec.role,
      publicKey: `demo-key-${exec.id}`,
    });
    execTokens[exec.id] = r.body?.token;
    log('🤝', `${exec.handle} ${chalk.yellow(exec.name)} — ${exec.desc}`);
    await sleep(600);
  }
  await sleep(2000);

  // ── CEO Publishes Task ─────────────────────────────────────────────────────
  console.log(chalk.bold('\n📋 Step 3: CEO 发布战略议题'));
  await sleep(500);

  const task = '分析 JackClaw 的市场定位策略：我们面向哪些客户？核心差异化优势是什么？如何打入企业市场？';
  console.log(chalk.bgBlue.white('\n  👑 CEO 发言：'));
  console.log(chalk.blue(`  "${task}"\n`));
  await sleep(2000);

  // ── CTO Reply ─────────────────────────────────────────────────────────────
  console.log(chalk.bold('\n💬 Step 4: 高管团队回应'));
  await sleep(800);

  await request('POST', '/api/chat/send', {
    id: `team-cto-${Date.now()}`,
    from: 'cto',
    to: 'broadcast',
    content: '从技术视角：JackClaw 核心壁垒在于 Hub-Node 分布式架构，支持本地部署 + 云端混合。建议主打 "AI企业操作系统" 定位，目标客户为 50-500 人规模的科技公司。差异化：数据不出境、可审计的 Human-in-Loop 决策链。',
    type: 'ai',
    ts: Date.now(),
    signature: '',
    encrypted: false,
  }, execTokens['cto']);

  console.log(chalk.bgGreen.black('\n  🔧 CTO (@cto) 回复 — 技术视角：'));
  console.log(chalk.green('  核心壁垒：Hub-Node 分布式架构，支持本地部署 + 云端混合'));
  console.log(chalk.green('  目标客户：50-500 人规模科技公司'));
  console.log(chalk.green('  差异化：数据不出境 + 可审计的 Human-in-Loop 决策链\n'));
  await sleep(2000);

  // ── CMO Reply ─────────────────────────────────────────────────────────────
  await request('POST', '/api/chat/send', {
    id: `team-cmo-${Date.now()}`,
    from: 'cmo',
    to: 'broadcast',
    content: '从市场视角：当前 AI Agent 赛道拥挤，但企业级编排层稀缺。建议 PLG 策略：开源核心 + 企业版 SaaS。重点攻克 HR、法务、运营三个场景，年内目标 100 家付费企业客户。内容营销聚焦 "AI 员工管理" 话题，制造行业热词。',
    type: 'ai',
    ts: Date.now(),
    signature: '',
    encrypted: false,
  }, execTokens['cmo']);

  console.log(chalk.bgMagenta.white('\n  📣 CMO (@cmo) 回复 — 市场视角：'));
  console.log(chalk.magenta('  策略：PLG 开源核心 + 企业版 SaaS'));
  console.log(chalk.magenta('  重点场景：HR、法务、运营三大场景切入'));
  console.log(chalk.magenta('  年内目标：100 家付费企业客户\n'));
  await sleep(2000);

  // ── CDO Reply ─────────────────────────────────────────────────────────────
  await request('POST', '/api/chat/send', {
    id: `team-cdo-${Date.now()}`,
    from: 'cdo',
    to: 'broadcast',
    content: '从数据视角：根据市场调研，企业 AI 采购决策中 67% 卡在数据安全合规。JackClaw 本地化部署方案直接解决此痛点。建议建立 AI ROI 计算器：展示每个 Node 节省的人力成本，预计客户年均节省 ¥200k+，投资回报率 340%。',
    type: 'ai',
    ts: Date.now(),
    signature: '',
    encrypted: false,
  }, execTokens['cdo']);

  console.log(chalk.bgYellow.black('\n  📊 CDO (@cdo) 回复 — 数据洞察：'));
  console.log(chalk.yellow('  关键数据：67% 企业 AI 采购卡在数据安全合规'));
  console.log(chalk.yellow('  本地化方案直接解决核心痛点'));
  console.log(chalk.yellow('  客户年均节省 ¥200k+，投资回报率 340%\n'));
  await sleep(2000);

  // ── Human-in-Loop Approval ─────────────────────────────────────────────────
  console.log(chalk.bold('\n🔔 Step 5: Human-in-Loop 审批请求'));
  await sleep(800);

  console.log(chalk.bgRed.white('\n  ⚠️  系统触发审批流程：\n'));
  console.log(chalk.red('  ┌─────────────────────────────────────────────┐'));
  console.log(chalk.red('  │  📢 审批请求                                │'));
  console.log(chalk.red('  │                                             │'));
  console.log(chalk.red('  │  CMO 申请将以下内容发布到社交媒体：          │'));
  console.log(chalk.red('  │                                             │'));
  console.log(chalk.red('  │  "JackClaw — 首个为中小企业打造的            │'));
  console.log(chalk.red('  │   AI员工操作系统。开源、安全、可审计。         │'));
  console.log(chalk.red('  │   限时免费 Beta 申请 👉 jackclaw.ai"        │'));
  console.log(chalk.red('  │                                             │'));
  console.log(chalk.red('  │  需要 CEO 批准才能执行                       │'));
  console.log(chalk.red('  └─────────────────────────────────────────────┘'));
  console.log();
  await sleep(2000);

  // ── CEO Approves ───────────────────────────────────────────────────────────
  console.log(chalk.bold('\n✅ Step 6: CEO 批准发布'));
  await sleep(800);

  await request('POST', '/api/chat/send', {
    id: `team-ceo-approve-${Date.now()}`,
    from: 'ceo',
    to: 'cmo',
    content: '批准。内容很好，加上 #AI创业 #企业智能化 标签。今天下午 3 点发布，同步到微博、推特、LinkedIn。',
    type: 'human',
    ts: Date.now(),
    signature: '',
    encrypted: false,
  }, ceoToken);

  console.log(chalk.bgCyan.black('\n  👑 CEO 批准：'));
  console.log(chalk.cyan('  ✅ 内容已批准'));
  console.log(chalk.cyan('  📅 发布时间：今天下午 3:00'));
  console.log(chalk.cyan('  📡 渠道：微博 + 推特 + LinkedIn\n'));
  await sleep(2000);

  // ── Generate Team Daily Report ─────────────────────────────────────────────
  console.log(chalk.bold('\n📋 Step 7: 生成团队战略日报'));
  await sleep(800);

  // Submit reports for each executive
  const execReports = [
    {
      id: 'cto',
      summary: '完成市场定位技术分析。推荐架构：Hub-Node 混合云方案。下周输出企业版技术白皮书。',
    },
    {
      id: 'cmo',
      summary: '制定 PLG 增长策略。目标 Q2 获取 30 家试点客户。内容日历已排期，社媒发布已获 CEO 批准。',
    },
    {
      id: 'cdo',
      summary: '完成竞品数据分析报告。建立 ROI 计算模型。建议优先攻克法律、HR 两个场景，数据最充分。',
    },
  ];

  for (const rep of execReports) {
    await request('POST', '/api/reports', {
      summary: rep.summary,
      period: 'daily',
      visibility: 'ceo',
    }, execTokens[rep.id]);
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(chalk.bold(`\n  📊 JackClaw 高管团队战略日报 — ${today}\n`));
  console.log(chalk.white('  ─────────────────────────────────────────────────────'));
  console.log(chalk.green('  🔧 CTO 产出：技术定位分析 + 企业版架构方案'));
  console.log(chalk.green('       → 下周交付：技术白皮书 v1.0'));
  console.log();
  console.log(chalk.magenta('  📣 CMO 产出：PLG 增长策略 + Q2 客户获取计划'));
  console.log(chalk.magenta('       → 社媒发布已获批，今日 15:00 上线'));
  console.log();
  console.log(chalk.yellow('  📊 CDO 产出：竞品数据分析 + ROI 计算模型'));
  console.log(chalk.yellow('       → 优先场景：法律 & HR（数据最充分）'));
  console.log(chalk.white('  ─────────────────────────────────────────────────────'));
  console.log(chalk.bold('\n  🎯 本次战略共识：'));
  console.log('     • 定位：AI 企业操作系统（本地优先 + 数据安全）');
  console.log('     • 客群：50-500 人科技/专业服务公司');
  console.log('     • 切入：法律、HR、运营三大场景');
  console.log('     • 目标：Q2 获取 100 家付费客户');
  console.log();
  await sleep(2000);

  // ── Finale ─────────────────────────────────────────────────────────────────
  console.log(chalk.bold(`
╔═══════════════════════════════════════════════════╗
║  ✅ Team Demo 完成！                              ║
║                                                   ║
║  你的 AI 高管团队刚刚完成了：                      ║
║  • 3 位 AI 高管（@cto @cmo @cdo）上线              ║
║  • 一次完整的战略讨论（技术/市场/数据视角）          ║
║  • Human-in-Loop 审批流程（CEO 亲自批准）           ║
║  • 团队战略日报生成                                ║
║                                                   ║
║  👉 Dashboard:                                    ║
║     http://localhost:${DEMO_HUB_PORT}/dashboard          ║
║                                                   ║
║  👉 下一步：                                      ║
║     npx jackclaw start                            ║
║     npx jackclaw hub-status                       ║
║                                                   ║
║  🦞 https://github.com/DevJackKong/JackClawOS    ║
╚═══════════════════════════════════════════════════╝
`));

  hubProc.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500);
}
