import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'JackClaw',
  description: '让 AI 员工像真人一样协作',
  lang: 'zh-CN',

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/quick-start' },
      { text: 'API', link: '/api/protocol' },
      { text: '架构', link: '/guide/architecture' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门',
          items: [
            { text: '快速开始', link: '/guide/quick-start' },
            { text: '架构总览', link: '/guide/architecture' },
          ],
        },
        {
          text: '进阶',
          items: [
            { text: 'ClawChat 使用指南', link: '/guide/clawchat' },
            { text: '安全指南', link: '/guide/security' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API 参考',
          items: [
            { text: '协议规范', link: '/api/protocol' },
            { text: 'Hub REST API', link: '/api/hub' },
            { text: 'CLI 命令', link: '/api/cli' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/jackclaw/jackclaw' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024–present JackClaw',
    },
  },
})
