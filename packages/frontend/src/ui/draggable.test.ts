// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { bringToFront, resetHighestZIndex, setupDraggable, setupResizable } from "./draggable.ts";

describe("draggable", () => {
  beforeEach(() => {
    resetHighestZIndex(10);
    document.body.innerHTML = "";
  });

  it("初期位置が設定され、最前面に表示される", () => {
    const modalEl = document.createElement("section");
    modalEl.className = "floating-modal";
    const headerEl = document.createElement("div");
    headerEl.className = "modal-header";
    modalEl.appendChild(headerEl);
    document.body.appendChild(modalEl);

    const cleanup = setupDraggable(modalEl, headerEl, { top: 50, left: 100 });

    expect(modalEl.style.top).toBe("50px");
    expect(modalEl.style.left).toBe("100px");
    expect(modalEl.style.zIndex).toBe("11");
    expect(modalEl.classList.contains("is-active")).toBe(true);

    cleanup();
  });

  it("後から開いたモーダルの方が手前（大きい z-index）になり、クリックで再度手前になる", () => {
    const modal1 = document.createElement("section");
    modal1.className = "floating-modal";
    const header1 = document.createElement("div");
    modal1.appendChild(header1);
    document.body.appendChild(modal1);

    const modal2 = document.createElement("section");
    modal2.className = "floating-modal";
    const header2 = document.createElement("div");
    modal2.appendChild(header2);
    document.body.appendChild(modal2);

    const cleanup1 = setupDraggable(modal1, header1, { top: 10, left: 10 });
    expect(modal1.style.zIndex).toBe("11");

    const cleanup2 = setupDraggable(modal2, header2, { top: 20, left: 20 });
    // 後から開いた modal2 の方が手前
    expect(modal2.style.zIndex).toBe("12");
    expect(Number(modal2.style.zIndex)).toBeGreaterThan(Number(modal1.style.zIndex));

    // modal1 をクリック（pointerdown）すると modal1 が最前面になる
    modal1.dispatchEvent(new Event("pointerdown"));
    expect(modal1.style.zIndex).toBe("13");
    expect(Number(modal1.style.zIndex)).toBeGreaterThan(Number(modal2.style.zIndex));

    // bringToFront を直接呼んでも最前面になる
    bringToFront(modal2);
    expect(modal2.style.zIndex).toBe("14");
    expect(Number(modal2.style.zIndex)).toBeGreaterThan(Number(modal1.style.zIndex));

    cleanup1();
    cleanup2();
  });

  it("再実行されても既存の位置が上書きされない", () => {
    const modalEl = document.createElement("section");
    modalEl.className = "floating-modal";
    const headerEl = document.createElement("div");
    modalEl.appendChild(headerEl);
    document.body.appendChild(modalEl);

    const cleanup1 = setupDraggable(modalEl, headerEl, { top: 50, left: 100 });
    // ユーザーがドラッグして位置が変わったとする
    modalEl.style.left = "300px";
    modalEl.style.top = "400px";

    // 再度 setupDraggable が呼ばれても初期位置には戻らない
    const cleanup2 = setupDraggable(modalEl, headerEl, { top: 50, left: 100 });
    expect(modalEl.style.left).toBe("300px");
    expect(modalEl.style.top).toBe("400px");

    cleanup1();
    cleanup2();
  });

  it("setupResizable で右下ハンドルをドラッグしてサイズを変更できる", () => {
    const modalEl = document.createElement("section");
    modalEl.className = "floating-modal";
    modalEl.style.width = "300px";
    modalEl.style.height = "200px";
    const handleEl = document.createElement("div");
    handleEl.className = "modal-resize-handle";
    modalEl.appendChild(handleEl);
    document.body.appendChild(modalEl);

    // getBoundingClientRect のモック
    modalEl.getBoundingClientRect = () => ({
      left: 100,
      top: 100,
      right: 400,
      bottom: 300,
      width: 300,
      height: 200,
      x: 100,
      y: 100,
      toJSON: () => {},
    });

    const cleanup = setupResizable(modalEl, handleEl, { minWidth: 200, minHeight: 100 });

    // ドラッグ開始
    const downEvent = new MouseEvent("pointerdown", {
      clientX: 400,
      clientY: 300,
      button: 0,
      bubbles: true,
    }) as PointerEvent;
    handleEl.dispatchEvent(downEvent);

    expect(modalEl.classList.contains("is-resizing")).toBe(true);
    expect(modalEl.classList.contains("is-resized")).toBe(true);
    expect(handleEl.classList.contains("resizing")).toBe(true);

    // +50px, +60px ドラッグ
    const moveEvent = new MouseEvent("pointermove", {
      clientX: 450,
      clientY: 360,
      bubbles: true,
    }) as PointerEvent;
    handleEl.dispatchEvent(moveEvent);

    expect(modalEl.style.width).toBe("350px");
    expect(modalEl.style.height).toBe("260px");

    // ドラッグ終了
    const upEvent = new MouseEvent("pointerup", {
      clientX: 450,
      clientY: 360,
      bubbles: true,
    }) as PointerEvent;
    handleEl.dispatchEvent(upEvent);

    expect(modalEl.classList.contains("is-resizing")).toBe(false);
    expect(handleEl.classList.contains("resizing")).toBe(false);
    expect(modalEl.classList.contains("is-resized")).toBe(true);

    cleanup();
  });

  it("setupResizable で最小幅・最小高さ未満には縮まない", () => {
    const modalEl = document.createElement("section");
    modalEl.className = "floating-modal";
    const handleEl = document.createElement("div");
    handleEl.className = "modal-resize-handle";
    modalEl.appendChild(handleEl);
    document.body.appendChild(modalEl);

    modalEl.getBoundingClientRect = () => ({
      left: 100,
      top: 100,
      right: 400,
      bottom: 300,
      width: 300,
      height: 200,
      x: 100,
      y: 100,
      toJSON: () => {},
    });

    const cleanup = setupResizable(modalEl, handleEl, { minWidth: 260, minHeight: 140 });

    const downEvent = new MouseEvent("pointerdown", {
      clientX: 400,
      clientY: 300,
      button: 0,
      bubbles: true,
    }) as PointerEvent;
    handleEl.dispatchEvent(downEvent);

    // -200px 縮めようとする
    const moveEvent = new MouseEvent("pointermove", {
      clientX: 200,
      clientY: 100,
      bubbles: true,
    }) as PointerEvent;
    handleEl.dispatchEvent(moveEvent);

    expect(modalEl.style.width).toBe("260px");
    expect(modalEl.style.height).toBe("140px");

    const upEvent = new MouseEvent("pointerup", {
      clientX: 200,
      clientY: 100,
      bubbles: true,
    }) as PointerEvent;
    handleEl.dispatchEvent(upEvent);

    cleanup();
  });
});
