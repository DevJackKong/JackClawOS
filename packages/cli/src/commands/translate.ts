/**
 * jackclaw translate — AI 实时翻译命令
 *
 * jackclaw translate on           — 开启自动翻译
 * jackclaw translate off          — 关闭自动翻译
 * jackclaw translate lang <code>  — 设置我的语言 (zh|en|ja|ko)
 * jackclaw translate test <text>  — 测试翻译
 * jackclaw translate status       — 查看当前配置
 */

import { Command } from 'commander'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'

const TRANSLATOR_CONFIG_DIR = path.join(os.homedir(), '.jackclaw', 'node')
const TRANSLATOR_CONFIG_FILE = path.join(TRANSLATOR_CONFIG_DIR, 'translator.json')

interface TranslatorPreference {
  ownerLanguage: 'zh' | 'en' | 'ja' | 'ko' | 'auto'
  autoTranslate: boolean
  showOriginal: boolean
}

const DEFAULTS: TranslatorPreference = {
  ownerLanguage: 'auto',
  autoTranslate: false,
  showOriginal: true,
}

function loadPref(): TranslatorPreference {
  if (!fs.existsSync(TRANSLATOR_CONFIG_FILE)) return { ...DEFAULTS }
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(TRANSLATOR_CONFIG_FILE, 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

function savePref(pref: TranslatorPreference): void {
  fs.mkdirSync(TRANSLATOR_CONFIG_DIR, { recursive: true })
  fs.writeFileSync(TRANSLATOR_CONFIG_FILE, JSON.stringify(pref, null, 2))
}

const LANG_NAMES: Record<string, string> = {
  zh: '中文 (Chinese)', en: 'English', ja: '日本語 (Japanese)', ko: '한국어 (Korean)', auto: 'Auto-detect',
}

export function registerTranslate(program: Command): void {
  const translate = program
    .command('translate')
    .description('AI real-time message translation settings')

  // ── on ───────────────────────────────────────────────────────────────────────

  translate
    .command('on')
    .description('Enable auto-translation of incoming social messages')
    .action(() => {
      const pref = loadPref()
      pref.autoTranslate = true
      savePref(pref)
      console.log(chalk.green('[translate] ✓ Auto-translation enabled'))
      console.log(chalk.gray(`  Your language: ${LANG_NAMES[pref.ownerLanguage] ?? pref.ownerLanguage}`))
      console.log(chalk.gray(`  Show original: ${pref.showOriginal ? 'yes' : 'no'}`))
    })

  // ── off ──────────────────────────────────────────────────────────────────────

  translate
    .command('off')
    .description('Disable auto-translation')
    .action(() => {
      const pref = loadPref()
      pref.autoTranslate = false
      savePref(pref)
      console.log(chalk.yellow('[translate] Auto-translation disabled'))
    })

  // ── lang ─────────────────────────────────────────────────────────────────────

  translate
    .command('lang <code>')
    .description('Set your language: zh | en | ja | ko (or "auto")')
    .action((code: string) => {
      const valid = ['zh', 'en', 'ja', 'ko', 'auto']
      if (!valid.includes(code)) {
        console.error(chalk.red(`[translate] Invalid language code "${code}". Use: ${valid.join(' | ')}`))
        process.exit(1)
      }
      const pref = loadPref()
      pref.ownerLanguage = code as TranslatorPreference['ownerLanguage']
      savePref(pref)
      console.log(chalk.green(`[translate] ✓ Your language set to: ${LANG_NAMES[code] ?? code}`))
    })

  // ── show-original ────────────────────────────────────────────────────────────

  translate
    .command('show-original <on|off>')
    .description('Show original text alongside translation (on|off)')
    .action((flag: string) => {
      if (flag !== 'on' && flag !== 'off') {
        console.error(chalk.red('[translate] Use "on" or "off"'))
        process.exit(1)
      }
      const pref = loadPref()
      pref.showOriginal = flag === 'on'
      savePref(pref)
      console.log(chalk.green(`[translate] ✓ Show original: ${flag}`))
    })

  // ── status ────────────────────────────────────────────────────────────────────

  translate
    .command('status')
    .description('Show current translation configuration')
    .action(() => {
      const pref = loadPref()
      console.log(chalk.bold('\n[translate] Current configuration'))
      console.log(chalk.gray('─'.repeat(40)))
      const status = pref.autoTranslate
        ? chalk.green('enabled')
        : chalk.gray('disabled')
      console.log(`  Auto-translate:  ${status}`)
      console.log(`  Your language:   ${chalk.cyan(LANG_NAMES[pref.ownerLanguage] ?? pref.ownerLanguage)}`)
      console.log(`  Show original:   ${chalk.cyan(pref.showOriginal ? 'yes' : 'no')}`)
      console.log(`  Config file:     ${chalk.gray(TRANSLATOR_CONFIG_FILE)}`)
      console.log()
    })

  // ── test ─────────────────────────────────────────────────────────────────────

  translate
    .command('test <text>')
    .description('Test translation using the configured AI endpoint')
    .option('--to <lang>', 'Target language: zh | en | ja | ko', 'zh')
    .action(async (text: string, opts: { to: string }) => {
      const validLangs = ['zh', 'en', 'ja', 'ko']
      if (!validLangs.includes(opts.to)) {
        console.error(chalk.red(`[translate] Invalid --to language "${opts.to}". Use: ${validLangs.join(' | ')}`))
        process.exit(1)
      }

      // Load AI config from node config file
      const nodeConfigFile = path.join(os.homedir(), '.jackclaw', 'config.json')
      let aiBaseUrl = process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com'
      let aiToken = process.env['ANTHROPIC_AUTH_TOKEN'] ?? process.env['ANTHROPIC_API_KEY'] ?? ''
      let aiModel = 'claude-haiku-4-5-20251001'

      if (fs.existsSync(nodeConfigFile)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(nodeConfigFile, 'utf8'))
          if (cfg?.ai?.baseUrl) aiBaseUrl = cfg.ai.baseUrl
          if (cfg?.ai?.authToken) aiToken = cfg.ai.authToken
          if (cfg?.ai?.model) aiModel = cfg.ai.model
        } catch {}
      }

      if (!aiToken) {
        console.error(chalk.red('[translate] No AI token configured. Set ANTHROPIC_API_KEY or configure ~/.jackclaw/config.json'))
        process.exit(1)
      }

      const toLangNames: Record<string, string> = {
        zh: '中文', en: 'English', ja: '日本語', ko: '한국어',
      }

      console.log(chalk.gray(`[translate] Translating to ${toLangNames[opts.to]}...`))

      try {
        const body = {
          model: aiModel,
          max_tokens: 512,
          system: `You are a professional translator. Translate the given text to ${toLangNames[opts.to]}. Output ONLY the translated text, no explanations, no quotation marks.`,
          messages: [{ role: 'user', content: text }],
        }

        const res = await fetch(`${aiBaseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${aiToken}`,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`API error ${res.status}: ${errText}`)
        }

        const data = await res.json() as { content?: Array<{ text: string }> }
        const translated = data.content?.[0]?.text?.trim() ?? ''

        console.log()
        console.log(chalk.bold('Original:'))
        console.log(`  ${chalk.white(text)}`)
        console.log(chalk.bold(`\nTranslated (→ ${opts.to}):`))
        console.log(`  ${chalk.cyan(translated)}`)
        console.log()
      } catch (err: any) {
        console.error(chalk.red(`[translate] Failed: ${err.message}`))
        process.exit(1)
      }
    })
}
