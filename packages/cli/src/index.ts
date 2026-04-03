#!/usr/bin/env node
import { Command } from 'commander';
import { registerInit } from './commands/init';
import { registerInvite } from './commands/invite';
import { registerStatus } from './commands/status';
import { registerReport } from './commands/report';
import { registerNodes } from './commands/nodes';
import { registerConfig } from './commands/config';
import { mentionCommand, identityCommand, sessionsCommand } from './commands/identity';
import { registerStartCommand } from './commands/start';
import { registerChatCommand } from './commands/chat';
import { registerDemo } from './commands/demo';

const program = new Command();

program
  .name('jackclaw')
  .description('JackClaw - Encrypted org-node management CLI')
  .version('0.1.0');

registerInit(program);
registerInvite(program);
registerStatus(program);
registerReport(program);
registerNodes(program);
registerConfig(program);
mentionCommand(program);
identityCommand(program);
sessionsCommand(program);
registerStartCommand(program);
registerChatCommand(program);
registerDemo(program);

program.parse(process.argv);
