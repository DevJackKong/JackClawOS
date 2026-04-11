export const FeishuDocOutputSkill = {
  meta: {
    id: "feishu-doc-output",
    name: "Feishu Doc Output",
    description: "将内容输出到飞书文档，覆盖创建、写入与分享协作流程",
    version: "1.0.0",
    tags: ["feishu", "doc", "output", "collaboration"],
    triggerPatterns: ["feishu doc", "output to feishu", "write doc", "飞书文档"],
  },
  sop: [
    "1. 创建或定位目标飞书文档",
    "2. 写入结构化内容（标题、摘要、正文、表格/附件）",
    "3. 设置分享/协作权限并生成可访问链接",
    "4. 回传文档链接与写入结果",
  ],
  checklistItems: ["文档已创建", "内容已写入", "分享权限已设置", "文档链接已返回"],
} as const;
