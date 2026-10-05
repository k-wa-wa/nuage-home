/**
 * カメラ視線検証用の Web Audio 音源モジュール。
 * 画面を向いているときは音を出し、向いていないときは瞬時にミュートする。
 */

export type SoundType = "chord" | "sine" | "pulse";

export class TestSoundPlayer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private soundGain: GainNode | null = null;
  private isRunning = false;
  private currentVolume = 0.15;
  private soundType: SoundType = "chord";
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeNodes: AudioNode[] = [];

  /**
   * オーディオコンテキストの初期化・再生開始
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtx();
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }

    // マスターゲイン（音量調整用）
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.currentVolume, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    // ミュート制御用ゲイン（初期状態はミュート: 0）
    this.soundGain = this.ctx.createGain();
    this.soundGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.soundGain.connect(this.masterGain);

    this.isRunning = true;
    this.startSoundSource();
  }

  /**
   * 停止とリソース開放
   */
  stop(): void {
    this.stopSoundSource();
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    if (this.soundGain) {
      this.soundGain.disconnect();
      this.soundGain = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.isRunning = false;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 視線判定結果に応じてミュート/アンミュートを切り替える。
   * プチッというクリッピングノイズを防ぐため 30ms のスルーレートをかける。
   */
  setMuted(muted: boolean): void {
    if (!this.soundGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    const targetGain = muted ? 0 : 1;
    this.soundGain.gain.cancelScheduledValues(now);
    this.soundGain.gain.setValueAtTime(this.soundGain.gain.value, now);
    this.soundGain.gain.linearRampToValueAtTime(targetGain, now + 0.03);
  }

  setVolume(vol: number): void {
    this.currentVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.linearRampToValueAtTime(this.currentVolume, now + 0.02);
    }
  }

  setSoundType(type: SoundType): void {
    if (this.soundType === type) return;
    this.soundType = type;
    if (this.isRunning) {
      this.stopSoundSource();
      this.startSoundSource();
    }
  }

  private startSoundSource(): void {
    if (!this.ctx || !this.soundGain) return;

    if (this.soundType === "sine") {
      // 澄んだ 440Hz（ラ音）サイン波
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, this.ctx.currentTime);
      osc.connect(this.soundGain);
      osc.start();
      this.activeNodes.push(osc);
    } else if (this.soundType === "pulse") {
      // ピッ、ピッ、ピッというパルストーン（250ms ごと）
      let tick = false;
      const interval = setInterval(() => {
        if (!this.ctx || !this.soundGain) return;
        tick = !tick;
        const osc = this.ctx.createOscillator();
        const env = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(tick ? 880 : 660, this.ctx.currentTime);

        const now = this.ctx.currentTime;
        env.gain.setValueAtTime(0.8, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(env);
        env.connect(this.soundGain);
        osc.start(now);
        osc.stop(now + 0.09);
      }, 250);
      this.timer = interval;
    } else {
      // 心地よいペンタトニック・コード（C, E, G, B）の浮遊シンセ和音
      const freqs = [261.63, 329.63, 392.0, 493.88]; // C4, E4, G4, B4
      for (const f of freqs) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
        osc.connect(gain);
        gain.connect(this.soundGain);
        osc.start();
        this.activeNodes.push(osc);
      }
    }
  }

  private stopSoundSource(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const node of this.activeNodes) {
      if (node instanceof AudioScheduledSourceNode) {
        try {
          node.stop();
        } catch {
          // すでに停止している場合は無視
        }
      }
      try {
        node.disconnect();
      } catch {
        // すでに切断されている場合は無視
      }
    }
    this.activeNodes = [];
  }
}
