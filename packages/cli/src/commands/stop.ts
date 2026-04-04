/**
 * jackclaw stop
 *
 * 读取 ~/.jackclaw/jackclaw.pid，向守护进程发送 SIGTERM，
 * 1 秒后仍未退出则 SIGKILL，最后删除 PID 文件。
 */

import { Command } from 'commander'
import chalk from 'chalk'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const PID_FILE = path.join(os.homedir(), '.jackclaw', 'jackclaw.pid')

export function registerStop(program: Command): void {
  program
    .command('stop')
    .description('Stop the JackClaw daemon')
    .action(() => {
      if (!fs.existsSync(PID_FILE)) {
        console.log(chalk.yellow('JackClaw is not running (no PID file found)'))
        process.exit(0)
      }

      const pidStr = fs.readFileSync(PID_FILE, 'utf8').trim()
      const pid = parseInt(pidStr, 10)

      if (isNaN(pid) || pid <= 0) {
        console.error(chalk.red(`Invalid PID in ${PID_FILE}: "${pidStr}"`))
        fs.unlinkSync(PID_FILE)
        process.exit(1)
      }

      try {
        process.kill(pid, 'SIGTERM')
        console.log(chalk.green(`✓ SIGTERM sent to JackClaw daemon (PID ${pid})`))
      } catch (err: any) {
        if (err.code === 'ESRCH') {
          console.log(chalk.yellow(`Process ${pid} not found (already stopped)`))
        } else {
          console.error(chalk.red(`Failed to stop process ${pid}: ${err.message}`))
          process.exit(1)
        }
      }

      fs.unlinkSync(PID_FILE)
      console.log(chalk.gray(`PID file removed: ${PID_FILE}`))
    })
}
