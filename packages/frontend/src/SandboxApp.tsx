import {
  type ConversationClientMessage,
  type ConversationModes,
  type ConversationServerMessage,
  FLOOR_LABEL,
  type FloorStateName,
  isReportTask,
  type Notification,
  type Task,
} from "@nuage-home/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FloatingModal } from "./components/FloatingModal.tsx";
import { type LiveIoItem, LiveIoList } from "./components/LiveIoList.tsx";
import { NotificationList } from "./components/NotificationList.tsx";
import { ReportModal } from "./components/ReportModal.tsx";
import { TaskBoard } from "./components/TaskBoard.tsx";
import { config } from "./config.ts";
import { type SpeechBubble, TypedSpeech } from "./sandbox/typed-speech.ts";

const SCENARIO = [
  "フロアライトをつけて",
  "カーテンを開けて",
  "電球グループを消して",
  "autopilot で止まってる PR 調べて",
  "東京の今週の気温推移をグラフにして",
  "1から100までの合計を計算して",
  "週末に京都へ行くんだけど、紅葉のおすすめある？",
  "嵐山ならお昼ご飯はどこがいい？",
  "京都の紅葉の状況を詳しく調べて",
  "さっき頼んだの、どうなった？",
  "autopilot の状況を確認して",
  "やっぱりやめて",
];

const SETTINGS_KEY = "nuage-home.sandbox.settings";

export interface SandboxSettings {
  live: string;
  llm: string;
  delay: string;
  speed: string;
}

const DEFAULT_SETTINGS: SandboxSettings = {
  live: "mock",
  llm: "mock",
  delay: "8000",
  speed: "10",
};

export interface ChatLine {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  interrupted?: boolean;
}

/**
 * サンドボックスのメイン画面コンポーネント。
 */
export function SandboxApp() {
  const [settings, setSettings] = useState<SandboxSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [connStatus, setConnStatus] = useState<{
    text: string;
    state?: string;
  }>({
    text: "未接続",
    state: "pending",
  });
  const [floorState, setFloorState] = useState<FloorStateName>("idle");
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  const [inputText, setInputText] = useState("");
  const [tasksMap, setTasksMap] = useState<Map<string, Task>>(new Map());
  const [notificationsMap, setNotificationsMap] = useState<Map<string, Notification>>(new Map());
  const [liveIoItems, setLiveIoItems] = useState<LiveIoItem[]>([]);
  const [activeReportTask, setActiveReportTask] = useState<Task | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const speechRef = useRef<TypedSpeech | null>(null);
  const userSpeakingRef = useRef(false);
  const logContainerRef = useRef<HTMLOListElement>(null);

  const tasks = useMemo(() => [...tasksMap.values()].reverse(), [tasksMap]);
  const notifications = useMemo(() => [...notificationsMap.values()].reverse(), [notificationsMap]);

  const isNarrow = typeof window !== "undefined" && window.innerWidth < 1200;

  // 設定保存
  const updateSetting = (key: keyof SandboxSettings, value: string) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // 保存失敗時は無視
      }
      return next;
    });
  };

  const send = useCallback((msg: ConversationClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const addLine = useCallback((role: ChatLine["role"], text: string): string => {
    const id = `line-${Date.now()}-${Math.random()}`;
    setChatLines((prev) => [...prev, { id, role, text }]);
    return id;
  }, []);

  // TypedSpeech の初期化
  useEffect(() => {
    const speech = new TypedSpeech({
      view: {
        begin(): SpeechBubble {
          const id = `line-${Date.now()}-${Math.random()}`;
          setChatLines((prev) => [...prev, { id, role: "assistant", text: "" }]);
          return {
            append: (t) => {
              setChatLines((prev) =>
                prev.map((l) => (l.id === id ? { ...l, text: l.text + t } : l)),
              );
            },
            markInterrupted: () => {
              setChatLines((prev) =>
                prev.map((l) => (l.id === id ? { ...l, interrupted: true } : l)),
              );
            },
          };
        },
        silentTurn: () => addLine("system", "（無言のターン）"),
      },
      onPlaying: (playing) => send({ type: "playback_state", playing }),
      charsPerSecond: () => Number(settings.speed),
    });

    speechRef.current = speech;
  }, [addLine, send, settings.speed]);

  // 発話制御
  const startSpeaking = useCallback(() => {
    if (userSpeakingRef.current) return;
    userSpeakingRef.current = true;
    send({ type: "speech_start" });
    speechRef.current?.bargeIn();
  }, [send]);

  const finishSpeaking = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      startSpeaking();
      addLine("user", trimmed);
      send({ type: "user_turn", text: trimmed });
      userSpeakingRef.current = false;
    },
    [addLine, send, startSpeaking],
  );

  // WebSocket 接続
  const connect = useCallback(() => {
    wsRef.current?.close();
    speechRef.current?.reset();
    setTasksMap(new Map());
    setNotificationsMap(new Map());
    setLiveIoItems([]);
    setActiveReportTask(null);
    setConnStatus({ text: "接続中…", state: "pending" });

    const query = new URLSearchParams({
      live: settings.live,
      llm: settings.llm,
      delay: settings.delay,
    });

    const socket = new WebSocket(`${config.sandboxWsUrl}?${query}`);
    wsRef.current = socket;

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "voice_start" }));
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            socket.send(
              JSON.stringify({
                type: "client_context",
                location: {
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                },
              }),
            );
          },
          () => {},
          { timeout: 5000, maximumAge: 300_000 },
        );
      }
    });

    socket.addEventListener("message", (e) => {
      if (wsRef.current !== socket) return;
      const msg = JSON.parse(String(e.data)) as ConversationServerMessage;
      switch (msg.type) {
        case "ready":
          setConnStatus({
            text: `接続中（${describeModes(msg.modes, settings.delay)}）`,
            state: "ok",
          });
          return;
        case "reset_done":
          setChatLines([]);
          userSpeakingRef.current = false;
          setInputText("");
          setActiveReportTask(null);
          addLine(
            "system",
            "リセットした（タスク・通知・会話を消し、新しい Live セッションで接続し直した）",
          );
          connect();
          return;
        case "model_text":
          speechRef.current?.onModelText(msg.text);
          return;
        case "model_turn_complete":
          speechRef.current?.onTurnComplete();
          return;
        case "floor":
          setFloorState(msg.state);
          return;
        case "task_update":
          setTasksMap((prev) => {
            const next = new Map(prev);
            const old = next.get(msg.task.id);
            next.set(msg.task.id, msg.task);

            if (
              msg.task.status === "succeeded" &&
              isReportTask(msg.task) &&
              old?.status !== "succeeded"
            ) {
              setActiveReportTask(msg.task);
            }
            return next;
          });
          return;
        case "notification_update":
          setNotificationsMap((prev) => {
            const next = new Map(prev);
            next.set(msg.notification.id, msg.notification);
            return next;
          });
          return;
        case "live_io":
          setLiveIoItems((prev) => [{ record: msg.record, at: msg.at }, ...prev]);
          return;
        case "error":
          addLine("system", `エラー: ${msg.message}`);
          return;
        case "model_audio":
        case "user_transcript":
        case "interrupted":
          return;
      }
    });

    socket.addEventListener("close", () => {
      if (wsRef.current !== socket) return;
      setConnStatus({ text: "切断", state: "error" });
    });
  }, [addLine, settings.delay, settings.live, settings.llm]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  // ログ末尾へのスクロール
  // biome-ignore lint/correctness/useExhaustiveDependencies: チャットログ更新時にスクロールするため
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [chatLines]);

  const handleReset = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send({ type: "reset" });
    } else {
      setChatLines([]);
      userSpeakingRef.current = false;
      setInputText("");
      connect();
    }
  };

  return (
    <>
      <header className="sb-header">
        <h1>Sandbox</h1>
        <label className="sb-field">
          Live
          <select
            value={settings.live}
            onChange={(e) => {
              updateSetting("live", e.target.value);
              addLine("system", "設定を変えたので、新しい Live セッションで接続し直した");
            }}
          >
            <option value="mock">モック</option>
            <option value="gemini">Gemini Live（テキスト）</option>
          </select>
        </label>
        <label className="sb-field">
          LLM
          <select
            value={settings.llm}
            onChange={(e) => {
              updateSetting("llm", e.target.value);
              addLine("system", "設定を変えたので、新しい Live セッションで接続し直した");
            }}
          >
            <option value="mock">モック</option>
            <option value="real">LiteLLM</option>
          </select>
        </label>
        <span className="sb-field">
          ツール <span className="sb-fixed">モック（固定）</span>
        </span>
        <label className="sb-field">
          ツールの処理時間
          <select
            value={settings.delay}
            onChange={(e) => {
              updateSetting("delay", e.target.value);
              addLine("system", "設定を変えたので、新しい Live セッションで接続し直した");
            }}
          >
            <option value="3000">3 秒</option>
            <option value="8000">8 秒</option>
            <option value="15000">15 秒</option>
            <option value="30000">30 秒</option>
          </select>
        </label>
        <label className="sb-field">
          読み上げ速度
          <input
            type="range"
            min="4"
            max="40"
            value={settings.speed}
            onChange={(e) => updateSetting("speed", e.target.value)}
          />
          <span>{settings.speed} 字/秒</span>
        </label>
        <span className="chip" data-state={connStatus.state}>
          {connStatus.text}
        </span>
        <button
          type="button"
          onClick={handleReset}
          title="タスクと通知を消し、新しい Live セッションで接続し直す"
        >
          リセット
        </button>
      </header>

      <div className="sb-stage">
        {/* チャット & 操作パネル */}
        <section className="sb-chat panel">
          <ol ref={logContainerRef} className="sb-log" aria-live="polite">
            {chatLines.map((l) => (
              <li
                key={l.id}
                className={`sb-line sb-${l.role}${l.interrupted ? " sb-interrupted" : ""}`}
              >
                {l.text}
              </li>
            ))}
          </ol>
          <div className="sb-scenario">
            {SCENARIO.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => {
                  startSpeaking();
                  setTimeout(() => finishSpeaking(text), 300);
                }}
              >
                {text}
              </button>
            ))}
          </div>
          <form
            className="sb-form"
            onSubmit={(e) => {
              e.preventDefault();
              finishSpeaking(inputText);
              setInputText("");
            }}
          >
            <textarea
              rows={2}
              value={inputText}
              placeholder="話しかける（入力中は「話している」扱い。Enter で送信）"
              onChange={(e) => {
                const val = e.target.value;
                setInputText(val);
                if (val.trim()) {
                  startSpeaking();
                } else if (userSpeakingRef.current) {
                  userSpeakingRef.current = false;
                  send({ type: "speech_cancel" });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  finishSpeaking(inputText);
                  setInputText("");
                }
              }}
            />
            <button type="submit">送信</button>
          </form>
        </section>

        {/* Tasks フローティングモーダル (/ と同一構造) */}
        <FloatingModal
          title="Tasks"
          initialPosition={isNarrow ? { top: 70, left: 16 } : { top: 70, right: 360 }}
        >
          <TaskBoard tasks={tasks} onSelectReport={(task) => setActiveReportTask(task)} />
        </FloatingModal>

        {/* Notification フローティングモーダル (/ と同一構造) */}
        <FloatingModal
          title="Notification"
          initialPosition={isNarrow ? { top: 290, left: 16 } : { top: 70, right: 24 }}
          headerExtra={
            <span className="chip" data-state={floorState}>
              {FLOOR_LABEL[floorState]}
            </span>
          }
        >
          <NotificationList
            notifications={notifications}
            onManualNotify={(priority) => {
              const summary = {
                urgent: "監視アラート。家のサーバーのディスクが残り少ない。",
                normal: "洗濯が終わった。",
                low: "明日は雨の予報。",
              }[priority];
              send({ type: "debug_notify", priority, summary });
            }}
          />
        </FloatingModal>

        {/* Report フローティングモーダル (/ と同一構造) */}
        <ReportModal
          task={activeReportTask}
          initialPosition={isNarrow ? { top: 70, left: 16 } : { top: 90, left: 540 }}
          onClose={() => setActiveReportTask(null)}
        />

        {/* Live IO フローティングモーダル */}
        <FloatingModal
          title="Live IO"
          initialPosition={isNarrow ? { top: 510, left: 16 } : { top: 440, right: 24 }}
          className="sb-io-modal"
        >
          <LiveIoList items={liveIoItems} />
        </FloatingModal>
      </div>
    </>
  );
}

function describeModes(modes: ConversationModes, delay: string): string {
  const live = modes.live === "gemini" ? "Gemini Live" : "Live モック";
  const llm = modes.llm === "real" ? "LiteLLM" : "LLM モック";
  return `${live} / ${llm} / ツールモック ${Number(delay) / 1000} 秒`;
}
