import type { Task } from "@nuage-home/shared";
import { renderMarkdown } from "../ui/markdown.ts";
import { FloatingModal, type InitialPosition } from "./FloatingModal.tsx";

export interface ReportModalProps {
  task: Task | null;
  initialPosition: InitialPosition;
  onClose: () => void;
}

/**
 * 調査結果等の Markdown レポートを表示する浮動モーダル。
 * renderMarkdown（DOMPurify サニタイズ済み）を用いて安全にレンダリングする。
 */
export function ReportModal({ task, initialPosition, onClose }: ReportModalProps) {
  const content = task?.report?.markdown ?? task?.detail;
  if (!task || !content) return null;

  const title = task.report?.title ? `Report: ${task.report.title}` : `Report: ${task.instruction}`;

  // DOMPurify でサニタイズされた安全な HTML
  const safeHtml = renderMarkdown(content);

  return (
    <FloatingModal
      key={task.id}
      title={title}
      initialPosition={initialPosition}
      onClose={onClose}
      className="report-modal"
      isOpen={true}
    >
      <div
        className="report-body"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: safeHtml は DOMPurify でサニタイズ済みである
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />
    </FloatingModal>
  );
}
