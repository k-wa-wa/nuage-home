import { describe, expect, it } from "vitest";
import {
  canSpeak,
  type Floor,
  type FloorEvent,
  initialFloor,
  isConversationActive,
  reduceFloor,
} from "./floor.ts";

function run(events: FloorEvent[], start = 0): Floor {
  return events.reduce((f, e, i) => reduceFloor(f, e, start + i), initialFloor(start));
}

describe("reduceFloor", () => {
  it("ユーザー発話 → 応答待ち → 再生 → 再生終了で idle に戻る", () => {
    let f = initialFloor(0);
    f = reduceFloor(f, { type: "user_speech_start" }, 1);
    expect(f.state).toBe("user_speaking");
    f = reduceFloor(f, { type: "user_turn_sent" }, 2);
    expect(f.state).toBe("awaiting_model");
    f = reduceFloor(f, { type: "playback", playing: true }, 3);
    expect(f.state).toBe("model_speaking");
    f = reduceFloor(f, { type: "model_turn_complete" }, 4);
    expect(f.state).toBe("model_speaking");
    f = reduceFloor(f, { type: "playback", playing: false }, 5);
    expect(f.state).toBe("idle");
  });

  it("turnComplete を受けても再生中なら idle にならない", () => {
    const f = run([
      { type: "user_turn_sent" },
      { type: "playback", playing: true },
      { type: "model_turn_complete" },
    ]);
    expect(f.state).toBe("model_speaking");
  });

  it("再生が途切れても、ターンが終わっていなければ応答待ちに戻る", () => {
    const f = run([
      { type: "user_turn_sent" },
      { type: "playback", playing: true },
      { type: "playback", playing: false },
    ]);
    expect(f.state).toBe("awaiting_model");
  });

  it("ツール呼び出しの無言ターンが終わっても、相槌のターンを待ち続ける", () => {
    const f = run([
      { type: "user_turn_sent" },
      // ツール呼び出しに即 ack を返す
      { type: "model_prompted" },
      // 無言のツール呼び出しターンの完了
      { type: "model_turn_complete" },
    ]);
    expect(f.state).toBe("awaiting_model");
    const g = reduceFloor(
      reduceFloor(
        reduceFloor(f, { type: "playback", playing: true }, 10),
        { type: "model_turn_complete" },
        11,
      ),
      { type: "playback", playing: false },
      12,
    );
    expect(g.state).toBe("idle");
  });

  it("ユーザー発話中は Live の完了イベントで状態を変えない", () => {
    const f = run([
      { type: "user_turn_sent" },
      { type: "user_speech_start" },
      { type: "model_turn_complete" },
      { type: "playback", playing: false },
    ]);
    expect(f.state).toBe("user_speaking");
  });

  it("発話の取り消しでは、話す前の状態に戻る", () => {
    expect(run([{ type: "user_speech_start" }, { type: "user_speech_cancel" }]).state).toBe("idle");
    const f = run([
      { type: "user_turn_sent" },
      { type: "user_speech_start" },
      { type: "user_speech_cancel" },
    ]);
    expect(f.state).toBe("awaiting_model");
  });

  it("応答が遅れて余分な turnComplete が来ても壊れない", () => {
    const f = run([{ type: "model_turn_complete" }, { type: "model_turn_complete" }]);
    expect(f.state).toBe("idle");
    expect(f.pendingTurns).toBe(0);
  });
});

describe("canSpeak", () => {
  it("idle になってから猶予時間が経つまでは話さない", () => {
    const f = reduceFloor(initialFloor(0), { type: "user_speech_cancel" }, 1000);
    expect(canSpeak(f, 3000, 2500)).toBe(false);
    expect(canSpeak(f, 3500, 2500)).toBe(true);
  });

  it("ユーザー発話中は猶予に関係なく話さない", () => {
    const f = reduceFloor(initialFloor(0), { type: "user_speech_start" }, 0);
    expect(canSpeak(f, 1_000_000, 0)).toBe(false);
  });

  it("Live が応答しないまま固まったら待ちを解除する", () => {
    const f = reduceFloor(initialFloor(0), { type: "user_turn_sent" }, 0);
    expect(canSpeak(f, 19_999, 0)).toBe(false);
    expect(canSpeak(f, 20_000, 0)).toBe(true);
  });
});

describe("isConversationActive", () => {
  it("最後の活動から 10 秒未満は会話中とみなす", () => {
    const f = reduceFloor(initialFloor(0), { type: "user_speech_cancel" }, 0);
    expect(isConversationActive(f, 9_999)).toBe(true);
    expect(isConversationActive(f, 10_000)).toBe(false);
  });
});
