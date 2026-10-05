import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export interface LookDetectorOptions {
  /** 判定間隔（ミリ秒）。既定 120ms（約 8fps） */
  intervalMs?: number;
  /** 正面とみなす左右の首振り許容角（度）。既定 14度（厳格化） */
  maxYawDeg?: number;
  /** 正面とみなす上下の首振り許容角（度）。既定 14度（厳格化） */
  maxPitchDeg?: number;
  /** 視線の水平方向ズレ許容比率（0〜1.0）。既定 0.28 */
  maxGazeOffsetX?: number;
  /** 視線の垂直方向ズレ許容比率（0〜1.0）。既定 0.32 */
  maxGazeOffsetY?: number;
  /** 画面から視線が外れても「見ている」とみなす継続猶予（ミリ秒）。既定 400ms（厳格化） */
  attentionGraceMs?: number;
}

export interface LookState {
  /** 画面を見ているか（ヒステリシス込み） */
  isLooking: boolean;
  /** 現在のフレームで正面を向いているか（顔向き & 目線の両方） */
  rawLooking: boolean;
  /** 顔が検出されているか */
  faceDetected: boolean;
  /** 推定 Yaw（度、正: 右向き、負: 左向き） */
  yawDeg: number;
  /** 推定 Pitch（度、正: 下向き、負: 上向き） */
  pitchDeg: number;
  /** 顔（頭部）の向きが正面か */
  headLooking: boolean;
  /** 瞳（黒目）の水平ズレ比率（-1.0〜+1.0、0が中央） */
  gazeX: number;
  /** 瞳（黒目）の垂直ズレ比率（-1.0〜+1.0、0が中央） */
  gazeY: number;
  /** 目線（黒目）が正面を向いているか */
  gazeLooking: boolean;
  /** 最後に正面を向いた時刻（タイムスタンプ） */
  lastLookingTime: number;
}

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const MODEL_ASSET_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/**
 * Webカメラと MediaPipe FaceLandmarker を使用し、
 * ユーザーが画面（カメラ）に顔・視線を向けているか（Attention）をローカルで判定する検出器。
 * 頭部の首振り角度（Yaw/Pitch）と瞳（Iris）の視線ズレの両方を複合して厳密に判定する。
 */
export class LookDetector {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private landmarker: FaceLandmarker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  private readonly intervalMs: number;
  private maxYawDeg: number;
  private maxPitchDeg: number;
  private maxGazeOffsetX: number;
  private maxGazeOffsetY: number;
  private attentionGraceMs: number;

  private state: LookState = {
    isLooking: false,
    rawLooking: false,
    faceDetected: false,
    yawDeg: 0,
    pitchDeg: 0,
    headLooking: false,
    gazeX: 0,
    gazeY: 0,
    gazeLooking: false,
    lastLookingTime: 0,
  };

  private listeners: ((state: LookState) => void)[] = [];
  private attentionListeners: ((looking: boolean) => void)[] = [];

  constructor(options: LookDetectorOptions = {}) {
    this.intervalMs = options.intervalMs ?? 120;
    this.maxYawDeg = options.maxYawDeg ?? 14;
    this.maxPitchDeg = options.maxPitchDeg ?? 14;
    this.maxGazeOffsetX = options.maxGazeOffsetX ?? 0.28;
    this.maxGazeOffsetY = options.maxGazeOffsetY ?? 0.32;
    this.attentionGraceMs = options.attentionGraceMs ?? 400;
  }

  /**
   * 判定閾値を動的に変更する（検証ページや設定画面用）
   */
  setThresholds(options: Partial<LookDetectorOptions>): void {
    if (options.maxYawDeg !== undefined) this.maxYawDeg = options.maxYawDeg;
    if (options.maxPitchDeg !== undefined) this.maxPitchDeg = options.maxPitchDeg;
    if (options.maxGazeOffsetX !== undefined) this.maxGazeOffsetX = options.maxGazeOffsetX;
    if (options.maxGazeOffsetY !== undefined) this.maxGazeOffsetY = options.maxGazeOffsetY;
    if (options.attentionGraceMs !== undefined) this.attentionGraceMs = options.attentionGraceMs;
  }

  getThresholds(): Required<Omit<LookDetectorOptions, "intervalMs">> {
    return {
      maxYawDeg: this.maxYawDeg,
      maxPitchDeg: this.maxPitchDeg,
      maxGazeOffsetX: this.maxGazeOffsetX,
      maxGazeOffsetY: this.maxGazeOffsetY,
      attentionGraceMs: this.attentionGraceMs,
    };
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
      headLooking: false,
      gazeX: 0,
      gazeY: 0,
      gazeLooking: false,
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
      let headLooking = false;
      let gazeLooking = false;
      let yawDeg = 0;
      let pitchDeg = 0;
      let gazeX = 0;
      let gazeY = 0;

      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        faceDetected = true;
        const landmarks = result.faceLandmarks[0];

        // 1. ランドマーク幾何による頭部角度推定
        // 1: 鼻先, 168: 眉間, 152: あご, 234: 右顔輪郭(画面左), 454: 左顔輪郭(画面右)
        const nose = landmarks[1];
        const rightCheek = landmarks[234];
        const leftCheek = landmarks[454];
        const glabella = landmarks[168];
        const chin = landmarks[152];

        if (nose && rightCheek && leftCheek && glabella && chin) {
          const faceWidth = Math.abs(leftCheek.x - rightCheek.x);
          const midX = (leftCheek.x + rightCheek.x) / 2;
          const yawRatio = faceWidth > 0 ? (nose.x - midX) / faceWidth : 0;
          yawDeg = Math.round(yawRatio * 90);

          const faceHeight = Math.abs(chin.y - glabella.y);
          const midY = (chin.y + glabella.y) / 2;
          const pitchRatio = faceHeight > 0 ? (nose.y - midY) / faceHeight : 0;
          pitchDeg = Math.round(pitchRatio * 90);
        }

        // 行列が取得できる場合は回転角を補正
        const matrix = result.facialTransformationMatrixes?.[0];
        if (matrix?.data && matrix.data.length >= 16) {
          const m = matrix.data;
          const rotYaw = Math.atan2(m[2], m[10]) * (180 / Math.PI);
          const rotPitch = -Math.asin(Math.max(-1, Math.min(1, m[6]))) * (180 / Math.PI);
          if (!Number.isNaN(rotYaw) && !Number.isNaN(rotPitch)) {
            yawDeg = Math.round((yawDeg + rotYaw) / 2);
            pitchDeg = Math.round((pitchDeg + rotPitch) / 2);
          }
        }

        headLooking = Math.abs(yawDeg) <= this.maxYawDeg && Math.abs(pitchDeg) <= this.maxPitchDeg;

        // 2. 虹彩（Iris）ランドマークによる目線判定
        // 468: 右目虹彩中心, 33: 右目尻(外), 133: 右目頭(内), 159: 右上まぶた, 145: 右下まぶた
        // 473: 左目虹彩中心, 362: 左目頭(内), 263: 左目尻(外), 386: 左上まぶた, 374: 左下まぶた
        const irisR = landmarks[468];
        const irisL = landmarks[473];
        const outerR = landmarks[33];
        const innerR = landmarks[133];
        const topR = landmarks[159];
        const bottomR = landmarks[145];

        const innerL = landmarks[362];
        const outerL = landmarks[263];
        const topL = landmarks[386];
        const bottomL = landmarks[374];

        if (irisR && irisL && outerR && innerR && innerL && outerL) {
          // 右目の水平オフセット比率（-1.0〜+1.0: 0が中央）
          const eyeWidthR = Math.abs(innerR.x - outerR.x);
          const eyeCenterXR = (innerR.x + outerR.x) / 2;
          const offsetXR = eyeWidthR > 0 ? (irisR.x - eyeCenterXR) / (eyeWidthR / 2) : 0;

          // 左目の水平オフセット比率
          const eyeWidthL = Math.abs(outerL.x - innerL.x);
          const eyeCenterXL = (outerL.x + innerL.x) / 2;
          const offsetXL = eyeWidthL > 0 ? (irisL.x - eyeCenterXL) / (eyeWidthL / 2) : 0;

          // 垂直オフセット比率
          let offsetYR = 0;
          let offsetYL = 0;
          if (topR && bottomR && topL && bottomL) {
            const eyeHeightR = Math.abs(bottomR.y - topR.y);
            const eyeCenterYR = (bottomR.y + topR.y) / 2;
            offsetYR = eyeHeightR > 0 ? (irisR.y - eyeCenterYR) / (eyeHeightR / 2) : 0;

            const eyeHeightL = Math.abs(bottomL.y - topL.y);
            const eyeCenterYL = (bottomL.y + topL.y) / 2;
            offsetYL = eyeHeightL > 0 ? (irisL.y - eyeCenterYL) / (eyeHeightL / 2) : 0;
          }

          // 両目の平均ズレ量（丸め）
          gazeX = Math.round(((offsetXR + offsetXL) / 2) * 100) / 100;
          gazeY = Math.round(((offsetYR + offsetYL) / 2) * 100) / 100;

          // 目線が正面を向いているか判定
          gazeLooking =
            Math.abs(gazeX) <= this.maxGazeOffsetX && Math.abs(gazeY) <= this.maxGazeOffsetY;
        } else {
          // 虹彩が取得できない場合は頭部向きのみでフォールバック
          gazeLooking = headLooking;
        }

        // 頭部向きと目線の両方が正面を向いている時だけ「見ている（rawLooking）」とする
        rawLooking = headLooking && gazeLooking;
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
        headLooking,
        gazeX,
        gazeY,
        gazeLooking,
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
