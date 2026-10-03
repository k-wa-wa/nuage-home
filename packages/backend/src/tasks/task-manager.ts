import type { Task, TaskOutput } from "@nuage-home/shared";

/**
 * 裏で動くタスクの管理。WebSocket 接続・Live セッションから独立して保持する。
 * 当面はメモリ保持とする（docs/design/voice-task-orchestration.md 5 章）。
 */

/** タスクの実行本体。構造化出力またはテキストを返す */
export type TaskRunner = (signal: AbortSignal) => Promise<TaskOutput | string>;

export interface NewTask {
  app: string;
  instruction: string;
  origin: Task["origin"];
}

export interface TaskResult {
  task: Task;
  /** 成功時は結果、失敗時はエラー内容 */
  output: TaskOutput | string;
}

export class TaskManager {
  private tasks = new Map<string, Task>();
  private controllers = new Map<string, AbortController>();
  private seq = 0;
  private listeners = new Set<(task: Task) => void>();

  private readonly clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  /** 状態が変わるたびに呼ばれる。解除関数を返す */
  subscribe(listener: (task: Task) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  create(input: NewTask): Task {
    const task: Task = {
      id: `t-${++this.seq}`,
      status: "accepted",
      createdAt: this.clock(),
      ...input,
    };
    this.tasks.set(task.id, task);
    this.emit(task);
    return { ...task };
  }

  /**
   * タスクを実行する。完了（成功・失敗）時に結果を返す。キャンセルされた場合は null を返す。
   */
  async run(id: string, runner: TaskRunner): Promise<TaskResult | null> {
    const task = this.tasks.get(id);
    if (task?.status !== "accepted") return null;

    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.update(task, { status: "running" });

    try {
      const output = await runner(controller.signal);
      if (controller.signal.aborted) return null;

      if (typeof output === "object" && output !== null && "speech" in output) {
        this.update(task, {
          status: "succeeded",
          finishedAt: this.clock(),
          summary: output.speech,
          detail: output.report?.markdown ?? output.speech,
          report: output.report
            ? {
                title: output.report.title,
                markdown: output.report.markdown,
                createdAt: this.clock(),
              }
            : undefined,
        });
      } else {
        const text = String(output);
        this.update(task, {
          status: "succeeded",
          finishedAt: this.clock(),
          detail: text,
        });
      }
      return { task: { ...task }, output };
    } catch (err) {
      if (controller.signal.aborted) return null;
      const output = err instanceof Error ? err.message : String(err);
      this.update(task, {
        status: "failed",
        finishedAt: this.clock(),
        summary: `作業に失敗した。${output}`,
        detail: output,
      });
      return { task: { ...task }, output };
    } finally {
      this.controllers.delete(id);
    }
  }

  /** 実行中のタスクをすべて中止する。状態は更新しない */
  abortAll(): void {
    for (const c of this.controllers.values()) c.abort();
  }

  /** 実行中のタスクをすべて中止し、タスク一覧を空にする */
  clear(): void {
    this.abortAll();
    this.controllers.clear();
    this.tasks.clear();
    this.seq = 0;
  }

  /** 音声向け要約を付ける */
  setSummary(id: string, summary: string): void {
    const task = this.tasks.get(id);
    if (task) this.update(task, { summary });
  }

  /** キャンセルする。id を省略すると直近の未完了タスクを対象にする */
  cancel(id?: string): Task | null {
    const task = id ? this.tasks.get(id) : this.latestActive();
    if (!task || (task.status !== "accepted" && task.status !== "running")) return null;
    this.controllers.get(task.id)?.abort();
    this.update(task, { status: "cancelled", finishedAt: this.clock() });
    return { ...task };
  }

  get(id: string): Task | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined;
  }

  /** 新しい順 */
  list(): Task[] {
    return [...this.tasks.values()].reverse().map((t) => ({ ...t }));
  }

  private latestActive(): Task | undefined {
    return [...this.tasks.values()]
      .reverse()
      .find((t) => t.status === "accepted" || t.status === "running");
  }

  private update(task: Task, patch: Partial<Task>): void {
    Object.assign(task, patch);
    this.emit(task);
  }

  private emit(task: Task): void {
    for (const l of this.listeners) l({ ...task });
  }
}
