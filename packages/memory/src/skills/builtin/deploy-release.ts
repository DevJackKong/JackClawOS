export const DeployReleaseSkill = {
  meta: {
    id: "deploy-release",
    name: "Deploy Release",
    description: "执行 Railway / Docker 发布流程，确保环境、构建、部署与验证闭环完成",
    version: "1.0.0",
    tags: ["deploy", "release", "railway", "docker", "ops"],
    triggerPatterns: ["deploy release", "publish app", "railway deploy", "docker release"],
  },
  sop: [
    "1. 检查部署目标与环境变量（Railway variables / .env / secrets）",
    "2. 执行构建与测试（如 pnpm build、docker build）",
    "3. 执行部署（railway up / docker compose up -d / 镜像推送）",
    "4. 验证发布结果（health check、日志、关键路径回归）",
  ],
  checklistItems: ["env 检查完成", "build 成功", "deploy 已执行", "发布验证通过"],
} as const;
