#!/usr/bin/env node
/**
 * create-jackclaw — JackClaw project scaffolder
 * Usage: npx create-jackclaw [project-name]
 */

import chalk from 'chalk'
import { prompt } from 'enquirer'
import { execa } from 'execa'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates')

interface Answers {
  templateType: 'plugin' | 'node' | 'hub'
  projectName: string
  description: string
  author: string
  installDeps: boolean
}

const TEMPLATE_INFO = {
  plugin: {
    label: '🔌 Plugin — extend JackClaw with custom commands & schedules',
    color: chalk.cyan,
  },
  node: {
    label: '🖥  Node — standalone JackClaw node (team member agent)',
    color: chalk.green,
  },
  hub: {
    label: '🌐 Hub — central hub that coordinates multiple nodes',
    color: chalk.magenta,
  },
}

async function main() {
  const args = process.argv.slice(2)
  const nameArg = args[0]

  printBanner()

  // Collect answers
  const answers = await collectAnswers(nameArg)
  const targetDir = path.resolve(process.cwd(), answers.projectName)

  if (await fs.pathExists(targetDir)) {
    const { overwrite } = await prompt<{ overwrite: boolean }>({
      type: 'confirm',
      name: 'overwrite',
      message: chalk.yellow(`Directory "${answers.projectName}" already exists. Overwrite?`),
      initial: false,
    })
    if (!overwrite) {
      console.log(chalk.red('Aborted.'))
      process.exit(1)
    }
    await fs.remove(targetDir)
  }

  // Scaffold
  console.log()
  console.log(chalk.cyan('▸') + ' Scaffolding project...')
  await scaffold(answers, targetDir)

  // Install deps
  if (answers.installDeps) {
    console.log(chalk.cyan('▸') + ' Installing dependencies...')
    try {
      await execa('npm', ['install'], { cwd: targetDir, stdio: 'inherit' })
    } catch {
      console.log(chalk.yellow('⚠  npm install failed. Run it manually.'))
    }
  }

  printNextSteps(answers)
}

async function collectAnswers(nameArg?: string): Promise<Answers> {
  const { templateType } = await prompt<{ templateType: 'plugin' | 'node' | 'hub' }>({
    type: 'select',
    name: 'templateType',
    message: 'What do you want to create?',
    choices: Object.entries(TEMPLATE_INFO).map(([k, v]) => ({
      name: k,
      message: v.label,
    })),
  })

  const { projectName } = nameArg
    ? { projectName: nameArg }
    : await prompt<{ projectName: string }>({
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        initial: `my-jackclaw-${templateType}`,
        validate: (v) => v.length > 0 || 'Required',
      })

  const { description } = await prompt<{ description: string }>({
    type: 'input',
    name: 'description',
    message: 'Description:',
    initial: `A JackClaw ${templateType}`,
  })

  const { author } = await prompt<{ author: string }>({
    type: 'input',
    name: 'author',
    message: 'Author:',
    initial: '',
  })

  const { installDeps } = await prompt<{ installDeps: boolean }>({
    type: 'confirm',
    name: 'installDeps',
    message: 'Install dependencies now?',
    initial: true,
  })

  return { templateType, projectName, description, author, installDeps }
}

async function scaffold(answers: Answers, targetDir: string) {
  const templateSrc = path.join(TEMPLATES_DIR, answers.templateType)

  // Check if template exists (fallback to plugin if hub not built yet)
  const templateExists = await fs.pathExists(templateSrc)
  const actualTemplate = templateExists ? templateSrc : path.join(TEMPLATES_DIR, 'plugin')

  await fs.copy(actualTemplate, targetDir)

  // Replace placeholders in key files
  const filesToProcess = [
    'package.json',
    'README.md',
    'src/index.ts',
  ]

  for (const file of filesToProcess) {
    const filePath = path.join(targetDir, file)
    if (!(await fs.pathExists(filePath))) continue

    let content = await fs.readFile(filePath, 'utf8')
    content = content
      .replace(/\{\{PROJECT_NAME\}\}/g, answers.projectName)
      .replace(/\{\{DESCRIPTION\}\}/g, answers.description)
      .replace(/\{\{AUTHOR\}\}/g, answers.author)
      .replace(/\{\{TEMPLATE_TYPE\}\}/g, answers.templateType)
    await fs.writeFile(filePath, content, 'utf8')
  }
}

function printBanner() {
  console.log()
  console.log(chalk.bold.cyan('  ╔═══════════════════════════╗'))
  console.log(chalk.bold.cyan('  ║  ') + chalk.bold.white('create-jackclaw') + chalk.bold.cyan('         ║'))
  console.log(chalk.bold.cyan('  ║  ') + chalk.dim('JackClaw project scaffold') + chalk.bold.cyan('  ║'))
  console.log(chalk.bold.cyan('  ╚═══════════════════════════╝'))
  console.log()
}

function printNextSteps(answers: Answers) {
  const info = TEMPLATE_INFO[answers.templateType]
  console.log()
  console.log(chalk.bold.green('  ✓ Project created successfully!'))
  console.log()
  console.log(chalk.bold('  Next steps:'))
  console.log()
  console.log(chalk.cyan(`  cd ${answers.projectName}`))
  if (!answers.installDeps) {
    console.log(chalk.cyan('  npm install'))
  }
  console.log(chalk.cyan('  npm run dev         ') + chalk.dim('# watch mode'))
  console.log(chalk.cyan('  npm run build       ') + chalk.dim('# production build'))
  if (answers.templateType === 'plugin') {
    console.log(chalk.cyan('  jackclaw plugin load .') + chalk.dim('  # load into local node'))
  } else if (answers.templateType === 'node') {
    console.log(chalk.cyan('  jackclaw node start   ') + chalk.dim('# start node'))
  } else {
    console.log(chalk.cyan('  jackclaw hub start    ') + chalk.dim('# start hub'))
  }
  console.log()
  console.log(chalk.dim('  Docs: https://jackclaw.dev/docs/plugin-development'))
  console.log()
}

main().catch((err) => {
  console.error(chalk.red('Error:'), err.message)
  process.exit(1)
})
