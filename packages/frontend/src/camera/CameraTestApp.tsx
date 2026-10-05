import { useCallback, useEffect, useRef, useState } from "react";
import {
  GestureDetector,
  type GestureState,
  type GestureType,
  getGestureEmoji,
  getGestureLabel,
} from "../vision/gesture-detector.ts";
import { LookDetector, type LookState } from "../vision/look-detector.ts";
import { type SoundType, TestSoundPlayer } from "./synth.ts";

export function CameraTestApp() {
  const [detectorReady, setDetectorReady] = useState(false);
  const [gestureReady, setGestureReady] = useState(false);
  const [detectorError, setDetectorError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundType, setSoundType] = useState<SoundType>("chord");
  const [volume, setVolume] = useState(0.2);
  const [useGracePeriod, setUseGracePeriod] = useState(true);

  // テスト用モーダルの開閉状態（ピンチで閉じる/開く検証用）
  const [testModalOpen, setTestModalOpen] = useState(true);
  const [lastGesture, setLastGesture] = useState<{
    gesture: GestureType;
    time: string;
  } | null>(null);

  // チューニング可能な閾値パラメータ
  const [yawThreshold, setYawThreshold] = useState(14); // 左右首振り許容角（度）
  const [pitchThreshold, setPitchThreshold] = useState(14); // 上下首振り許容角（度）
  const [gazeThreshold, setGazeThreshold] = useState(0.28); // 目線ズレ許容比率
  const [graceMs, setGraceMs] = useState(400); // 猶予時間（ms）

  const [state, setState] = useState<LookState>({
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
  });

  const [gestureState, setGestureState] = useState<GestureState>({
    hasHand: false,
    handX: 0.5,
    handY: 0.5,
    indexPinchRatio: 1.0,
    middlePinchRatio: 1.0,
    isPinchingIndex: false,
    isPinchingMiddle: false,
    lastGesture: null,
    lastGestureTime: 0,
  });

  const [logs, setLogs] = useState<
    { id: number; time: string; text: string; kind: "unmute" | "mute" | "info" | "gesture" }[]
  >([]);

  const detectorRef = useRef<LookDetector | null>(null);
  const gestureDetectorRef = useRef<GestureDetector | null>(null);
  const soundPlayerRef = useRef<TestSoundPlayer | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const logIdRef = useRef(0);

  const addLog = useCallback((text: string, kind: "unmute" | "mute" | "info" | "gesture") => {
    const time = new Date().toLocaleTimeString("ja-JP", {
      hour12: false,
      fractionalSecondDigits: 2,
    });
    logIdRef.current += 1;
    setLogs((prev) => [{ id: logIdRef.current, time, text, kind }, ...prev.slice(0, 49)]);
  }, []);

  // サウンドプレイヤーのライフサイクル管理
  useEffect(() => {
    const player = new TestSoundPlayer();
    soundPlayerRef.current = player;
    return () => {
      player.stop();
    };
  }, []);

  // 音量変更の同期
  useEffect(() => {
    soundPlayerRef.current?.setVolume(volume);
  }, [volume]);

  // 閾値変更を LookDetector に反映
  useEffect(() => {
    detectorRef.current?.setThresholds({
      maxYawDeg: yawThreshold,
      maxPitchDeg: pitchThreshold,
      maxGazeOffsetX: gazeThreshold,
      maxGazeOffsetY: Math.round(gazeThreshold * 1.15 * 100) / 100,
      attentionGraceMs: graceMs,
    });
  }, [yawThreshold, pitchThreshold, gazeThreshold, graceMs]);

  // カメラ・LookDetector の起動（本番と全く同じ判定ロジック）
  useEffect(() => {
    const detector = new LookDetector({
      intervalMs: 120,
      maxYawDeg: yawThreshold,
      maxPitchDeg: pitchThreshold,
      maxGazeOffsetX: gazeThreshold,
      maxGazeOffsetY: Math.round(gazeThreshold * 1.15 * 100) / 100,
      attentionGraceMs: graceMs,
    });
    detectorRef.current = detector;

    let mounted = true;

    async function initCamera() {
      try {
        addLog("カメラと MediaPipe FaceLandmarker を初期化中...", "info");
        await detector.start();
        if (!mounted) {
          detector.stop();
          return;
        }

        const videoEl = detector.getVideoElement();
        if (videoEl && videoContainerRef.current) {
          videoContainerRef.current.innerHTML = "";
          videoEl.className = "camera-preview-video";
          videoContainerRef.current.appendChild(videoEl);
        }

        setDetectorReady(true);
        addLog("カメラ検出器が準備完了しました（頭部＆目線判定が有効）", "info");

        // ピンチ（Air Tap）検出器の初期化（同一のビデオ要素を流用、40ms/25fps で超高速サンプリング）
        if (videoEl) {
          addLog("マイクロジェスチャー検出器を初期化中...", "info");
          const gestureDetector = new GestureDetector({
            intervalMs: 40,
            minConfidence: 0.4,
            gestureCooldownMs: 400,
          });
          gestureDetectorRef.current = gestureDetector;

          await gestureDetector.start(videoEl);
          if (!mounted) {
            gestureDetector.stop();
            return;
          }

          setGestureReady(true);
          addLog(
            "マイクロジェスチャー検出器が準備完了しました（👌 人差し指ピンチ: 閉じる / ✌️ 中指ピンチ: 開く）",
            "info",
          );

          const stateCleanup = gestureDetector.onStateChange((newGestureState) => {
            setGestureState(newGestureState);
          });

          // ジェスチャー操作の監視（親指＋人差し指ピンチでDismiss、親指＋中指ピンチで再オープン）
          const gestureCleanup = gestureDetector.onGesture((gesture) => {
            const time = new Date().toLocaleTimeString("ja-JP", {
              hour12: false,
              fractionalSecondDigits: 2,
            });
            setLastGesture({ gesture, time });

            if (gesture === "Pinch_Index") {
              setTestModalOpen(false);
              addLog(
                `👌 [ピンチ] ${getGestureLabel(gesture)} を検出 → テストモーダルを閉じました (Dismiss)`,
                "gesture",
              );
            } else if (gesture === "Pinch_Middle") {
              setTestModalOpen(true);
              addLog(
                `✌️ [ピンチ] ${getGestureLabel(gesture)} を検出 → テストモーダルを開きました`,
                "gesture",
              );
            }
          });

          return () => {
            stateCleanup();
            gestureCleanup();
          };
        }
      } catch (err) {
        console.error("カメラ・検出器 起動失敗:", err);
        setDetectorError(err instanceof Error ? err.message : String(err));
        addLog(`エラー: ${err instanceof Error ? err.message : String(err)}`, "info");
      }
    }

    initCamera();

    const cleanup = detector.onStateChange((newState) => {
      setState(newState);
    });

    return () => {
      mounted = false;
      cleanup();
      detector.stop();
      gestureDetectorRef.current?.stop();
    };
  }, [addLog, yawThreshold, pitchThreshold, gazeThreshold, graceMs]);

  // 視線状態に応じてミュート／音出しを切り替え
  const isLookingEffective = useGracePeriod ? state.isLooking : state.rawLooking;
  const prevLookingRef = useRef(false);

  useEffect(() => {
    const player = soundPlayerRef.current;
    if (!player || !soundEnabled) return;

    if (isLookingEffective !== prevLookingRef.current) {
      prevLookingRef.current = isLookingEffective;
      if (isLookingEffective) {
        player.setMuted(false);
        addLog(
          `🔊 [音ON] 正面を向きました (Yaw: ${state.yawDeg}°, 目線ズレ: ${state.gazeX})`,
          "unmute",
        );
      } else {
        player.setMuted(true);
        const reason = !state.headLooking
          ? `顔向きが逸脱 (Yaw: ${state.yawDeg}°)`
          : !state.gazeLooking
            ? `目線が逸脱 (ズレ比率: ${state.gazeX})`
            : "顔未検出";
        addLog(`🔇 [ミュート] 視線外れ: ${reason}`, "mute");
      }
    }
  }, [
    isLookingEffective,
    soundEnabled,
    state.yawDeg,
    state.gazeX,
    state.headLooking,
    state.gazeLooking,
    addLog,
  ]);

  const toggleSound = async () => {
    const player = soundPlayerRef.current;
    if (!player) return;

    if (soundEnabled) {
      player.stop();
      setSoundEnabled(false);
      addLog("テスト音を停止しました", "info");
    } else {
      await player.start();
      player.setVolume(volume);
      player.setSoundType(soundType);
      player.setMuted(!isLookingEffective);
      setSoundEnabled(true);
      addLog("テスト音を開始しました（向いている時だけ鳴ります）", "info");
    }
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    soundPlayerRef.current?.setVolume(v);
  };

  const handleSoundTypeChange = (t: SoundType) => {
    setSoundType(t);
    soundPlayerRef.current?.setSoundType(t);
  };

  return (
    <div className="camera-app">
      <header className="camera-header">
        <div className="camera-header-left">
          <h1>nuage-home | カメラ視線・音量ゲート検証</h1>
          <span className="camera-badge" data-looking={isLookingEffective}>
            {isLookingEffective
              ? "🟢 LOOKING (音ON)"
              : state.faceDetected
                ? "🟡 AWAY (ミュート)"
                : "⚪️ NO FACE"}
          </span>
          <span className={`status-sub-chip ${state.headLooking ? "ok" : "ng"}`}>
            頭部: {state.headLooking ? "正面" : "逸脱"}
          </span>
          <span className={`status-sub-chip ${state.gazeLooking ? "ok" : "ng"}`}>
            目線: {state.gazeLooking ? "正面" : "逸脱"}
          </span>
          <span className={`status-sub-chip ${lastGesture ? "ok" : ""}`}>
            ピンチ:{" "}
            {lastGesture
              ? `${getGestureEmoji(lastGesture.gesture)} ${lastGesture.gesture === "Pinch_Index" ? "人差し指ピンチ" : "中指ピンチ"}`
              : "待機中"}
          </span>
        </div>
        <div className="camera-header-nav">
          <a href="/sandbox.html" className="nav-link">
            サンドボックスへ
          </a>
          <a href="/" className="nav-link">
            音声モードへ
          </a>
        </div>
      </header>

      <main className="camera-main">
        {/* 左カラム: カメラ映像 & 角度・目線メーター */}
        <section className="camera-preview-card panel">
          <div className="card-header">
            <h2>カメラプレビュー & 視線追跡</h2>
            <span className="chip" data-state={detectorReady ? "ok" : "pending"}>
              {detectorReady
                ? "頭部 + 瞳追跡中 (約8fps)"
                : detectorError
                  ? "エラー"
                  : "初期化中..."}
            </span>
          </div>

          <div className="video-viewport">
            <div ref={videoContainerRef} className="video-wrapper" />
            {!detectorReady && !detectorError && (
              <div className="video-placeholder">
                <p>カメラを起動しています...</p>
                <small>ブラウザのカメラ許可ダイアログを承認してください</small>
              </div>
            )}
            {detectorError && (
              <div className="video-placeholder error">
                <p>カメラの起動に失敗しました</p>
                <small>{detectorError}</small>
              </div>
            )}
            {detectorReady && (
              <div className="viewport-overlay">
                <div className={`look-crosshair ${isLookingEffective ? "is-focused" : ""}`}>
                  <div className="crosshair-target" />
                </div>
              </div>
            )}
          </div>

          {/* メーター群 */}
          <div className="angles-panel">
            {/* 左右首振り (Yaw) */}
            <div className="angle-row">
              <div className="angle-label">
                <span>頭部の左右首振り (Yaw):</span>
                <strong>{state.yawDeg}°</strong>
                <span className="angle-threshold">許容: ±{yawThreshold}°</span>
              </div>
              <div className="angle-bar-wrapper">
                <div className="angle-bar-track">
                  <div
                    className="angle-safe-zone"
                    style={{
                      left: `${50 - (yawThreshold / 90) * 50}%`,
                      width: `${(yawThreshold / 90) * 100}%`,
                    }}
                  />
                  <div
                    className={`angle-indicator ${state.headLooking ? "ok" : "warn"}`}
                    style={{
                      left: `${Math.max(0, Math.min(100, 50 + (state.yawDeg / 90) * 50))}%`,
                    }}
                  />
                </div>
                <div className="angle-scale">
                  <span>-90° (左)</span>
                  <span>-14°</span>
                  <span>0° (正面)</span>
                  <span>+14°</span>
                  <span>+90° (右)</span>
                </div>
              </div>
            </div>

            {/* 上下首振り (Pitch) */}
            <div className="angle-row">
              <div className="angle-label">
                <span>頭部の上下首振り (Pitch):</span>
                <strong>{state.pitchDeg}°</strong>
                <span className="angle-threshold">許容: ±{pitchThreshold}°</span>
              </div>
              <div className="angle-bar-wrapper">
                <div className="angle-bar-track">
                  <div
                    className="angle-safe-zone"
                    style={{
                      left: `${50 - (pitchThreshold / 90) * 50}%`,
                      width: `${(pitchThreshold / 90) * 100}%`,
                    }}
                  />
                  <div
                    className={`angle-indicator ${Math.abs(state.pitchDeg) <= pitchThreshold ? "ok" : "warn"}`}
                    style={{
                      left: `${Math.max(0, Math.min(100, 50 + (state.pitchDeg / 90) * 50))}%`,
                    }}
                  />
                </div>
                <div className="angle-scale">
                  <span>-90° (上)</span>
                  <span>-14°</span>
                  <span>0° (正面)</span>
                  <span>+14°</span>
                  <span>+90° (下)</span>
                </div>
              </div>
            </div>

            {/* 目線ズレ比率 (Gaze X) */}
            <div className="angle-row">
              <div className="angle-label">
                <span>瞳・黒目の水平ズレ (Eye Gaze X):</span>
                <strong>{state.gazeX > 0 ? `+${state.gazeX}` : state.gazeX}</strong>
                <span className="angle-threshold">許容: ±{gazeThreshold}</span>
              </div>
              <div className="angle-bar-wrapper">
                <div className="angle-bar-track">
                  <div
                    className="angle-safe-zone"
                    style={{
                      left: `${50 - gazeThreshold * 50}%`,
                      width: `${gazeThreshold * 100}%`,
                    }}
                  />
                  <div
                    className={`angle-indicator ${state.gazeLooking ? "ok" : "warn"}`}
                    style={{
                      left: `${Math.max(0, Math.min(100, 50 + state.gazeX * 50))}%`,
                    }}
                  />
                </div>
                <div className="angle-scale">
                  <span>-1.0 (左逸脱)</span>
                  <span>-{gazeThreshold}</span>
                  <span>0.0 (正面)</span>
                  <span>+{gazeThreshold}</span>
                  <span>+1.0 (右逸脱)</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 右カラム: 音源コントロール & 閾値調整 & ログ */}
        <div className="camera-controls-column">
          <section className="audio-card panel">
            <div className="card-header">
              <h2>検証用サウンド（向いている時だけ発音）</h2>
              <div
                className={`sound-status-chip ${soundEnabled && isLookingEffective ? "playing" : "muted"}`}
              >
                {soundEnabled ? (isLookingEffective ? "🔊 発音中" : "🔇 ミュート中") : "⏸ 停止中"}
              </div>
            </div>

            <div className="control-group">
              <button
                type="button"
                className={`btn-sound-toggle ${soundEnabled ? "is-active" : ""}`}
                onClick={toggleSound}
              >
                {soundEnabled ? "⏹ テスト音を停止" : "▶️ テスト音を開始（クリックで有効化）"}
              </button>
            </div>

            <div className="control-row">
              <label htmlFor="sound-type-select">音の種類:</label>
              <select
                id="sound-type-select"
                value={soundType}
                onChange={(e) => handleSoundTypeChange(e.target.value as SoundType)}
                disabled={!soundEnabled}
              >
                <option value="chord">浮遊シンセ和音（C-E-G-B）</option>
                <option value="sine">サイン波トーン（440Hz / A4）</option>
                <option value="pulse">パルストーン（ピッピッピッ）</option>
              </select>
            </div>

            <div className="control-row">
              <label htmlFor="volume-slider">音量 ({Math.round(volume * 100)}%):</label>
              <input
                id="volume-slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
              />
            </div>
          </section>

          {/* 手・マイクロジェスチャー認識パネル */}
          <section className="gesture-card panel">
            <div className="card-header">
              <h2>ピンチ操作（Air Tap / 微小ジェスチャー）</h2>
              <span className="chip" data-state={gestureReady ? "ok" : "pending"}>
                {gestureReady ? "超高速検出中 (約25fps)" : "初期化中..."}
              </span>
            </div>

            <div className="gesture-main-display">
              <div
                className={`gesture-emoji-large ${
                  lastGesture || gestureState.isPinchingIndex || gestureState.isPinchingMiddle
                    ? "has-gesture"
                    : ""
                }`}
              >
                {lastGesture
                  ? getGestureEmoji(lastGesture.gesture)
                  : gestureState.isPinchingIndex
                    ? "👌"
                    : gestureState.isPinchingMiddle
                      ? "✌️"
                      : "✋"}
              </div>
              <div className="gesture-info-meta">
                <div className="gesture-title">
                  {lastGesture
                    ? getGestureLabel(lastGesture.gesture)
                    : gestureState.hasHand
                      ? gestureState.isPinchingIndex
                        ? "👌 親指＋人差し指ピンチ中！"
                        : gestureState.isPinchingMiddle
                          ? "✌️ 親指＋中指ピンチ中！"
                          : "手を認識中: 親指と人差し指をチョンと合わせてください"
                      : "カメラに手をかざしてください"}
                </div>
                <div className="gesture-subtitle">
                  {gestureState.hasHand
                    ? `人差し指ピンチ比率: ${gestureState.indexPinchRatio.toFixed(2)} (閾値: 0.24) | 中指比率: ${gestureState.middlePinchRatio.toFixed(2)}`
                    : "親指と人差し指をつまんで閉じる / 親指と中指をつまんで開く"}
                </div>
              </div>
            </div>

            {/* リアルタイムピンチ近接度メーター */}
            <div className="swipe-section-title">指先近接度メーター（小さいほど接触）:</div>
            <div className="pinch-meters-container">
              <div className="pinch-meter-row">
                <div className="pinch-meter-header">
                  <span className="pinch-meter-label">親指 ↔ 人差し指 (閉じる):</span>
                  <span
                    className={`pinch-meter-value ${gestureState.isPinchingIndex ? "is-pinching" : ""}`}
                  >
                    {gestureState.hasHand
                      ? `${gestureState.indexPinchRatio.toFixed(2)} ${
                          gestureState.isPinchingIndex ? "👌 PINCH ACTIVE" : ""
                        }`
                      : "--"}
                  </span>
                </div>
                <div className="pinch-meter-track">
                  <div
                    className="pinch-meter-threshold-line"
                    style={{ left: `${(0.24 / 1.2) * 100}%` }}
                    title="ピンチ検出閾値 (0.24)"
                  />
                  <div
                    className={`pinch-meter-fill ${
                      gestureState.isPinchingIndex ? "is-active" : ""
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, (gestureState.indexPinchRatio / 1.2) * 100))}%`,
                    }}
                  />
                </div>
              </div>

              <div className="pinch-meter-row">
                <div className="pinch-meter-header">
                  <span className="pinch-meter-label">親指 ↔ 中指 (開く):</span>
                  <span
                    className={`pinch-meter-value ${gestureState.isPinchingMiddle ? "is-pinching" : ""}`}
                  >
                    {gestureState.hasHand
                      ? `${gestureState.middlePinchRatio.toFixed(2)} ${
                          gestureState.isPinchingMiddle ? "✌️ PINCH ACTIVE" : ""
                        }`
                      : "--"}
                  </span>
                </div>
                <div className="pinch-meter-track">
                  <div
                    className="pinch-meter-threshold-line"
                    style={{ left: `${(0.24 / 1.2) * 100}%` }}
                    title="ピンチ検出閾値 (0.24)"
                  />
                  <div
                    className={`pinch-meter-fill ${
                      gestureState.isPinchingMiddle ? "is-active" : ""
                    }`}
                    style={{
                      width: `${Math.min(100, Math.max(0, (gestureState.middlePinchRatio / 1.2) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* ジェスチャー動作インジケーター */}
            <div className="swipe-section-title">ピンチ動作インジケーター:</div>
            <div
              className="swipe-indicators-grid"
              style={{ gridTemplateColumns: "repeat(2, 1fr)" }}
            >
              <div
                className={`swipe-target-badge ${
                  lastGesture?.gesture === "Pinch_Index" || gestureState.isPinchingIndex
                    ? "is-detected"
                    : ""
                }`}
              >
                <span className="target-icon">👌</span>
                <span className="target-label">人差し指ピンチ (閉じる)</span>
              </div>
              <div
                className={`swipe-target-badge ${
                  lastGesture?.gesture === "Pinch_Middle" || gestureState.isPinchingMiddle
                    ? "is-detected"
                    : ""
                }`}
              >
                <span className="target-icon">✌️</span>
                <span className="target-label">中指ピンチ (開く)</span>
              </div>
            </div>

            {/* ピンチで閉じる体験テスト用モーダル */}
            <div className="swipe-section-title">モーダルのピンチ操作体験:</div>
            {testModalOpen ? (
              <div className="test-modal-card">
                <div className="test-modal-header">
                  <span className="test-modal-title">📑 動作確認用レポートモーダル</span>
                  <button
                    type="button"
                    className="test-modal-close"
                    onClick={() => setTestModalOpen(false)}
                    title="閉じる"
                  >
                    ✕
                  </button>
                </div>
                <p className="test-modal-desc">
                  画面の前で<strong>親指と人差し指を「チョン」と合わせる（ピンチ）</strong>
                  と、このモーダルが自動で閉じます（Dismiss）。腕を振る必要はありません。
                </p>
                <div className="test-modal-hint">
                  💡 閉じた後、<strong>親指と中指をピンチ</strong>すると再オープンします。
                </div>
              </div>
            ) : (
              <div className="test-modal-closed-banner">
                <span>モーダルは閉じられました</span>
                <button
                  type="button"
                  className="btn-reopen-modal"
                  onClick={() => setTestModalOpen(true)}
                >
                  再表示（または ✌️ 中指ピンチ）
                </button>
              </div>
            )}
          </section>

          {/* 厳しさ・感度チューニングパネル */}
          <section className="tuning-card panel">
            <div className="card-header">
              <h2>感度・厳しさチューニング（リアルタイム反映）</h2>
            </div>

            <div className="control-row">
              <label htmlFor="yaw-thresh-slider">首振り許容角 ({yawThreshold}°):</label>
              <input
                id="yaw-thresh-slider"
                type="range"
                min="8"
                max="25"
                step="1"
                value={yawThreshold}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setYawThreshold(val);
                  setPitchThreshold(val);
                }}
              />
            </div>

            <div className="control-row">
              <label htmlFor="gaze-thresh-slider">目線ズレ許容比率 ({gazeThreshold}):</label>
              <input
                id="gaze-thresh-slider"
                type="range"
                min="0.15"
                max="0.45"
                step="0.01"
                value={gazeThreshold}
                onChange={(e) => setGazeThreshold(Number(e.target.value))}
              />
            </div>

            <div className="control-row">
              <label htmlFor="grace-slider">継続猶予時間 ({graceMs}ms):</label>
              <input
                id="grace-slider"
                type="range"
                min="0"
                max="1000"
                step="50"
                value={graceMs}
                onChange={(e) => setGraceMs(Number(e.target.value))}
              />
            </div>

            <div className="control-row">
              <label htmlFor="grace-checkbox">ヒステリシス猶予の有効化:</label>
              <div className="checkbox-wrap">
                <input
                  id="grace-checkbox"
                  type="checkbox"
                  checked={useGracePeriod}
                  onChange={(e) => setUseGracePeriod(e.target.checked)}
                />
                <span className="hint-text">
                  {useGracePeriod
                    ? `有効: 目線を少し外しても ${graceMs}ms 間音声を維持`
                    : "無効: 瞬間の角度・目線で即座にミュート"}
                </span>
              </div>
            </div>
          </section>

          <section className="log-card panel">
            <div className="card-header">
              <h2>判定・音声ゲート遷移ログ</h2>
              <button type="button" className="btn-clear-logs" onClick={() => setLogs([])}>
                ログ消去
              </button>
            </div>
            <div className="log-list-container">
              {logs.length === 0 ? (
                <div className="log-empty">まだログはありません</div>
              ) : (
                <ul className="log-list">
                  {logs.map((item) => (
                    <li key={item.id} className={`log-item log-${item.kind}`}>
                      <span className="log-time">{item.time}</span>
                      <span className="log-text">{item.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
