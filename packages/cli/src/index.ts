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
import { registerAsk } from './commands/ask.js';
import { registerProviders } from './commands/providers.js';
import { registerLogs } from './commands/logs.js';
import { registerStop } from './commands/stop';
import { registerSocial } from './commands/social';
import { registerSchedule, registerRemind, registerReminders } from './commands/concierge';
import { registerFilter } from './commands/filter';
import { registerSecretary } from './commands/secretary';
import { registerTranslate } from './commands/translate';
import { registerMoltbook } from './commands/moltbook';
import { registerTask, registerTaskAsk } from './commands/task.js';
import { registerModelCommand } from './commands/model.js';
import { registerQuickCommands } from './commands/quick';
import { registerHubStatus } from './commands/hub-status';

const program = new Command();

program
  .name('jackclaw')
  .description('JackClaw - Encrypted org-node management CLI')
  .version('0.2.0');

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
registerAsk(program);
registerProviders(program);
registerLogs(program);
registerStop(program);
registerSocial(program);
registerSchedule(program);
registerRemind(program);
registerReminders(program);
registerFilter(program);
registerSecretary(program);
registerTranslate(program);
registerMoltbook(program);
registerTask(program);
registerTaskAsk(program);
registerModelCommand(program);
registerQuickCommands(program);
registerHubStatus(program);

program.parse(process.argv);
