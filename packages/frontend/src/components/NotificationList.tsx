import type { Notification, NotificationPriority } from "@nuage-home/shared";

export const NOTIFICATION_LABEL: Record<Notification["state"], string> = {
  queued: "配送待ち",
  piggybacked: "相乗り中",
  speaking: "読み上げ中",
  delivered: "伝達済み",
  interrupted: "中断（画面のみ）",
  screen_only: "画面のみ",
};

export interface NotificationListProps {
  notifications: Notification[];
  onManualNotify?: (priority: NotificationPriority) => void;
}

/**
 * 通知一覧を表示する React コンポーネント。
 */
export function NotificationList({ notifications, onManualNotify }: NotificationListProps) {
  return (
    <>
      {onManualNotify && (
        <div className="sb-debug">
          <span>手動発生:</span>
          <button type="button" onClick={() => onManualNotify("urgent")}>
            urgent
          </button>
          <button type="button" onClick={() => onManualNotify("normal")}>
            normal
          </button>
          <button type="button" onClick={() => onManualNotify("low")}>
            low
          </button>
        </div>
      )}
      {notifications.length === 0 ? (
        <ol className="list">
          <li className="list-empty">まだない</li>
        </ol>
      ) : (
        <ol className="list">
          {notifications.map((n) => (
            <li key={n.id}>
              <span className="chip" data-state={n.state}>
                {NOTIFICATION_LABEL[n.state]}
              </span>
              <span className="chip" data-state={n.priority}>
                {n.priority}
              </span>
              <span> {n.summary}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
