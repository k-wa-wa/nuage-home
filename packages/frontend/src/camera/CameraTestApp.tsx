import { useCallback, useEffect, useRef, useState } from "react";
import { LookDetector, type LookState } from "../vision/look-detector.ts";
import { type SoundType, TestSoundPlayer } from "./synth.ts";

export function CameraTestApp() {
  const [detectorReady, setDetectorReady] = useState(false);
  const [detectorError, setDetectorError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundType, setSoundType] = useState<SoundType>("chord");
  const [volume, setVolume] = useState(0.2);
  const [useGracePeriod, setUseGracePeriod] = useState(true);

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
  const [logs, setLogs] = useState<
    { id: number; time: string; text: string; kind: "unmute" | "mute" | "info" }[]
  >([]);

  const detectorRef = useRef<LookDetector | null>(null);
  const soundPlayerRef = useRef<TestSoundPlayer | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const logIdRef = useRef(0);

  const addLog = useCallback((text: string, kind: "unmute" | "mute" | "info") => {
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
      } catch (err) {
        console.error("LookDetector 起動失敗:", err);
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
