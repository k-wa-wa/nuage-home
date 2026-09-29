import type { Notification, Task } from "@nuage-home/shared"
import type { Summarizer } from "../tasks/summarizer.ts"
import { TaskManager, type NewTask, type TaskRunner } from "../tasks/task-manager.ts"
import { DEFAULT_FLOOR_TIMING, type FloorTiming } from "./floor.ts"
import { NotificationQueue, type NewNotification } from "./notification-queue.ts"

/**
 * 接続を跨いで共有する状態（タスクと通知）。
 * Live セッションが切れてもタスクと未配送の通知を失わないよう、プロセスに 1 つ置く。
 * どの専門エージェント・要約を使うかは接続ごとに決める（Orchestrator 側で持つ）。
 */
export class OrchestrationHub {
  tasks: TaskManager
  queue: NotificationQueue
  readonly clock: () => number
  readonly timing: FloorTiming
  private taskListeners = new Set<(task: Task) => void>()
  private notificationListeners = new Set<(n: Notification) => void>()
  private wakeListeners = new Set<() => void>()

  constructor(clock: () => number = Date.now, timing: FloorTiming = DEFAULT_FLOOR_TIMING) {
    this.clock = clock
    this.timing = timing
    this.tasks = this.createTaskManager()
    this.queue = new NotificationQueue(timing)
  }

  /** タスクと通知をすべて消す。実行中のタスクは中止し、結果も通知しない */
  reset(): void {
    this.tasks.abortAll()
    this.tasks = this.createTaskManager()
    this.queue = new NotificationQueue(this.timing)
  }

  /** タスクの状態変化を購読する。reset で TaskManager が入れ替わっても購読は続く */
  subscribeTasks(listener: (task: Task) => void): () => void {
    this.taskListeners.add(listener)
    return () => this.taskListeners.delete(listener)
  }

  subscribeNotifications(listener: (n: Notification) => void): () => void {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  emitNotifications(ns: Notification[]): void {
    for (const n of ns) for (const l of this.notificationListeners) l(n)
  }

  /** 新しい通知が積まれたときに呼ばれる。配送の評価を即座に行うために使う */
  subscribeWake(listener: () => void): () => void {
    this.wakeListeners.add(listener)
    return () => this.wakeListeners.delete(listener)
  }

  /** 通知を積み、画面へ知らせ、配送の評価を促す */
  notify(input: NewNotification): Notification {
    const n = this.queue.add(input, this.clock())
    this.emitNotifications([n])
    for (const l of this.wakeListeners) l()
    return n
  }

  /** タスクを起動し、完了したら要約して通知キューに積む。完了を待つ Promise も返す */
  startTask(input: NewTask, runner: TaskRunner, summarize: Summarizer): { task: Task; done: Promise<void> } {
    const tasks = this.tasks
    const task = tasks.create(input)
    const done = tasks.run(task.id, runner).then(async (res) => {
      // リセットされた後に終わったタスクは通知しない
      if (!res || tasks !== this.tasks) return
      const ok = res.task.status === "succeeded"
      let summary: string
      try {
        summary = ok ? await summarize(res.output, res.task) : `頼まれていた作業は失敗した。${firstSentence(res.output)}`
      } catch {
        summary = firstSentence(res.output)
      }
      if (tasks !== this.tasks) return
      this.tasks.setSummary(task.id, summary)
      this.notify({ priority: "normal", summary, detail: res.output, taskId: task.id })
    })
    return { task, done }
  }

  private createTaskManager(): TaskManager {
    const tasks = new TaskManager(this.clock)
    tasks.subscribe((task) => {
      if (tasks === this.tasks) for (const l of this.taskListeners) l(task)
    })
    return tasks
  }
}

function firstSentence(text: string): string {
  const s = text.split(/(?<=[。！？!?])/)[0]?.trim() ?? ""
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}
