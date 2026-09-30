import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer, DEFAULT_PLAYBACK_RATE } from "./audio-player.ts";

class FakeAudioBufferSourceNode {
  buffer: unknown = null;
  playbackRate = { value: 1.0 };
  onended: (() => void) | null = null;
  startTime = 0;
  started = false;
  stopped = false;

  connect() {}
  disconnect() {}
  start(when: number) {
    this.started = true;
    this.startTime = when;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeAudioContext {
  state: "running" | "suspended" | "closed" = "running";
  currentTime = 0;
  destination = {};
  sampleRate = 24000;
  createdSources: FakeAudioBufferSourceNode[] = [];

  resume() {
    this.state = "running";
    return Promise.resolve();
  }

  close() {
    this.state = "closed";
    return Promise.resolve();
  }

  createBuffer(_channels: number, length: number, sampleRate: number) {
    return {
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }

  createBufferSource() {
    const node = new FakeAudioBufferSourceNode();
    this.createdSources.push(node);
    return node;
  }
}

describe("AudioPlayer", () => {
  const originalAudioContext = globalThis.AudioContext;

  beforeEach(() => {
    // @ts-expect-error test mock
    globalThis.AudioContext = FakeAudioContext;
  });

  afterEach(() => {
    globalThis.AudioContext = originalAudioContext;
    vi.restoreAllMocks();
  });

  it("デフォルトで DEFAULT_PLAYBACK_RATE (1.15) が設定される", () => {
    const player = new AudioPlayer();
    expect(player.playbackRate).toBe(DEFAULT_PLAYBACK_RATE);
    expect(player.playbackRate).toBe(1.15);
  });

  it("指定した playbackRate が反映される", () => {
    const player = new AudioPlayer(undefined, 1.25);
    expect(player.playbackRate).toBe(1.25);
  });

  it("queueAudioChunk で playbackRate が source に設定され、chunkDuration が rate で割られる", () => {
    const onPlaying = vi.fn();
    const player = new AudioPlayer(onPlaying, 1.2);

    // 16bit mono 24000Hz で 2400 サンプル（0.1 秒分）のダミー PCM
    const dummyBytes = new Uint8Array(2400 * 2);
    const base64Chunk = btoa(String.fromCharCode(...dummyBytes));

    player.queueAudioChunk(base64Chunk);

    expect(player.playing).toBe(true);
    expect(onPlaying).toHaveBeenCalledWith(true);

    // AudioContext 内で作成された source を検証
    // @ts-expect-error accessing private property for test verification
    const ctx = player.audioContext as FakeAudioContext;
    expect(ctx.createdSources).toHaveLength(1);
    const source = ctx.createdSources[0]!;
    expect(source.playbackRate.value).toBe(1.2);
    expect(source.started).toBe(true);
  });
});
