export const DailyBriefingSkill = {
  meta: {
    id: "daily-briefing",
    name: "Daily Briefing",
    description: "生成每日简报，汇总邮件、日历、任务与天气信息",
    version: "1.0.0",
    tags: ["briefing", "daily", "calendar", "tasks", "weather"],
    triggerPatterns: ["daily briefing", "morning brief", "today summary", "每日简报"],
  },
  sop: [
    "1. 汇总未读/重要邮件，提炼待处理事项",
    "2. 拉取今日日历事件与时间冲突提示",
    "3. 汇总任务系统中的今日重点与逾期事项",
    "4. 查询天气并输出行动建议，整合成每日简报",
  ],
  checklistItems: ["邮件已汇总", "日历已检查", "任务已汇总", "天气已纳入简报"],
} as const;
