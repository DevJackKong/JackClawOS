import { defineNode } from '@jackclaw/sdk'

export default defineNode({
  name: '{{PROJECT_NAME}}',
  version: '0.1.0',
  description: '{{DESCRIPTION}}',

  // Node capabilities advertised to the hub
  capabilities: ['report', 'command', 'schedule'],

  commands: {
    status: async (ctx) => {
      return {
        text: `Node ${ctx.node.name} is online ✅`,
        data: {
          uptime: process.uptime(),
          memory: process.memoryUsage().heapUsed,
          pid: process.pid,
        },
      }
    },

    info: async (ctx) => {
      return {
        text: `Node: ${ctx.node.name} | Version: ${ctx.node.version}`,
      }
    },
  },

  schedule: {
    daily: async (ctx) => {
      await ctx.report({
        summary: `Daily check-in from ${ctx.node.name}`,
        items: [
          { label: 'Status', value: '✅ Online' },
          { label: 'Uptime', value: `${Math.floor(process.uptime() / 3600)}h` },
        ],
      })
    },

    hourly: async (ctx) => {
      ctx.log.debug(`Heartbeat from ${ctx.node.name}`)
    },
  },

  hooks: {
    onLoad: async (ctx) => {
      ctx.log.info(`Node ${ctx.node.name} v${ctx.node.version} started`)
    },

    onShutdown: async (ctx) => {
      ctx.log.info(`Node ${ctx.node.name} shutting down`)
    },
  },
})
