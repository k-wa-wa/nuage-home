// TS の DOM 型定義には SpeechRecognition 本体が無いため、使う範囲だけ定義する
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | undefined {
  const g = globalThis as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
}

/**
 * ブラウザの音声認識。音声モードで、話している途中の文字（interim）を即座に表示するためだけに使う。
 * 会話そのものの聞き取りは Gemini Live が行う。
 */
export class WebSpeechRecognizer {
  onFinal: (text: string) => void = () => {};
  onInterim: (text: string) => void = () => {};
  onListeningChange: (listening: boolean) => void = () => {};

  private recognition: Recognition;
  private active = false;
  private suspended = false;

  constructor(lang: string) {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      throw new Error("SpeechRecognition is not supported in this browser");
    }
    this.recognition = new Ctor();
    this.recognition.lang = lang;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;

    this.recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const text = last[0].transcript.trim();
      if (last.isFinal) {
        if (text) this.onFinal(text);
        this.onInterim("");
      } else {
        this.onInterim(text);
      }
    };

    // Chrome ends a session after a period of silence; restart to stay "always on".
    this.recognition.onend = () => {
      this.onListeningChange(false);
      if (this.active && !this.suspended) {
        this.startRecognition();
        this.onListeningChange(true);
      }
    };

    this.recognition.onerror = (event) => {
      // "no-speech" fires constantly during idle listening; not a real error.
      if (event.error !== "no-speech") {
        console.error("SpeechRecognition error", event.error);
      }
    };
  }

  start() {
    this.active = true;
    this.startRecognition();
    this.onListeningChange(true);
  }

  stop() {
    this.active = false;
    this.recognition.stop();
  }

  suspend() {
    this.suspended = true;
    this.recognition.stop();
  }

  resume() {
    this.suspended = false;
    if (this.active) this.startRecognition();
  }

  // 開始済み・停止処理中に start() すると InvalidStateError になる（例: 応答エラーで suspend せずに resume した時）。
  // その場合は認識が続いているか、停止完了時の onend で再開されるので無視してよい
  private startRecognition() {
    try {
      this.recognition.start();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "InvalidStateError")) throw err;
    }
  }
}
