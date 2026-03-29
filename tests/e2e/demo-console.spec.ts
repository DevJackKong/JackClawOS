import { expect, test } from "@playwright/test";

test("renders a deal decision dashboard from one command", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("language-select").selectOption("en-US");

  await page.getByTestId("command-input").fill(
    "Assess whether we should proceed with this AI tooling acquisition"
  );
  await page.getByTestId("run-command").click();

  await expect(page.getByTestId("active-decision")).toContainText("DEAL workflow recognized", { timeout: 15_000 });
  await expect(page.getByTestId("chat-transcript")).toContainText(
    "Assess whether we should proceed with this AI tooling acquisition"
  );
  await expect(page.getByTestId("chat-transcript")).toContainText("This looks like a deal workflow");
  await expect(page.getByTestId("metric-workflow")).toContainText("deal");
  await expect(page.getByTestId("route-status-badge")).toContainText("routed");
  await expect(page.getByTestId("plan-panel")).toContainText("decision-ready deal assessment");
});

test("shows clarification posture for unknown requests", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("language-select").selectOption("en-US");

  await page.getByTestId("command-input").fill("Analyze this and tell me what to do next");
  await page.getByTestId("run-command").click();

  await expect(page.getByTestId("active-decision")).toContainText(
    "Clarification needed before this run is safe to continue",
    { timeout: 15_000 }
  );
  await expect(page.getByTestId("chat-transcript")).toContainText(
    "There is not enough context yet to continue safely"
  );
  await expect(page.getByTestId("route-status-badge")).toContainText("needs clarification");
  await expect(page.getByTestId("required-inputs-panel")).toContainText("Target object");
});

test("switches to Chinese and handles a Chinese deal command", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("language-select").selectOption("zh-CN");
  await page.getByTestId("command-input").fill("评估一下这笔 AI 工具收购我们是否应该继续推进");
  await page.getByTestId("run-command").click();

  await expect(page.getByTestId("active-decision")).toContainText("已识别为交易工作流", { timeout: 15_000 });
  await expect(page.getByTestId("chat-transcript")).toContainText("我已经收到你的指令");
  await expect(page.getByTestId("metric-workflow")).toContainText("交易");
  await expect(page.getByTestId("route-status-badge")).toContainText("已路由");
  await expect(page.getByTestId("plan-panel")).toContainText("生成一份可直接支持决策的交易评估");
});

test("persists submitted runs and reopens them from history", async ({ page }) => {
  const uniqueSuffix = Date.now().toString();
  const dealCommand = `Assess whether we should proceed with this AI tooling acquisition ${uniqueSuffix}`;
  const contentCommand = `Draft a LinkedIn post about our new strategy ${uniqueSuffix} and check publication risk`;

  await page.goto("/");
  await page.getByTestId("language-select").selectOption("en-US");

  await page.getByTestId("command-input").fill(dealCommand);
  await page.getByTestId("run-command").click();
  await expect(page.getByTestId("active-decision")).toContainText("DEAL workflow recognized", { timeout: 15_000 });
  await expect(page.getByTestId("history-panel")).toContainText(dealCommand);
  await expect(page.getByTestId("chat-transcript")).toContainText(dealCommand);

  await page.getByTestId("command-input").fill(contentCommand);
  await page.getByTestId("run-command").click();
  await expect(page.getByTestId("active-decision")).toContainText("CONTENT workflow recognized", { timeout: 15_000 });
  await expect(page.getByTestId("history-panel")).toContainText(contentCommand);
  await expect(page.getByTestId("chat-transcript")).toContainText(contentCommand);

  await page.getByTestId("history-panel").getByRole("button", { name: new RegExp(dealCommand) }).click();
  await expect(page.getByTestId("active-decision")).toContainText("DEAL workflow recognized");
  await expect(page.getByTestId("metric-workflow")).toContainText("deal");
  await expect(page.getByTestId("chat-transcript")).toContainText(dealCommand);
});
