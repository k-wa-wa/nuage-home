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
import { TaskBoard } from "./components/TaskBoard.tsx";
import { config, LANG } from "./config.ts";
import { OrbRenderer } from "./orb/orb-renderer.ts";
import { WebSpeechRecognizer } from "./speech/web-speech-recognition.ts";
import { VoiceClient, type VoiceState } from "./voice/voice-client.ts";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
}

const STATUS_TEXT: Record<VoiceState, string> = {
  stopped: "停止中（オーブを押して再開）",
  connecting: "接続中…",
  listening: "聞き取り中",
  thinking: "考え中…",
  speaking: "話している",
};

/**
 * 音声モードのメイン画面コンポーネント。
 */
export function VoiceApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbRef = useRef<OrbRenderer | null>(null);
  const clientRef = useRef<VoiceClient | null>(null);
  const interimRef = useRef<WebSpeechRecognizer | null>(null);
  const logContainerRef = useRef<HTMLOListElement>(null);

  const [voiceState, setVoiceState] = useState<VoiceState>("stopped");
  const [floorState, setFloorState] = useState<FloorStateName>("idle");
  const [interimText, setInterimText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tasksMap, setTasksMap] = useState<Map<string, Task>>(new Map());
  const [notificationsMap, setNotificationsMap] = useState<Map<string, Notification>>(new Map());
  const [activeReportTask, setActiveReportTask] = useState<Task | null>(null);

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

  // 初期化と VoiceClient の配線
  useEffect(() => {
    if (canvasRef.current) {
      orbRef.current = new OrbRenderer(canvasRef.current);
    }

    try {
      const recognizer = new WebSpeechRecognizer(LANG);
      recognizer.onInterim = (text) => setInterimText(text);
      recognizer.onFinal = (text) => appendMessage("user", text);
      interimRef.current = recognizer;
    } catch (err) {
      console.warn("[VoiceApp] ブラウザの音声認識は使えない:", err);
    }

    const client = new VoiceClient(config.voiceWsUrl, {
      onStateChange(state) {
        setVoiceState(state);
        orbRef.current?.setState(state === "connecting" ? "listening" : state);
        if (state === "stopped") interimRef.current?.stop();
        else if (state === "speaking" || state === "thinking") interimRef.current?.suspend();
        else interimRef.current?.resume();
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

    clientRef.current = client;
    client.connect();

    return () => {
      client.close();
      interimRef.current?.stop();
    };
  }, [appendMessage, appendToLastAssistantMessage]);

  // ログ末尾へのスクロール
  // biome-ignore lint/correctness/useExhaustiveDependencies: メッセージ更新時にスクロールするため
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [messages, interimText]);

  const toggleVoice = () => {
    const client = clientRef.current;
    if (!client) return;
    if (!client.isRunning) interimRef.current?.start();
    client.toggle();
  };

  return (
    <>
      <canvas id="orb" ref={canvasRef} />
      <main className="voice">
        <div className="center-stage">
          <button
            type="button"
            className="orb-hitbox"
            title="オーブを押して会話を始める"
            aria-label="オーブを押して会話を始める"
            onClick={toggleVoice}
          />
          <p className="status">{STATUS_TEXT[voiceState]}</p>
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
      </main>
    </>
  );
}
