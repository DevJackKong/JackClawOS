import { definePlugin } from '@jackclaw/sdk'

export default definePlugin({
  name: '{{PROJECT_NAME}}',
  version: '0.1.0',
  description: '{{DESCRIPTION}}',

  commands: {
    // Basic command: /hello
    hello: async (ctx) => {
      return {
        text: `Hello from ${ctx.node.name}! 👋`,
      }
    },

    // Command with arguments: /ping [message]
    ping: async (ctx) => {
      const msg = ctx.args[0] ?? 'world'
      return {
        text: `Pong! You said: ${msg}`,
      }
    },
  },

  schedule: {
    // Runs every day at 09:00
    daily: async (ctx) => {
      await ctx.report({
        summary: `Daily report from ${ctx.node.name}`,
        items: [
          { label: 'Status', value: '✅ Healthy' },
          { label: 'Time', value: new Date().toLocaleString() },
        ],
      })
    },
  },

  hooks: {
    // Called when the plugin is loaded
    onLoad: async (ctx) => {
      ctx.log.info(`${ctx.plugin.name} loaded on node ${ctx.node.name}`)
    },
  },
})
