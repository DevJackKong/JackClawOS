export default {
  title: 'JackClaw SDK Docs',
  description: 'JackClaw SDK、CLI 与 Hub API 文档站',
  lang: 'zh-CN',
  cleanUrls: true,

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '核心概念', link: '/guide/concepts' },
      { text: 'API', link: '/api/sdk' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '核心概念', link: '/guide/concepts' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API 参考',
          items: [
            { text: '@jackclaw/sdk', link: '/api/sdk' },
            { text: 'CLI 命令', link: '/api/cli' },
            { text: 'Hub REST API', link: '/api/rest' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/DevJackKong/JackClawOS' },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present Jack Kong',
    },
  },
}
