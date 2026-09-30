export interface InitialPosition {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

let highestZIndex = 10;

/**
 * モーダル要素をヘッダーのドラッグで移動可能にし、クリック時に最前面へ出す。
 */
export function setupDraggable(
  modalEl: HTMLElement,
  headerEl: HTMLElement,
  initialPos: InitialPosition,
): void {
  if (initialPos.top !== undefined) modalEl.style.top = `${initialPos.top}px`;
  if (initialPos.bottom !== undefined) modalEl.style.bottom = `${initialPos.bottom}px`;
  if (initialPos.left !== undefined) modalEl.style.left = `${initialPos.left}px`;
  if (initialPos.right !== undefined) modalEl.style.right = `${initialPos.right}px`;

  const bringToFront = () => {
    highestZIndex += 1;
    modalEl.style.zIndex = String(highestZIndex);
    for (const el of document.querySelectorAll(".floating-modal")) {
      el.classList.remove("is-active");
    }
    modalEl.classList.add("is-active");
  };

  modalEl.addEventListener("pointerdown", bringToFront);

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  headerEl.addEventListener("pointerdown", (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, .chip")) return;
    isDragging = true;
    headerEl.setPointerCapture(e.pointerId);
    headerEl.classList.add("dragging");
    bringToFront();

    const rect = modalEl.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;
  });

  headerEl.addEventListener("pointermove", (e: PointerEvent) => {
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
  });

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

  headerEl.addEventListener("pointerup", stopDragging);
  headerEl.addEventListener("pointercancel", stopDragging);
}
