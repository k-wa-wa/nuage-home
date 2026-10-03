import type { Task } from "@nuage-home/shared";

export const TASK_LABEL: Record<Task["status"], string> = {
  accepted: "受付",
  running: "実行中",
  succeeded: "完了",
  failed: "失敗",
  cancelled: "取り消し",
};

export interface TaskBoardProps {
  tasks: Task[];
  onSelectReport?: (task: Task) => void;
}

/**
 * タスク一覧を表示する React コンポーネント。
 */
export function TaskBoard({ tasks, onSelectReport }: TaskBoardProps) {
  if (tasks.length === 0) {
    return (
      <ol className="list">
        <li className="list-empty">まだない</li>
      </ol>
    );
  }

  return (
    <ol className="list">
      {tasks.map((t) => (
        <li key={t.id}>
          <span className="chip" data-state={t.status}>
            {TASK_LABEL[t.status]}
          </span>
          <span>
            {" "}
            {t.app}: {t.instruction}
          </span>
          {t.summary && <div className="list-summary">{t.summary}</div>}
          {t.report && onSelectReport && (
            <div>
              <button type="button" className="btn-view-report" onClick={() => onSelectReport(t)}>
                📄 レポートを開く
              </button>
            </div>
          )}
          {t.detail && !t.report && t.detail !== t.summary && (
            <details>
              <summary>全文（テキスト）</summary>
              <pre>{t.detail}</pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
