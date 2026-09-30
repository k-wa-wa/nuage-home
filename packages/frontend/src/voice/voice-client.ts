import type {
  ConversationClientMessage,
  ConversationServerMessage,
  FloorStateName,
  Notification,
  Task,
} from "@nuage-home/shared";
import { AudioPlayer } from "./audio-player.ts";
import { AudioRecorder } from "./audio-recorder.ts";

export type VoiceState = "stopped" | "connecting" | "listening" | "thinking" | "speaking";

export interface VoiceClientCallbacks {
  onStateChange(state: VoiceState): void;
  /** Live の発話の書き起こし（断片） */
  onModelText(text: string): void;
  onModelTurnComplete(): void;
  /** Gemini が聞き取ったユーザーの発話（断片） */
  onUserTranscript(text: string): void;
  onUserSpeaking(speaking: boolean): void;
  onTask(task: Task): void;
  onNotification(notification: Notification): void;
  onFloor(state: FloorStateName): void;
  onError(err: Error): void;
}

/**
 * 音声モードのクライアント。マイク（VAD）・スピーカーと backend の会話（/ws/live）をつなぐ。
 * いつ何を話すかの判断は backend が行い、ここは音声の入出力と状態の中継に徹する。
 */
export class VoiceClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly recorder: AudioRecorder;
  private readonly player: AudioPlayer;
  private running = false;
  private thinking = false;
  /** Live のターンの途中（音声を受け取り始めて、turn_complete が来ていない） */
  private modelTurnActive = false;
  /** 割り込んだターンの残りの音声を捨てている最中か */
  private discarding = false;
  private readonly url: string;
  private readonly cb: VoiceClientCallbacks;

  constructor(url: string, callbacks: VoiceClientCallbacks) {
    this.url = url;
    this.cb = callbacks;

    this.recorder = new AudioRecorder({
      onAudioChunk: (data) => this.send({ type: "user_audio", data }),
      onSpeechStart: () => {
        if (!this.running) return;
        // 発話開始を先に伝えてから再生を止める。逆順だと、遮られた通知が「伝達済み」と判定される
        this.send({ type: "speech_start" });
        this.player.interrupt();
        // 割り込んだターンの残りの音声が後から届いても再生しない
        this.discarding = this.modelTurnActive;
        this.thinking = false;
        this.cb.onUserSpeaking(true);
        this.cb.onStateChange("listening");
      },
      onSpeechCancel: () => {
        if (!this.running) return;
        this.send({ type: "speech_cancel" });
        this.cb.onUserSpeaking(false);
        this.cb.onStateChange("listening");
      },
      onSpeechEnd: () => {
        if (!this.running) return;
        this.send({ type: "user_audio_end" });
        this.cb.onUserSpeaking(false);
        this.thinking = true;
        this.cb.onStateChange("thinking");
      },
    });

    this.player = new AudioPlayer((playing) => {
      // backend の発言権（Floor）管理は、生成完了ではなく再生状態で Live の発話終了を判定する
      this.send({ type: "playback_state", playing });
      if (playing) {
        this.cb.onStateChange("speaking");
      } else if (this.running) {
        if (!this.thinking) this.cb.onStateChange("listening");
      } else {
        this.cb.onStateChange("stopped");
      }
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** WebSocket を接続し、タスクや通知の常時同期を開始する */
  connect(): void {
    if (this.ws) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.sendLocation();
      if (this.running) {
        this.send({ type: "voice_start" });
      }
    };

    ws.onmessage = (event) => {
      try {
        this.handle(JSON.parse(String(event.data)) as ConversationServerMessage);
      } catch (err) {
        console.error("[VoiceClient] メッセージのパースに失敗:", err);
      }
    };

    ws.onerror = () => {
      // エラー時は onclose で再接続処理
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.running) {
        this.stop(new Error(`切断された (${event.code} ${event.reason})`));
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cb.onStateChange("connecting");

    if (!navigator.mediaDevices?.getUserMedia) {
      this.stop(
        new Error("マイク（getUserMedia）が使えない。localhost か HTTPS で開く必要がある。"),
      );
      return;
    }

    // ユーザー操作の直下でマイクと再生コンテキストを初期化する
    try {
      await this.player.warmup();
      await this.recorder.start();
    } catch (err) {
      this.stop(new Error(`マイクの起動に失敗した: ${String(err)}`));
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
    } else {
      this.send({ type: "voice_start" });
    }
  }

  private sendLocation(): void {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.send({
            type: "client_context",
            location: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            },
          });
        },
        () => {
          // 位置情報の取得拒否または失敗時は何もしない
        },
        { timeout: 5000, maximumAge: 300_000 },
      );
    }
  }

  stop(error?: Error): void {
    const wasRunning = this.running;
    this.running = false;
    this.thinking = false;
    this.modelTurnActive = false;
    this.discarding = false;
    this.recorder.stop();
    this.player.interrupt();

    if (wasRunning) {
      this.send({ type: "voice_stop" });
    }

    if (error) this.cb.onError(error);
    else this.cb.onStateChange("stopped");
  }

  toggle(): void {
    if (this.running) this.stop();
    else
      this.start().catch((err) => this.stop(err instanceof Error ? err : new Error(String(err))));
  }

  private handle(msg: ConversationServerMessage): void {
    switch (msg.type) {
      case "ready":
        return;
      case "voice_ready":
        if (this.running) this.cb.onStateChange("listening");
        return;
      case "voice_stopped":
        if (this.running) this.stop();
        return;
      case "model_audio":
        this.modelTurnActive = true;
        if (this.discarding) return;
        this.thinking = false;
        this.player.queueAudioChunk(msg.data);
        return;
      case "model_text":
        if (!this.discarding) this.cb.onModelText(msg.text);
        return;
      case "model_turn_complete":
        this.modelTurnActive = false;
        this.discarding = false;
        this.thinking = false;
        this.cb.onModelTurnComplete();
        if (!this.player.playing) {
          this.cb.onStateChange(this.running ? "listening" : "stopped");
        }
        return;
      case "user_transcript":
        this.cb.onUserTranscript(msg.text);
        return;
      case "interrupted":
        this.player.interrupt();
        return;
      case "floor":
        this.cb.onFloor(msg.state);
        return;
      case "task_update":
        this.cb.onTask(msg.task);
        return;
      case "notification_update":
        this.cb.onNotification(msg.notification);
        return;
      case "error":
        if (this.running) {
          this.cb.onError(new Error(msg.message));
        }
        return;
      // 音声モードでは使わない
      case "live_io":
      case "reset_done":
        return;
    }
  }

  private send(msg: ConversationClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
