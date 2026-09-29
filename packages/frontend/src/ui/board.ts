import type { FloorStateName, Notification, Task } from "@nuage-home/shared";

/**
 * タスクと通知の一覧（音声モードとサンドボックスで共用）。
 * 「声は要約、画面は詳細」の画面側を担う。
 */

export const FLOOR_LABEL: Record<FloorStateName, string> = {
  idle: "待機",
  user_speaking: "あなたが発話中",
  awaiting_model: "応答待ち",
  model_speaking: "アシスタントが発話中",
};

const TASK_LABEL: Record<Task["status"], string> = {
  accepted: "受付",
  running: "実行中",
  succeeded: "完了",
  failed: "失敗",
  cancelled: "取り消し",
};

const NOTIFICATION_LABEL: Record<Notification["state"], string> = {
  queued: "配送待ち",
  piggybacked: "相乗り中",
  speaking: "読み上げ中",
  delivered: "伝達済み",
  interrupted: "中断（画面のみ）",
  screen_only: "画面のみ",
};

export class TaskBoard {
  private tasks = new Map<string, Task>();
  private notifications = new Map<string, Notification>();
  private readonly tasksEl: HTMLElement;
  private readonly notificationsEl: HTMLElement;

  constructor(tasksEl: HTMLElement, notificationsEl: HTMLElement) {
    this.tasksEl = tasksEl;
    this.notificationsEl = notificationsEl;
    this.render();
  }

  upsertTask(task: Task): void {
    this.tasks.set(task.id, task);
    this.renderTasks();
  }

  upsertNotification(notification: Notification): void {
    this.notifications.set(notification.id, notification);
    this.renderNotifications();
  }

  clear(): void {
    this.tasks.clear();
    this.notifications.clear();
    this.render();
  }

  private render(): void {
    this.renderTasks();
    this.renderNotifications();
  }

  private renderTasks(): void {
    const items = [...this.tasks.values()].reverse().map((t) => {
      const li = document.createElement("li");
      li.append(
        chip(TASK_LABEL[t.status], t.status),
        document.createTextNode(` ${t.app}: ${t.instruction}`),
      );
      if (t.summary) li.append(block("list-summary", `要約: ${t.summary}`));
      if (t.detail) li.append(details("全文", t.detail));
      return li;
    });
    this.tasksEl.replaceChildren(...(items.length > 0 ? items : [emptyItem()]));
  }

  private renderNotifications(): void {
    const items = [...this.notifications.values()].reverse().map((n) => {
      const li = document.createElement("li");
      li.append(
        chip(NOTIFICATION_LABEL[n.state], n.state),
        chip(n.priority, n.priority),
        document.createTextNode(` ${n.summary}`),
      );
      return li;
    });
    this.notificationsEl.replaceChildren(...(items.length > 0 ? items : [emptyItem()]));
  }
}

export function chip(label: string, state: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = "chip";
  s.dataset.state = state;
  s.textContent = label;
  return s;
}

export function block(className: string, text: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  d.textContent = text;
  return d;
}

function details(summary: string, body: string): HTMLDetailsElement {
  const d = document.createElement("details");
  const s = document.createElement("summary");
  s.textContent = summary;
  const p = document.createElement("pre");
  p.textContent = body;
  d.append(s, p);
  return d;
}

function emptyItem(): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "list-empty";
  li.textContent = "まだない";
  return li;
}
