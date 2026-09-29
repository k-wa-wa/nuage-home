/**
 * サンドボックスの擬似読み上げ。
 * Live の発話テキストを一定の速さで表示し、音声再生と同じく再生状態（playing）を通知する。
 * 実際の音声と同様に、Live のターンが終わっても表示し終えるまでは「再生中」とする。
 */

export interface SpeechView {
  /** 新しい発話を開始し、表示先を返す */
  begin(): SpeechBubble;
  /** 無言で終わったターンを表示する */
  silentTurn(): void;
}

export interface SpeechBubble {
  append(text: string): void;
  markInterrupted(): void;
}

export interface TypedSpeechOptions {
  view: SpeechView;
  onPlaying: (playing: boolean) => void;
  /** 1 秒あたりに表示する文字数 */
  charsPerSecond: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export class TypedSpeech {
  private bubble: SpeechBubble | null = null;
  private pending = "";
  private turnDone = false;
  private playing = false;
  /** 割り込んだターンの残りを捨てている最中か */
  private discarding = false;
  private timer: unknown = null;
  private readonly opts: TypedSpeechOptions;

  constructor(opts: TypedSpeechOptions) {
    this.opts = opts;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  onModelText(text: string): void {
    if (this.discarding) return;
    if (!this.bubble) {
      this.bubble = this.opts.view.begin();
      this.turnDone = false;
    }
    this.pending += text;
    if (!this.playing) {
      this.playing = true;
      this.opts.onPlaying(true);
    }
    this.schedule();
  }

  onTurnComplete(): void {
    if (this.discarding) {
      this.discarding = false;
      return;
    }
    if (!this.bubble) {
      this.opts.view.silentTurn();
      return;
    }
    this.turnDone = true;
    if (!this.pending) this.finish();
  }

  /** ユーザーが話し始めたら読み上げを止める（barge-in） */
  bargeIn(): void {
    if (!this.bubble) return;
    this.stopTimer();
    this.bubble.markInterrupted();
    this.discarding = !this.turnDone;
    this.pending = "";
    this.finish();
  }

  /** 接続し直すときに、表示途中の発話や破棄中の状態を捨てて初期状態に戻す */
  reset(): void {
    this.stopTimer();
    this.bubble = null;
    this.pending = "";
    this.turnDone = false;
    this.discarding = false;
    this.playing = false;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    const set = this.opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = set(() => {
      this.timer = null;
      this.step();
    }, 1000 / Math.max(1, this.opts.charsPerSecond()));
  }

  private step(): void {
    if (!this.bubble) return;
    const [ch, ...rest] = Array.from(this.pending);
    if (ch !== undefined) {
      this.bubble.append(ch);
      this.pending = rest.join("");
    }
    if (this.pending) {
      this.schedule();
    } else if (this.turnDone) {
      this.finish();
    }
  }

  private finish(): void {
    this.bubble = null;
    this.turnDone = false;
    if (this.playing) {
      this.playing = false;
      this.opts.onPlaying(false);
    }
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    const clear =
      this.opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    clear(this.timer);
    this.timer = null;
  }
}
