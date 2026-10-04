import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export interface LookDetectorOptions {
  /** 判定間隔（ミリ秒）。既定 120ms（約 8fps） */
  intervalMs?: number;
  /** 正面とみなす左右の首振り許容角（度）。既定 22度 */
  maxYawDeg?: number;
  /** 正面とみなす上下の首振り許容角（度）。既定 20度 */
  maxPitchDeg?: number;
  /** 画面から視線が外れても「見ている」とみなす継続猶予（ミリ秒）。既定 800ms */
  attentionGraceMs?: number;
}

export interface LookState {
  /** 画面を見ているか（ヒステリシス込み） */
  isLooking: boolean;
  /** 現在のフレームで正面を向いているか */
  rawLooking: boolean;
  /** 顔が検出されているか */
  faceDetected: boolean;
  /** 推定 Yaw（度、正: 右向き、負: 左向き） */
  yawDeg: number;
  /** 推定 Pitch（度、正: 下向き、負: 上向き） */
  pitchDeg: number;
  /** 最後に正面を向いた時刻（タイムスタンプ） */
  lastLookingTime: number;
}

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const MODEL_ASSET_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/**
 * Webカメラと MediaPipe FaceLandmarker を使用し、
 * ユーザーが画面（カメラ）に顔・視線を向けているか（Attention）をローカルで判定する検出器。
 */
export class LookDetector {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private landmarker: FaceLandmarker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  private readonly intervalMs: number;
  private readonly maxYawDeg: number;
  private readonly maxPitchDeg: number;
  private readonly attentionGraceMs: number;

  private state: LookState = {
    isLooking: false,
    rawLooking: false,
    faceDetected: false,
    yawDeg: 0,
    pitchDeg: 0,
    lastLookingTime: 0,
  };

  private listeners: ((state: LookState) => void)[] = [];
  private attentionListeners: ((looking: boolean) => void)[] = [];

  constructor(options: LookDetectorOptions = {}) {
    this.intervalMs = options.intervalMs ?? 120;
    this.maxYawDeg = options.maxYawDeg ?? 22;
    this.maxPitchDeg = options.maxPitchDeg ?? 20;
    this.attentionGraceMs = options.attentionGraceMs ?? 800;
  }

  private bypassUntil = 0;

  getState(): LookState {
    return this.state;
  }

  /**
   * 手動操作（オーブタップ等）時に、一定時間視線判定をバイパスして強制的に注意ありとする
   */
  bypassAttention(durationMs = 8000): void {
    this.bypassUntil = Date.now() + durationMs;
    this.notifyAttention(true);
  }

  /**
   * 画面を見ているか、または直近の猶予時間内に見ていたかを判定する
   */
  isLookingAtScreen(): boolean {
    if (Date.now() < this.bypassUntil) return true;
    if (this.state.rawLooking) return true;
    if (this.state.lastLookingTime === 0) return false;
    return Date.now() - this.state.lastLookingTime <= this.attentionGraceMs;
  }

  onStateChange(cb: (state: LookState) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  onAttentionChange(cb: (looking: boolean) => void): () => void {
    this.attentionListeners.push(cb);
    return () => {
      this.attentionListeners = this.attentionListeners.filter((l) => l !== cb);
    };
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.video;
  }

  async start(existingStream?: MediaStream): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // 1. カメラストリームの取得（引数にあればそれを使用）
      if (existingStream) {
        this.stream = existingStream;
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 320 },
            height: { ideal: 240 },
            frameRate: { ideal: 10, max: 15 },
          },
        });
      }

      // 2. 解析用非表示ビデオの生成
      const video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = this.stream;
      await video.play();
      this.video = video;

      // 3. MediaPipe FaceLandmarker の初期化（初回のみ）
      if (!this.landmarker) {
        const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
        this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: MODEL_ASSET_URL,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFacialTransformationMatrixes: true,
        });
      }

      // 4. 定期検出ループの開始
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

    const prevLooking = this.state.isLooking;
    this.state = {
      isLooking: false,
      rawLooking: false,
      faceDetected: false,
      yawDeg: 0,
      pitchDeg: 0,
      lastLookingTime: 0,
    };

    if (prevLooking) {
      this.notifyAttention(false);
    }
    this.notifyState();
  }

  private detect(): void {
    if (!this.isRunning || !this.video || !this.landmarker) return;
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    try {
      const now = performance.now();
      const result = this.landmarker.detectForVideo(this.video, now);

      let faceDetected = false;
      let rawLooking = false;
      let yawDeg = 0;
      let pitchDeg = 0;

      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        faceDetected = true;
        const landmarks = result.faceLandmarks[0];

        // ランドマーク幾何による角度推定
        // 1: 鼻先, 168: 眉間, 152: あご, 234: 右顔輪郭(画面左), 454: 左顔輪郭(画面右)
        const nose = landmarks[1];
        const rightCheek = landmarks[234];
        const leftCheek = landmarks[454];
        const glabella = landmarks[168];
        const chin = landmarks[152];

        if (nose && rightCheek && leftCheek && glabella && chin) {
          // 左右の顔幅
          const faceWidth = Math.abs(leftCheek.x - rightCheek.x);
          // 顔の中心線
          const midX = (leftCheek.x + rightCheek.x) / 2;
          // 鼻先の中心からのズレ比率（-0.5〜0.5）
          const yawRatio = faceWidth > 0 ? (nose.x - midX) / faceWidth : 0;
          // ズレ比率を度数に変換（概算）
          yawDeg = Math.round(yawRatio * 90);

          // 上下の顔の高さ
          const faceHeight = Math.abs(chin.y - glabella.y);
          const midY = (chin.y + glabella.y) / 2;
          const pitchRatio = faceHeight > 0 ? (nose.y - midY) / faceHeight : 0;
          pitchDeg = Math.round(pitchRatio * 90);

          // 正面向きの判定
          rawLooking = Math.abs(yawDeg) <= this.maxYawDeg && Math.abs(pitchDeg) <= this.maxPitchDeg;
        }

        // 行列が取得できる場合は補正
        const matrix = result.facialTransformationMatrixes?.[0];
        if (matrix?.data && matrix.data.length >= 16) {
          const m = matrix.data;
          // column-major または row-major から回転角を抽出
          // m[0]=r00, m[1]=r10, m[2]=r20, m[4]=r01, m[5]=r11, m[6]=r21, m[8]=r02, m[9]=r12, m[10]=r22
          const rotYaw = Math.atan2(m[2], m[10]) * (180 / Math.PI);
          const rotPitch = -Math.asin(Math.max(-1, Math.min(1, m[6]))) * (180 / Math.PI);
          if (!Number.isNaN(rotYaw) && !Number.isNaN(rotPitch)) {
            // 幾何計算と回転行列の平均でロバストにする
            yawDeg = Math.round((yawDeg + rotYaw) / 2);
            pitchDeg = Math.round((pitchDeg + rotPitch) / 2);
            rawLooking =
              Math.abs(yawDeg) <= this.maxYawDeg && Math.abs(pitchDeg) <= this.maxPitchDeg;
          }
        }
      }

      const currentTime = Date.now();
      if (rawLooking) {
        this.state.lastLookingTime = currentTime;
      }

      const isLooking =
        rawLooking ||
        (this.state.lastLookingTime > 0 &&
          currentTime - this.state.lastLookingTime <= this.attentionGraceMs);

      const prevLooking = this.state.isLooking;
      this.state = {
        isLooking,
        rawLooking,
        faceDetected,
        yawDeg,
        pitchDeg,
        lastLookingTime: this.state.lastLookingTime,
      };

      if (prevLooking !== isLooking) {
        this.notifyAttention(isLooking);
      }
      this.notifyState();
    } catch (err) {
      console.warn("[LookDetector] 検出エラー:", err);
    }
  }

  private notifyState(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private notifyAttention(looking: boolean): void {
    for (const listener of this.attentionListeners) {
      listener(looking);
    }
  }
}
