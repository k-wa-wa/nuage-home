import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";

export type GestureType = "Pinch_Index" | "Pinch_Middle";

export interface GestureState {
  /** 手が画面内で検出されているか */
  hasHand: boolean;
  /** 指先先端の現在座標（0.0〜1.0、鏡像反転済み） */
  handX: number;
  handY: number;

  /** 親指と人差し指の距離比率（0.0〜2.0、小さいほど接触） */
  indexPinchRatio: number;
  /** 親指と中指の距離比率（0.0〜2.0） */
  middlePinchRatio: number;
  /** 親指と人差し指が現在ピンチ中か */
  isPinchingIndex: boolean;
  /** 親指と中指が現在ピンチ中か */
  isPinchingMiddle: boolean;

  /** 直近で検出されたジェスチャー動作 */
  lastGesture: GestureType | null;
  /** 直近でジェスチャーが検出された時刻（timestamp） */
  lastGestureTime: number;
}

export interface GestureDetectorOptions {
  /** 判定間隔（ミリ秒）。微小な指タップを確実に拾うため既定 40ms（約 25fps） */
  intervalMs?: number;
  /** 最小信頼度スコア（0.0〜1.0）。既定 0.4 */
  minConfidence?: number;
  /** ピンチ検出後の再検出抑制クールダウン時間（ミリ秒）。既定 350ms */
  gestureCooldownMs?: number;
}

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const MODEL_ASSET_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

export function getGestureEmoji(gesture: GestureType | string): string {
  switch (gesture) {
    case "Pinch_Index":
      return "👌";
    case "Pinch_Middle":
      return "✌️";
    default:
      return "👋";
  }
}

export function getGestureLabel(gesture: GestureType | string): string {
  switch (gesture) {
    case "Pinch_Index":
      return "親指＋人差し指ピンチ (閉じる / 決定)";
    case "Pinch_Middle":
      return "親指＋中指ピンチ (開く)";
    default:
      return String(gesture);
  }
}

/**
 * Webカメラと MediaPipe を使用し、
 * 親指と人差し指／中指による「ピンチ（Air Tap）」マイクロジェスチャーを高精度・低遅延に検出するクラス。
 * 上払いやスワイプなどの誤検知要因を排除し、微小な指先接触のみを確実に判定する。
 */
export class GestureDetector {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private ownsVideo = false;
  private recognizer: GestureRecognizer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  private readonly intervalMs: number;
  private readonly minConfidence: number;
  private readonly gestureCooldownMs: number;

  private lastGestureTime = 0;
  private lastGesture: GestureType | null = null;

  // 意図しない初期接触（カメラに入った瞬間）での誤検知を防ぐオープン確認フラグ
  private canPinchIndex = false;
  private canPinchMiddle = false;
  private isPinchingIndex = false;
  private isPinchingMiddle = false;

  private state: GestureState = {
    hasHand: false,
    handX: 0.5,
    handY: 0.5,
    indexPinchRatio: 1.0,
    middlePinchRatio: 1.0,
    isPinchingIndex: false,
    isPinchingMiddle: false,
    lastGesture: null,
    lastGestureTime: 0,
  };

  private listeners: Set<(state: GestureState) => void> = new Set();
  private gestureListeners: Set<(gesture: GestureType) => void> = new Set();

  constructor(options: GestureDetectorOptions = {}) {
    this.intervalMs = options.intervalMs ?? 40;
    this.minConfidence = options.minConfidence ?? 0.4;
    this.gestureCooldownMs = options.gestureCooldownMs ?? 350;
  }

  /**
   * ジェスチャー認識を開始する。
   * 既存の HTMLVideoElement を渡すことでカメラストリームを共有可能。
   */
  async start(existingVideo?: HTMLVideoElement): Promise<void> {
    if (this.isRunning) return;

    try {
      if (existingVideo) {
        this.video = existingVideo;
        this.ownsVideo = false;
      } else {
        this.ownsVideo = true;
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
          },
          audio: false,
        });

        this.video = document.createElement("video");
        this.video.srcObject = this.stream;
        this.video.autoplay = true;
        this.video.playsInline = true;
        this.video.muted = true;
      }

      if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise<void>((resolve, reject) => {
          if (!this.video) return reject(new Error("Video element missing"));
          const onLoaded = () => {
            this.video?.removeEventListener("loadeddata", onLoaded);
            this.video?.removeEventListener("error", onError);
            resolve();
          };
          const onError = (e: Event) => {
            this.video?.removeEventListener("loadeddata", onLoaded);
            this.video?.removeEventListener("error", onError);
            reject(new Error(`Failed to load video: ${(e as ErrorEvent).message}`));
          };
          this.video.addEventListener("loadeddata", onLoaded);
          this.video.addEventListener("error", onError);
        });
      }

      await this.video.play().catch(() => {});

      const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
      this.recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_ASSET_URL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1, // マイクロジェスチャーは片手で十分かつ超低負荷
        minHandDetectionConfidence: this.minConfidence,
        minHandPresenceConfidence: this.minConfidence,
        minTrackingConfidence: this.minConfidence,
      });

      this.isRunning = true;

      this.timer = setInterval(() => {
        this.detect();
      }, this.intervalMs);
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ownsVideo) {
      if (this.stream) {
        for (const track of this.stream.getTracks()) {
          track.stop();
        }
        this.stream = null;
      }
      if (this.video) {
        this.video.srcObject = null;
        this.video = null;
      }
    } else {
      this.video = null;
    }

    this.canPinchIndex = false;
    this.canPinchMiddle = false;
    this.isPinchingIndex = false;
    this.isPinchingMiddle = false;
    this.state = {
      hasHand: false,
      handX: 0.5,
      handY: 0.5,
      indexPinchRatio: 1.0,
      middlePinchRatio: 1.0,
      isPinchingIndex: false,
      isPinchingMiddle: false,
      lastGesture: null,
      lastGestureTime: 0,
    };
    this.notifyState();
  }

  private detect(): void {
    if (!this.isRunning || !this.video || !this.recognizer) return;
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    try {
      const now = performance.now();
      const result = this.recognizer.recognizeForVideo(this.video, now);

      let hasHand = false;
      let handX = this.state.handX;
      let handY = this.state.handY;
      let indexPinchRatio = 1.0;
      let middlePinchRatio = 1.0;

      if (result.landmarks && result.landmarks.length > 0 && result.landmarks[0]) {
        hasHand = true;
        const landmarks = result.landmarks[0];
        const wrist = landmarks[0];
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const middleTip = landmarks[12];
        const middleMcp = landmarks[9];

        // 手のひらの不変骨格スケール（手首〜中指付け根。指の開閉で変わらない基準長）
        const palmSize = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y);
        const handScale = Math.max(palmSize, 0.08);

        // 指先座標（鏡像反転）
        handX = Math.round((1 - indexTip.x) * 100) / 100;
        handY = Math.round(indexTip.y * 100) / 100;

        // 1. 親指と人差し指の距離比率（正規化）
        const rawDistIndex = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
        indexPinchRatio = Math.round((rawDistIndex / handScale) * 100) / 100;

        // 2. 親指と中指の距離比率（正規化）
        const rawDistMiddle = Math.hypot(thumbTip.x - middleTip.x, thumbTip.y - middleTip.y);
        middlePinchRatio = Math.round((rawDistMiddle / handScale) * 100) / 100;

        // --- 人差し指ピンチ判定（開始: <= 0.24, 解除: >= 0.38）---
        let newlyPinchedIndex = false;
        if (!this.canPinchIndex) {
          // 最初は手を開いていること（>= 0.36）を確認してトリガー許可（カメラ進入時の誤爆防止）
          if (indexPinchRatio >= 0.36) {
            this.canPinchIndex = true;
          }
        } else {
          if (!this.isPinchingIndex && indexPinchRatio <= 0.24) {
            this.isPinchingIndex = true;
            newlyPinchedIndex = true;
          } else if (this.isPinchingIndex && indexPinchRatio >= 0.38) {
            this.isPinchingIndex = false;
          }
        }

        // --- 中指ピンチ判定（開始: <= 0.24, 解除: >= 0.38）---
        let newlyPinchedMiddle = false;
        if (!this.canPinchMiddle) {
          if (middlePinchRatio >= 0.36) {
            this.canPinchMiddle = true;
          }
        } else {
          if (!this.isPinchingMiddle && middlePinchRatio <= 0.24) {
            this.isPinchingMiddle = true;
            newlyPinchedMiddle = true;
          } else if (this.isPinchingMiddle && middlePinchRatio >= 0.38) {
            this.isPinchingMiddle = false;
          }
        }

        // ジェスチャー発火判定（クールダウン制御）
        const timeSinceLast = now - this.lastGestureTime;
        if (timeSinceLast >= this.gestureCooldownMs) {
          if (newlyPinchedIndex) {
            this.triggerGesture("Pinch_Index", now);
          } else if (newlyPinchedMiddle) {
            this.triggerGesture("Pinch_Middle", now);
          }
        }
      } else {
        // 手が見失われた場合は状態リセット
        this.canPinchIndex = false;
        this.canPinchMiddle = false;
        this.isPinchingIndex = false;
        this.isPinchingMiddle = false;
      }

      this.state = {
        hasHand,
        handX,
        handY,
        indexPinchRatio,
        middlePinchRatio,
        isPinchingIndex: this.isPinchingIndex,
        isPinchingMiddle: this.isPinchingMiddle,
        lastGesture: this.lastGesture,
        lastGestureTime: this.lastGestureTime,
      };

      this.notifyState();
    } catch (err) {
      console.warn("[GestureDetector] 検出エラー:", err);
    }
  }

  private triggerGesture(gesture: GestureType, now: number): void {
    this.lastGesture = gesture;
    this.lastGestureTime = now;
    for (const listener of this.gestureListeners) {
      listener(gesture);
    }
  }

  /**
   * ジェスチャー（ピンチ）発火時のリスナーを登録する。
   */
  onGesture(listener: (gesture: GestureType) => void): () => void {
    this.gestureListeners.add(listener);
    return () => {
      this.gestureListeners.delete(listener);
    };
  }

  onStateChange(listener: (state: GestureState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): GestureState {
    return this.state;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  private notifyState(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
