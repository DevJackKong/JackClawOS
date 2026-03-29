export type Language = "en" | "zh";

export function resolveLanguage(locale?: string): Language {
  return locale?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function copyForLanguage<T>(language: Language, text: { en: T; zh: T }): T {
  return language === "zh" ? text.zh : text.en;
}

export function localizeWorkflowType(
  language: Language,
  workflowType: "chat" | "meeting" | "deal" | "content" | "unknown" | "unsupported"
) {
  return copyForLanguage(language, {
    en: workflowType,
    zh:
      workflowType === "chat"
        ? "对话"
        : workflowType === "meeting"
        ? "会议"
        : workflowType === "deal"
          ? "交易"
          : workflowType === "content"
            ? "内容"
            : workflowType === "unknown"
              ? "待澄清"
              : "未支持"
  });
}
