import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSpeechRecognizer } from "./web-speech-recognition.ts";

/** Chrome と同じく、開始済み（停止処理中を含む）で start() すると InvalidStateError を投げるフェイク */
class FakeRecognition {
  static last: FakeRecognition;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  started = false;
  startCount = 0;

  constructor() {
    FakeRecognition.last = this;
  }

  start() {
    if (this.started)
      throw new DOMException("recognition has already started", "InvalidStateError");
    this.started = true;
    this.startCount++;
  }

  stop() {}

  /** 停止完了（onend 発火）をシミュレートする */
  end() {
    this.started = false;
    this.onend?.();
  }

  emitResult(transcript: string, isFinal: boolean) {
    const result = Object.assign([{ transcript }], { isFinal });
    this.onresult?.({ results: [result] });
  }
}

beforeEach(() => {
  vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebSpeechRecognizer", () => {
  it("途中結果と確定結果を振り分ける", () => {
    const recognizer = new WebSpeechRecognizer("ja-JP");
    const onFinal = vi.fn();
    const onInterim = vi.fn();
    recognizer.onFinal = onFinal;
    recognizer.onInterim = onInterim;

    FakeRecognition.last.emitResult(" こんに ", false);
    FakeRecognition.last.emitResult(" こんにちは ", true);

    expect(onInterim.mock.calls).toEqual([["こんに"], [""]]);
    expect(onFinal).toHaveBeenCalledWith("こんにちは");
  });

  it("無音でセッションが終わっても自動で再開する", () => {
    const recognizer = new WebSpeechRecognizer("ja-JP");
    const onListeningChange = vi.fn();
    recognizer.onListeningChange = onListeningChange;
    recognizer.start();

    FakeRecognition.last.end();

    expect(FakeRecognition.last.startCount).toBe(2);
    expect(onListeningChange.mock.calls).toEqual([[true], [false], [true]]);
  });

  it("認識中に resume しても例外を投げない（suspend せずに応答が失敗した場合）", () => {
    const recognizer = new WebSpeechRecognizer("ja-JP");
    recognizer.start();

    expect(() => recognizer.resume()).not.toThrow();
    expect(FakeRecognition.last.started).toBe(true);
  });

  it("停止処理中に resume しても例外を投げず、停止完了後に再開する", () => {
    const recognizer = new WebSpeechRecognizer("ja-JP");
    recognizer.start();
    recognizer.suspend();

    expect(() => recognizer.resume()).not.toThrow();
    FakeRecognition.last.end();

    expect(FakeRecognition.last.started).toBe(true);
  });

  it("読み上げ中（suspend 中）はセッションが終わっても再開しない", () => {
    const recognizer = new WebSpeechRecognizer("ja-JP");
    recognizer.start();
    recognizer.suspend();

    FakeRecognition.last.end();

    expect(FakeRecognition.last.started).toBe(false);
  });

  it("非対応ブラウザでは生成時にエラーにする", () => {
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    expect(() => new WebSpeechRecognizer("ja-JP")).toThrow("not supported");
  });
});
