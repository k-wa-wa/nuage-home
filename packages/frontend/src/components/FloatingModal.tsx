import { type ReactNode, useEffect, useRef } from "react";
import { bringToFront, type InitialPosition, setupDraggable } from "../ui/draggable.ts";

export type { InitialPosition };

export interface FloatingModalProps {
  title: string;
  initialPosition: InitialPosition;
  children: ReactNode;
  headerExtra?: ReactNode;
  onClose?: () => void;
  className?: string;
  isOpen?: boolean;
}

/**
 * ドラッグ移動可能な浮動モーダルコンポーネント。
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
}: FloatingModalProps) {
  const modalRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const initialPosRef = useRef(initialPosition);

  // 初回マウント時のみドラッグリスナーを登録し、初期位置を設定する
  useEffect(() => {
    if (modalRef.current && headerRef.current) {
      return setupDraggable(modalRef.current, headerRef.current, initialPosRef.current);
    }
  }, []);

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
    </section>
  );
}
