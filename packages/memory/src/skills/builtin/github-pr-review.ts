export const GithubPRReviewSkill = {
  meta: {
    id: "github-pr-review",
    name: "GitHub PR Review",
    description: "自动 review GitHub PR，输出结构化评审意见",
    version: "1.0.0",
    tags: ["github", "pr", "review", "code"],
    triggerPatterns: ["review pr", "code review", "pr #", "pull request"],
  },
  sop: [
    "1. 获取 PR diff（gh pr diff <number>）",
    "2. 分析变更：逻辑/安全/性能/可读性",
    "3. 输出：summary + 问题列表 + 建议",
    "4. 可选：gh pr comment 提交评审",
  ],
  checklistItems: ["diff 已获取", "安全检查完成", "性能影响评估", "评审意见已输出"],
} as const;
