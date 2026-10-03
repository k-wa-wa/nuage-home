// @vitest-environment jsdom

import type { Task } from "@nuage-home/shared";
import { act } from "react";
import ReactDOM from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskBoard } from "./TaskBoard.tsx";

describe("TaskBoard", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    return () => {
      document.body.removeChild(container);
    };
  });

  it("タスク一覧を正しくレンダリングし、レポートボタンをクリックするとコールバックを呼ぶ", async () => {
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
        markdown: "詳細レポート本文",
        createdAt: 1000,
      },
    };
    const onSelectReport = vi.fn();

    const root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(<TaskBoard tasks={[task]} onSelectReport={onSelectReport} />);
    });

    expect(container.textContent).toContain("research: 京都の紅葉");
    expect(container.textContent).toContain("見頃である");
    expect(container.textContent).not.toContain("要約:");

    const reportBtn = container.querySelector<HTMLButtonElement>(".btn-view-report");
    expect(reportBtn).not.toBeNull();
    reportBtn?.click();
    expect(onSelectReport).toHaveBeenCalledWith(task);
  });

  it("家電操作などの通常タスクではレポートボタンを表示しない", async () => {
    const task: Task = {
      id: "t-2",
      app: "smart_home",
      instruction: "フロアライトをつけて",
      origin: "voice",
      status: "succeeded",
      createdAt: 1000,
      summary: "フロアライトを点灯した。",
      detail: "フロアライトを点灯した。",
    };
    const onSelectReport = vi.fn();

    const root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(<TaskBoard tasks={[task]} onSelectReport={onSelectReport} />);
    });

    expect(container.textContent).toContain("smart_home: フロアライトをつけて");
    expect(container.textContent).toContain("フロアライトを点灯した。");
    expect(container.textContent).not.toContain("要約:");
    expect(container.textContent).not.toContain("全文（テキスト）");
    const reportBtn = container.querySelector<HTMLButtonElement>(".btn-view-report");
    expect(reportBtn).toBeNull();
  });

  it("タスクが空のときは「まだない」を表示する", async () => {
    const root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(<TaskBoard tasks={[]} />);
    });

    expect(container.textContent).toContain("まだない");
  });
});
