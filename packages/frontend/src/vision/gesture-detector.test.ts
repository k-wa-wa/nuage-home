import { describe, expect, it } from "vitest";
import { GestureDetector, getGestureEmoji, getGestureLabel } from "./gesture-detector.ts";

describe("GestureDetector (Pinch & Micro-gestures)", () => {
  it("初期状態ではピンチなし、手未検出である", () => {
    const detector = new GestureDetector();
    const state = detector.getState();
    expect(state.hasHand).toBe(false);
    expect(state.lastGesture).toBeNull();
    expect(state.lastGestureTime).toBe(0);
    expect(state.isPinchingIndex).toBe(false);
    expect(state.isPinchingMiddle).toBe(false);
    expect(state.indexPinchRatio).toBe(1.0);
    expect(state.middlePinchRatio).toBe(1.0);
  });

  it("リスナー登録と解除が正しく動作する", () => {
    const detector = new GestureDetector();
    let callCount = 0;
    const unsub = detector.onStateChange((state) => {
      callCount++;
      expect(state.hasHand).toBe(false);
    });

    // 登録時に1回即座に呼ばれる
    expect(callCount).toBe(1);

    unsub();
  });

  it("onGesture リスナーの登録と解除が動作する", () => {
    const detector = new GestureDetector();
    let gestureCalled = false;
    const unsub = detector.onGesture(() => {
      gestureCalled = true;
    });

    expect(gestureCalled).toBe(false);
    unsub();
  });

  it("getGestureEmoji と getGestureLabel が適切な値を返す", () => {
    expect(getGestureEmoji("Pinch_Index")).toBe("👌");
    expect(getGestureEmoji("Pinch_Middle")).toBe("✌️");

    expect(getGestureLabel("Pinch_Index")).toContain("人差し指ピンチ");
    expect(getGestureLabel("Pinch_Middle")).toContain("中指ピンチ");
  });
});
