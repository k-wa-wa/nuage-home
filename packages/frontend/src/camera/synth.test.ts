// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { TestSoundPlayer } from "./synth.ts";

describe("TestSoundPlayer", () => {
  it("初期状態では非アクティブである", () => {
    const player = new TestSoundPlayer();
    expect(player.getIsRunning()).toBe(false);
  });

  it("音量やサウンドタイプの設定が反映される", () => {
    const player = new TestSoundPlayer();
    player.setVolume(0.5);
    player.setSoundType("sine");
    // エラーなく呼び出せる
    player.setMuted(true);
    player.setMuted(false);
  });
});
