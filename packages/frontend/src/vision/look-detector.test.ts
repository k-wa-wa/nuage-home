import { describe, expect, it } from "vitest";
import { LookDetector } from "./look-detector.ts";

describe("LookDetector", () => {
  it("初期状態では画面を見ていないと判定される", () => {
    const detector = new LookDetector();
    const state = detector.getState();
    expect(state.isLooking).toBe(false);
    expect(state.rawLooking).toBe(false);
    expect(state.faceDetected).toBe(false);
    expect(detector.isLookingAtScreen()).toBe(false);
  });

  it("attentionGraceMs 猶予時間の範囲内であれば isLookingAtScreen は true を返す", () => {
    const detector = new LookDetector({ attentionGraceMs: 500 });
    const state = detector.getState();

    // 最後に正面を向いた時刻を 200ms 前に設定
    state.lastLookingTime = Date.now() - 200;
    expect(detector.isLookingAtScreen()).toBe(true);

    // 猶予時間を超えた（700ms前）場合は false
    state.lastLookingTime = Date.now() - 700;
    expect(detector.isLookingAtScreen()).toBe(false);
  });

  it("リスナー登録と解除が正しく動作する", () => {
    const detector = new LookDetector();
    let attentionCalled = false;
    const unsub = detector.onAttentionChange(() => {
      attentionCalled = true;
    });

    expect(attentionCalled).toBe(false);
    unsub();
  });

  it("bypassAttention を呼び出すと指定時間内は isLookingAtScreen が true を返す", () => {
    const detector = new LookDetector();
    expect(detector.isLookingAtScreen()).toBe(false);

    detector.bypassAttention(1000);
    expect(detector.isLookingAtScreen()).toBe(true);
  });

  it("setThresholds で判定閾値を変更できる", () => {
    const detector = new LookDetector();
    expect(detector.getThresholds().maxYawDeg).toBe(14);
    expect(detector.getThresholds().maxGazeOffsetX).toBe(0.28);

    detector.setThresholds({ maxYawDeg: 10, maxGazeOffsetX: 0.2 });
    expect(detector.getThresholds().maxYawDeg).toBe(10);
    expect(detector.getThresholds().maxGazeOffsetX).toBe(0.2);
  });
});
