import {
  FLOOR_LABEL,
  type FloorStateName,
  isReportTask,
  type Notification,
  type Task,
} from "@nuage-home/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FloatingModal } from "./components/FloatingModal.tsx";
import { NotificationList } from "./components/NotificationList.tsx";
import { ReportModal } from "./components/ReportModal.tsx";
import { StartScreen } from "./components/StartScreen.tsx";
import { TaskBoard } from "./components/TaskBoard.tsx";
import { config, LANG } from "./config.ts";
import { OrbRenderer } from "./orb/orb-renderer.ts";
import { WebSpeechRecognizer } from "./speech/web-speech-recognition.ts";
import { LookDetector, type LookState } from "./vision/look-detector.ts";
import { VoiceClient, type VoiceState } from "./voice/voice-client.ts";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
}

/**
 * 音声モードのメイン画面コンポーネント。
 */
export function VoiceApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbRef = useRef<OrbRenderer | null>(null);
  const clientRef = useRef<VoiceClient | null>(null);
  const interimRef = useRef<WebSpeechRecognizer | null>(null);
  const logContainerRef = useRef<HTMLOListElement>(null);
  const lookDetectorRef = useRef<LookDetector | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const [voiceState, setVoiceState] = useState<VoiceState>("stopped");
  const [floorState, setFloorState] = useState<FloorStateName>("idle");
  const [interimText, setInterimText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tasksMap, setTasksMap] = useState<Map<string, Task>>(new Map());
  const [notificationsMap, setNotificationsMap] = useState<Map<string, Notification>>(new Map());
  const [activeReportTask, setActiveReportTask] = useState<Task | null>(null);

  // 初回オンボーディング（マイク・カメラ・位置情報の一括許可モーダル）
  const [showWelcome, setShowWelcome] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem("nuage-home-onboarded");
  });

  // Look and Talk の状態
  const [lookAndTalkEnabled, setLookAndTalkEnabled] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [lookState, setLookState] = useState<LookState>({
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

  const lookAndTalkEnabledRef = useRef(lookAndTalkEnabled);
  lookAndTalkEnabledRef.current = lookAndTalkEnabled;

  const tasks = useMemo(() => [...tasksMap.values()].reverse(), [tasksMap]);
  const notifications = useMemo(() => [...notificationsMap.values()].reverse(), [notificationsMap]);

  const isNarrow = typeof window !== "undefined" && window.innerWidth < 840;

  // メッセージの追加・追記ヘルパー
  const appendMessage = useCallback((role: ChatMessage["role"], text: string) => {
    setMessages((prev) => [...prev, { id: `msg-${Date.now()}-${Math.random()}`, role, text }]);
  }, []);

  const appendToLastAssistantMessage = useCallback((text: string) => {
    setMessages((prev) => {
      const last = prev.at(-1);
      if (last && last.role === "assistant") {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { id: `msg-${Date.now()}-${Math.random()}`, role: "assistant", text }];
    });
  }, []);

  // 初期化と VoiceClient / LookDetector の配線
  useEffect(() => {
    if (canvasRef.current) {
      orbRef.current = new OrbRenderer(canvasRef.current);
    }

    let recognizer: WebSpeechRecognizer | null = null;
    try {
      recognizer = new WebSpeechRecognizer(LANG);
      recognizer.onInterim = (text) => setInterimText(text);
      // 会話ログへの追加は Live の onUserTranscript を正とするため、onFinal では仮表示のクリアのみ行う
      recognizer.onFinal = () => setInterimText("");
      interimRef.current = recognizer;
    } catch (err) {
      console.warn("[VoiceApp] ブラウザの音声認識は使えない:", err);
    }

    const lookDetector = new LookDetector({
      intervalMs: 120,
      attentionGraceMs: 800,
    });
    lookDetectorRef.current = lookDetector;
    lookDetector.onStateChange((state) => {
      setLookState(state);
      // 画面から視線が外れた瞬間、オーブ下の仮テキストを即座に消去する
      if (!state.isLooking) {
        setInterimText("");
      }
    });

    const client = new VoiceClient(config.voiceWsUrl, {
      onStateChange(state) {
        setVoiceState(state);
        orbRef.current?.setState(state === "connecting" ? "listening" : state);
        if (state === "stopped") {
          interimRef.current?.stop();
          lookDetectorRef.current?.stop();
        } else if (state === "speaking" || state === "thinking") {
          interimRef.current?.suspend();
        } else {
          interimRef.current?.resume();
        }
      },
      onModelText(text) {
        appendToLastAssistantMessage(text);
      },
      onModelTurnComplete() {
        // ターン完了時は次のメッセージ用に空行を開始できる
      },
      onUserTranscript(text) {
        appendMessage("user", text);
      },
      onUserSpeaking(speaking) {
        if (!speaking) setInterimText("");
      },
      onTask(task) {
        setTasksMap((prev) => {
          const next = new Map(prev);
          const old = next.get(task.id);
          next.set(task.id, task);

          // 新たに完了したレポート対象タスク（調査結果等）のみ自動でレポートを開く
          if (task.status === "succeeded" && isReportTask(task) && old?.status !== "succeeded") {
            setActiveReportTask(task);
          }
          return next;
        });
      },
      onNotification(notification) {
        setNotificationsMap((prev) => {
          const next = new Map(prev);
          next.set(notification.id, notification);
          return next;
        });
      },
      onFloor(state) {
        setFloorState(state);
      },
      onError(err) {
        appendMessage("error", err.message);
        if (!client.isRunning) orbRef.current?.setState("stopped");
      },
    });

    // Look and Talk ゲートの配線: 有効時は画面を見ている時のみ音声認識・送信を許可（LiveとWebSpeechで統一）
    const attentionProvider = () => {
      if (!lookAndTalkEnabledRef.current) return true;
      return lookDetector.isLookingAtScreen();
    };
    client.setAttentionProvider(attentionProvider);
    recognizer?.setAttentionProvider(attentionProvider);

    clientRef.current = client;
    client.connect();

    return () => {
      client.close();
      interimRef.current?.stop();
      lookDetector.stop();
    };
  }, [appendMessage, appendToLastAssistantMessage]);

  // ログ末尾へのスクロール
  // biome-ignore lint/correctness/useExhaustiveDependencies: メッセージ更新時にスクロールするため
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [messages, interimText]);

  // オーブクリック時の処理（手動優先・バイパス機能付き）
  const handleOrbClick = async () => {
    const client = clientRef.current;
    if (!client) return;

    if (!client.isRunning) {
      // 停止中の場合: 音声セッションを開始
      interimRef.current?.start();
      if (lookAndTalkEnabledRef.current) {
        try {
          await lookDetectorRef.current?.start();
        } catch (err) {
          console.warn("[VoiceApp] カメラの起動に失敗したため、Look & Talk を無効化:", err);
          setLookAndTalkEnabled(false);
        }
      }
      await client.start();
    } else {
      // 稼働中の場合: オーブをタップしたら視線判定を 8 秒間一時バイパス（見なくても話せる）
      lookDetectorRef.current?.bypassAttention(8000);
      interimRef.current?.start();
    }
  };

  // 初回起動：一通りの許可ダイアログを完了させてからメイン画面へ遷移する
  const handleStart = async () => {
    let audioStream: MediaStream | undefined;
    let videoStream: MediaStream | undefined;

    // 1. マイクとカメラを 1 つのダイアログで一括要求
    try {
      const combinedStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          width: { ideal: 320 },
          height: { ideal: 240 },
          frameRate: { ideal: 10, max: 15 },
        },
      });

      const audioTracks = combinedStream.getAudioTracks();
      const videoTracks = combinedStream.getVideoTracks();
      if (audioTracks.length > 0) {
        audioStream = new MediaStream(audioTracks);
      }
      if (videoTracks.length > 0) {
        videoStream = new MediaStream(videoTracks);
      }
    } catch (err) {
      console.warn("[VoiceApp] カメラ+マイク一括許可が拒否または失敗:", err);
      // カメラが使えない環境ではマイク単独での許可をフォールバック試行
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStream = stream;
      } catch (audioErr) {
        console.warn("[VoiceApp] マイク許可も拒否または失敗:", audioErr);
      }
    }

    // 2. 位置情報の要求（ダイアログ応答または最大3秒タイムアウトで完了）
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(),
          () => resolve(),
          { timeout: 3000 },
        );
      });
      clientRef.current?.sendLocationIfGranted();
    }

    // 3. 一通りの許可フローが完了したら、スタート画面を閉じてメイン画面へ遷移
    localStorage.setItem("nuage-home-onboarded", "true");
    setShowWelcome(false);

    // 4. 取得したストリームを使って音声とカメラ（Look & Talk）を開始
    const client = clientRef.current;
    if (client && !client.isRunning) {
      try {
        interimRef.current?.start();
      } catch (err) {
        console.warn("[VoiceApp] 音声認識の起動エラー:", err);
      }

      if (videoStream && lookAndTalkEnabledRef.current) {
        lookDetectorRef.current?.start(videoStream).catch((err) => {
          console.warn("[VoiceApp] カメラの起動に失敗したため手動モードへ移行:", err);
          setLookAndTalkEnabled(false);
        });
      } else {
        setLookAndTalkEnabled(false);
      }

      try {
        await client.start(audioStream);
      } catch (err) {
        console.error("[VoiceApp] 音声セッションの開始エラー:", err);
      }
    }
  };

  // 許可をスキップ：一切の許可ダイアログを出さずに即座にスタート画面を閉じ、手動モードで待機
  const handleSkip = () => {
    localStorage.setItem("nuage-home-onboarded", "true");
    setShowWelcome(false);
    setLookAndTalkEnabled(false);
    // カメラ・マイク・位置情報は一切要求せず、手動タップ待ち状態で静かに開く
  };

  // 状態ラベル（過剰な説明を排したミニマルな表示）
  const statusLabel = useMemo(() => {
    if (voiceState === "stopped") return "停止中";
    if (voiceState === "connecting") return "接続中…";
    if (voiceState === "thinking") return "考え中…";
    if (voiceState === "speaking") return "話している";
    if (voiceState === "listening") {
      return interimText ? "聞き取り中" : "待機中";
    }
    return "";
  }, [voiceState, interimText]);

  return (
    <>
      <canvas
        id="orb"
        ref={canvasRef}
        className={lookState.isLooking && voiceState === "listening" ? "focused" : ""}
      />
      {showWelcome ? (
        <StartScreen onStart={handleStart} onSkip={handleSkip} />
      ) : (
        <main className="voice">
          <div className="center-stage">
            <button
              type="button"
              className="orb-hitbox"
              title="オーブを押して会話を始める"
              aria-label="オーブを押して会話を始める"
              onClick={handleOrbClick}
            />
            <p className="status">{statusLabel}</p>

            {/* ミニマルなコントロールピル */}
            <div className="voice-controls">
              <button
                type="button"
                className={`control-pill ${
                  !lookAndTalkEnabled
                    ? "disabled"
                    : lookState.isLooking
                      ? "looking"
                      : lookState.faceDetected
                        ? "detected"
                        : "idle"
                }`}
                onClick={() => {
                  const nextVal = !lookAndTalkEnabled;
                  setLookAndTalkEnabled(nextVal);
                  if (clientRef.current?.isRunning) {
                    if (nextVal) {
                      lookDetectorRef.current?.start().catch(() => setLookAndTalkEnabled(false));
                    } else {
                      lookDetectorRef.current?.stop();
                    }
                  }
                }}
                title={
                  !lookAndTalkEnabled
                    ? "視線連動: オフ（クリックで有効化）"
                    : lookState.isLooking
                      ? "視線連動: 正面"
                      : lookState.faceDetected
                        ? `視線連動: 画面外 (Yaw: ${lookState.yawDeg}°)`
                        : "視線連動: 待機中"
                }
              >
                <span className="control-dot" aria-hidden="true" />
                <span className="control-label">Look & Talk</span>
              </button>

              {lookAndTalkEnabled && voiceState !== "stopped" && (
                <button
                  type="button"
                  className={`control-icon-btn ${showPreview ? "active" : ""}`}
                  onClick={() => setShowPreview((v) => !v)}
                  title="カメラプレビュー"
                >
                  📹
                </button>
              )}
            </div>

            <p className="interim">{interimText}</p>
            <ol ref={logContainerRef} className="log" aria-live="polite">
              {messages.map((m) => (
                <li key={m.id} className={`log-${m.role}`}>
                  {m.text}
                </li>
              ))}
            </ol>
          </div>

          {/* Tasks フローティングモーダル */}
          <FloatingModal
            title="Tasks"
            initialPosition={isNarrow ? { top: 16, left: 16 } : { top: 32, left: 32 }}
          >
            <TaskBoard tasks={tasks} onSelectReport={(task) => setActiveReportTask(task)} />
          </FloatingModal>

          {/* Notification フローティングモーダル */}
          <FloatingModal
            title="Notification"
            initialPosition={isNarrow ? { top: 260, left: 16 } : { top: 32, right: 32 }}
            headerExtra={
              <span className="chip" data-state={floorState}>
                {FLOOR_LABEL[floorState]}
              </span>
            }
          >
            <NotificationList notifications={notifications} />
          </FloatingModal>

          {/* Report フローティングモーダル */}
          <ReportModal
            task={activeReportTask}
            initialPosition={isNarrow ? { top: 40, left: 16 } : { top: 70, left: 380 }}
            onClose={() => setActiveReportTask(null)}
          />

          {/* Camera Preview フローティングモーダル */}
          {showPreview && voiceState !== "stopped" && (
            <FloatingModal
              title="Camera Preview"
              initialPosition={isNarrow ? { top: 320, left: 16 } : { bottom: 32, right: 32 }}
              onClose={() => setShowPreview(false)}
              headerExtra={
                <span className={`chip ${lookState.isLooking ? "chip-looking" : "chip-away"}`}>
                  {lookState.isLooking ? "👀 正面" : lookState.faceDetected ? "横向き" : "未検出"}
                </span>
              }
            >
              <div className="camera-modal-content">
                <video
                  ref={(el) => {
                    previewVideoRef.current = el;
                    if (el && lookDetectorRef.current) {
                      const stream = lookDetectorRef.current.getVideoElement()
                        ?.srcObject as MediaStream;
                      if (stream && el.srcObject !== stream) {
                        el.srcObject = stream;
                        el.play().catch(() => {});
                      }
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="camera-modal-video"
                />
                <div className="camera-modal-stats">
                  <span>Yaw: {lookState.yawDeg}°</span>
                  <span>Pitch: {lookState.pitchDeg}°</span>
                  <span className={lookState.isLooking ? "tag-looking" : "tag-away"}>
                    {lookState.isLooking ? "LOOKING" : "AWAY"}
                  </span>
                </div>
              </div>
            </FloatingModal>
          )}
        </main>
      )}
    </>
  );
}
