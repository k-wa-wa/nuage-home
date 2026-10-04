import { type ReactNode, useEffect, useRef } from "react";
import {
  bringToFront,
  type InitialPosition,
  setupDraggable,
  setupResizable,
} from "../ui/draggable.ts";

export type { InitialPosition };

export interface FloatingModalProps {
  title: string;
  initialPosition: InitialPosition;
  children: ReactNode;
  headerExtra?: ReactNode;
  onClose?: () => void;
  className?: string;
  isOpen?: boolean;
  resizable?: boolean;
}

/**
 * ドラッグ移動および右下ドラッグでのリサイズが可能な浮動モーダルコンポーネント。
 * 音声モードとサンドボックスの両方で共通のデザイン言語を提供する。
 */
export function FloatingModal({
  title,
  initialPosition,
  children,
  headerExtra,
  onClose,
  className = "",
  isOpen = true,
  resizable = true,
}: FloatingModalProps) {
  const modalRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const initialPosRef = useRef(initialPosition);

  // 初回マウント時のみドラッグリスナーおよびリサイズリスナーを登録
  useEffect(() => {
    if (!modalRef.current || !headerRef.current) return;

    const cleanupDrag = setupDraggable(modalRef.current, headerRef.current, initialPosRef.current);
    let cleanupResize: (() => void) | undefined;
    if (resizable && resizeRef.current) {
      cleanupResize = setupResizable(modalRef.current, resizeRef.current);
    }

    return () => {
      cleanupDrag();
      cleanupResize?.();
    };
  }, [resizable]);

  // 表示されるたびに手前（最前面）に出す
  useEffect(() => {
    if (isOpen && modalRef.current) {
      bringToFront(modalRef.current);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <section ref={modalRef} className={`floating-modal ${className}`.trim()}>
      <div ref={headerRef} className="modal-header">
        <div className="modal-title">
          <span className="drag-handle" aria-hidden="true">
            ⋮⋮
          </span>
          <h2>{title}</h2>
        </div>
        {(headerExtra || onClose) && (
          <div className="modal-actions">
            {headerExtra}
            {onClose && (
              <button
                type="button"
                className="modal-close-btn"
                onClick={onClose}
                title="閉じる"
                aria-label="閉じる"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
      <div className="modal-body">{children}</div>
      {resizable && (
        <div
          ref={resizeRef}
          className="modal-resize-handle"
          title="ドラッグしてサイズ変更"
          aria-hidden="true"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path
              d="M9 1L1 9M9 5L5 9M9 9L9 9.01"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
    </section>
  );
}
