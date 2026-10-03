// @vitest-environment jsdom

import type { Task } from "@nuage-home/shared";
import { act } from "react";
import ReactDOM from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportModal } from "./ReportModal.tsx";

describe("ReportModal", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    return () => {
      document.body.removeChild(container);
    };
  });

  it("task が与えられたときタイトルと Markdown 本文を描画する", async () => {
    const task: Task = {
      id: "t-1",
      app: "research",
      instruction: "京都の紅葉の調査",
      origin: "voice",
      status: "succeeded",
      createdAt: 1000,
      report: {
        title: "京都の紅葉の調査",
        markdown: "# 調査結果\n\n嵐山が見頃である。",
        createdAt: 1000,
      },
    };
    const onClose = vi.fn();

    const root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(
        <ReportModal task={task} initialPosition={{ top: 10, left: 10 }} onClose={onClose} />,
      );
    });

    const modal = container.querySelector(".report-modal");
    expect(modal).not.toBeNull();
    expect(modal?.querySelector("h2")?.textContent).toBe("Report: 京都の紅葉の調査");
    expect(modal?.querySelector(".report-body")?.innerHTML).toContain("<h1>調査結果</h1>");
    expect(modal?.querySelector(".report-body")?.innerHTML).toContain("<p>嵐山が見頃である。</p>");

    const closeBtn = modal?.querySelector<HTMLButtonElement>(".modal-close-btn");
    expect(closeBtn).not.toBeNull();
    closeBtn?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("task が null のときは何も描画しない", async () => {
    const root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(
        <ReportModal task={null} initialPosition={{ top: 10, left: 10 }} onClose={vi.fn()} />,
      );
    });

    expect(container.querySelector(".report-modal")).toBeNull();
  });
});
