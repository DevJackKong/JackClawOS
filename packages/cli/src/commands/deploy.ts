import { Command } from 'commander';
import chalk from 'chalk';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function findRepoRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'railway.toml'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return startDir;
    current = parent;
  }
}

export function registerDeploy(program: Command): void {
  program
    .command('deploy')
    .description('Deploy Hub to Railway using railway up')
    .option('--cwd <dir>', 'Project directory containing railway.toml')
    .action((opts: { cwd?: string }) => {
      const cwd = opts.cwd ? path.resolve(opts.cwd) : findRepoRoot(process.cwd());

      try {
        execFileSync('railway', ['--version'], { stdio: 'ignore' });
      } catch {
        console.error(chalk.red('✗ Railway CLI not found. Install: npm i -g @railway/cli'));
        process.exit(1);
      }

      console.log(chalk.gray(`Deploying from ${cwd}`));
      try {
        execFileSync('railway', ['up'], { cwd, stdio: 'inherit' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`✗ Deploy failed: ${message}`));
        process.exit(1);
      }
    });
}
