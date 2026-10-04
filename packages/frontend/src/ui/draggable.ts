export interface InitialPosition {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

let highestZIndex = 10;

/**
 * モーダル要素を最前面へ持ってくる。
 */
export function bringToFront(modalEl: HTMLElement): void {
  highestZIndex += 1;
  modalEl.style.zIndex = String(highestZIndex);
  for (const el of document.querySelectorAll(".floating-modal")) {
    el.classList.remove("is-active");
  }
  modalEl.classList.add("is-active");
}

/**
 * テスト等で z-index の基準値をリセットする。
 */
export function resetHighestZIndex(val = 10): void {
  highestZIndex = val;
}

/**
 * モーダル要素をヘッダーのドラッグで移動可能にし、クリック時に最前面へ出す。
 * アンマウント時にリスナーを解除するクリーンアップ関数を返す。
 */
export function setupDraggable(
  modalEl: HTMLElement,
  headerEl: HTMLElement,
  initialPos: InitialPosition,
): () => void {
  // 初回のみ初期位置を適用する（すでに移動されている場合は維持）
  if (modalEl.dataset.draggableInitialized !== "true") {
    modalEl.dataset.draggableInitialized = "true";
    if (initialPos.top !== undefined) modalEl.style.top = `${initialPos.top}px`;
    if (initialPos.bottom !== undefined) modalEl.style.bottom = `${initialPos.bottom}px`;
    if (initialPos.left !== undefined) modalEl.style.left = `${initialPos.left}px`;
    if (initialPos.right !== undefined) modalEl.style.right = `${initialPos.right}px`;
  }

  // 表示時に自動で最前面にする
  bringToFront(modalEl);

  const onPointerDown = () => {
    bringToFront(modalEl);
  };
  modalEl.addEventListener("pointerdown", onPointerDown);

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  const onHeaderPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, .chip")) return;
    isDragging = true;
    headerEl.setPointerCapture(e.pointerId);
    headerEl.classList.add("dragging");
    bringToFront(modalEl);

    const rect = modalEl.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;
  };

  const onHeaderPointerMove = (e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const modalWidth = modalEl.offsetWidth;
    const modalHeight = modalEl.offsetHeight;
    const maxLeft = Math.max(8, window.innerWidth - modalWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - modalHeight - 8);

    const nextLeft = Math.max(8, Math.min(maxLeft, initialLeft + dx));
    const nextTop = Math.max(8, Math.min(maxTop, initialTop + dy));

    modalEl.style.left = `${nextLeft}px`;
    modalEl.style.top = `${nextTop}px`;
    modalEl.style.right = "auto";
    modalEl.style.bottom = "auto";
  };

  const stopDragging = (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    headerEl.classList.remove("dragging");
    try {
      headerEl.releasePointerCapture(e.pointerId);
    } catch {
      // ポインターキャプチャ解除時の例外は無視
    }
  };

  headerEl.addEventListener("pointerdown", onHeaderPointerDown);
  headerEl.addEventListener("pointermove", onHeaderPointerMove);
  headerEl.addEventListener("pointerup", stopDragging);
  headerEl.addEventListener("pointercancel", stopDragging);

  return () => {
    modalEl.removeEventListener("pointerdown", onPointerDown);
    headerEl.removeEventListener("pointerdown", onHeaderPointerDown);
    headerEl.removeEventListener("pointermove", onHeaderPointerMove);
    headerEl.removeEventListener("pointerup", stopDragging);
    headerEl.removeEventListener("pointercancel", stopDragging);
  };
}

export interface SetupResizableOptions {
  minWidth?: number;
  minHeight?: number;
}

/**
 * モーダル要素を右下ハンドルのドラッグでサイズ変更可能にする。
 * アンマウント時にリスナーを解除するクリーンアップ関数を返す。
 */
export function setupResizable(
  modalEl: HTMLElement,
  handleEl: HTMLElement,
  options: SetupResizableOptions = {},
): () => void {
  const minWidth = options.minWidth ?? 260;
  const minHeight = options.minHeight ?? 140;

  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let initialLeft = 0;
  let initialTop = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();

    isResizing = true;
    try {
      handleEl.setPointerCapture?.(e.pointerId);
    } catch {
      // ポインターキャプチャ未対応環境は無視
    }
    handleEl.classList.add("resizing");
    modalEl.classList.add("is-resizing");
    modalEl.classList.add("is-resized");
    bringToFront(modalEl);

    const rect = modalEl.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = rect.width;
    startHeight = rect.height;

    // right / bottom 配置の場合は left / top に固定してリサイズ時の位置崩れを防止
    modalEl.style.left = `${initialLeft}px`;
    modalEl.style.top = `${initialTop}px`;
    modalEl.style.right = "auto";
    modalEl.style.bottom = "auto";
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!isResizing) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const maxWidth = Math.max(minWidth, window.innerWidth - initialLeft - 8);
    const maxHeight = Math.max(minHeight, window.innerHeight - initialTop - 8);

    const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + dx));
    const nextHeight = Math.max(minHeight, Math.min(maxHeight, startHeight + dy));

    modalEl.style.width = `${nextWidth}px`;
    modalEl.style.height = `${nextHeight}px`;
  };

  const stopResizing = (e: PointerEvent) => {
    if (!isResizing) return;
    isResizing = false;
    handleEl.classList.remove("resizing");
    modalEl.classList.remove("is-resizing");
    try {
      handleEl.releasePointerCapture(e.pointerId);
    } catch {
      // ポインターキャプチャ解除時の例外は無視
    }
  };

  handleEl.addEventListener("pointerdown", onPointerDown);
  handleEl.addEventListener("pointermove", onPointerMove);
  handleEl.addEventListener("pointerup", stopResizing);
  handleEl.addEventListener("pointercancel", stopResizing);

  return () => {
    handleEl.removeEventListener("pointerdown", onPointerDown);
    handleEl.removeEventListener("pointermove", onPointerMove);
    handleEl.removeEventListener("pointerup", stopResizing);
    handleEl.removeEventListener("pointercancel", stopResizing);
  };
}
