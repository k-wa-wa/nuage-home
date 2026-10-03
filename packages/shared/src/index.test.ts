import { describe, expect, it } from "vitest";
import { isReportTask, type Task } from "./index.ts";

describe("isReportTask", () => {
  it("task.report が存在するタスクはレポート対象と判定する", () => {
    const task: Task = {
      id: "t-1",
      app: "research",
      instruction: "京都の紅葉",
      origin: "voice",
      status: "succeeded",
      createdAt: 1000,
      summary: "見頃である",
      report: {
        title: "京都の紅葉",
        markdown: "# 調査結果",
        createdAt: 1000,
      },
    };
    expect(isReportTask(task)).toBe(true);
  });

  it("task.report が存在しない通常のタスクはレポート対象外と判定する", () => {
    const task: Task = {
      id: "t-2",
      app: "smart_home",
      instruction: "フロアライトをつけて",
      origin: "voice",
      status: "succeeded",
      createdAt: 1000,
      summary: "フロアライトを点灯した。",
      detail: "フロアライトの点灯操作を実行した。",
    };
    expect(isReportTask(task)).toBe(false);
  });

  it("task が null または undefined の場合は false を返す", () => {
    expect(isReportTask(null)).toBe(false);
    expect(isReportTask(undefined)).toBe(false);
  });
});
