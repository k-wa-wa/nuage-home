import type { Notification, Task } from "@nuage-home/shared";
import { config, LANG } from "./config.ts";
import { OrbRenderer } from "./orb/orb-renderer.ts";
import { WebSpeechRecognizer } from "./speech/web-speech-recognition.ts";
import { FLOOR_LABEL, TaskBoard } from "./ui/board.ts";
import "./ui/theme.css";
import "./style.css";
import { VoiceClient, type VoiceState } from "./voice/voice-client.ts";

/**
 * 音声モード。オーブを押して話しかける。
 * 声では要約だけを伝え、頼んだ作業の状況と結果の全文はモーダルの一覧に出す。
 */

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <canvas id="orb"></canvas>
  <main class="voice">
    <div class="center-stage">
      <div id="orb-hitbox" class="orb-hitbox" role="button" tabindex="0" title="オーブを押して会話を始める"></div>
      <p id="status" class="status">オーブを押して会話を始める</p>
      <p id="interim" class="interim"></p>
      <ol id="log" class="log" aria-live="polite"></ol>
    </div>

    <section class="floating-modal" id="tasks-modal">
      <div class="modal-header" id="tasks-header">
        <div class="modal-title">
          <span class="drag-handle" aria-hidden="true">⋮⋮</span>
          <h2>Tasks</h2>
        </div>
      </div>
      <div class="modal-body">
        <ol id="tasks" class="list"></ol>
      </div>
    </section>

    <section class="floating-modal" id="notifications-modal">
      <div class="modal-header" id="notifications-header">
        <div class="modal-title">
          <span class="drag-handle" aria-hidden="true">⋮⋮</span>
          <h2>Notification</h2>
        </div>
        <span id="floor" class="chip" data-state="idle">${FLOOR_LABEL.idle}</span>
      </div>
      <div class="modal-body">
        <ol id="notifications" class="list"></ol>
      </div>
    </section>
  </main>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const orb = new OrbRenderer($<HTMLCanvasElement>("orb"));
const statusEl = $<HTMLParagraphElement>("status");
const interimEl = $<HTMLParagraphElement>("interim");
const logEl = $<HTMLOListElement>("log");
const floorEl = $<HTMLSpanElement>("floor");
const board = new TaskBoard($("tasks"), $("notifications"));

const tasksModal = $<HTMLElement>("tasks-modal");
const tasksHeader = $<HTMLElement>("tasks-header");
const notificationsModal = $<HTMLElement>("notifications-modal");
const notificationsHeader = $<HTMLElement>("notifications-header");

let highestZIndex = 10;

interface InitialPosition {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

function setupDraggable(
  modalEl: HTMLElement,
  headerEl: HTMLElement,
  initialPos: InitialPosition,
): void {
  if (initialPos.top !== undefined) modalEl.style.top = `${initialPos.top}px`;
  if (initialPos.bottom !== undefined) modalEl.style.bottom = `${initialPos.bottom}px`;
  if (initialPos.left !== undefined) modalEl.style.left = `${initialPos.left}px`;
  if (initialPos.right !== undefined) modalEl.style.right = `${initialPos.right}px`;

  const bringToFront = () => {
    highestZIndex += 1;
    modalEl.style.zIndex = String(highestZIndex);
    for (const el of document.querySelectorAll(".floating-modal")) {
      el.classList.remove("is-active");
    }
    modalEl.classList.add("is-active");
  };

  modalEl.addEventListener("pointerdown", bringToFront);

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  headerEl.addEventListener("pointerdown", (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, .chip")) return;
    isDragging = true;
    headerEl.setPointerCapture(e.pointerId);
    headerEl.classList.add("dragging");
    bringToFront();

    const rect = modalEl.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;
  });

  headerEl.addEventListener("pointermove", (e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const modalWidth = modalEl.offsetWidth;
    const modalHeight = modalEl.offsetHeight;
    const maxLeft = Math.max(8, window.innerWidth - modalWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - modalHeight - 8);

    const nextLeft = Math.max(8, Math.min(maxLeft, initialLeft + dx));
    const nextTop = Math.max(8, Math.min(maxTop, initialTop + dy));

    modalEl.style.left = `${nextLeft}px`;
    modalEl.style.top = `${nextTop}px`;
    modalEl.style.right = "auto";
    modalEl.style.bottom = "auto";
  });

  const stopDragging = (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    headerEl.classList.remove("dragging");
    try {
      headerEl.releasePointerCapture(e.pointerId);
    } catch {
      // ポインターキャプチャ解除時の例外は無視
    }
  };

  headerEl.addEventListener("pointerup", stopDragging);
  headerEl.addEventListener("pointercancel", stopDragging);
}

const isNarrow = window.innerWidth < 840;
if (isNarrow) {
  setupDraggable(tasksModal, tasksHeader, { top: 16, left: 16 });
  setupDraggable(notificationsModal, notificationsHeader, { top: 260, left: 16 });
} else {
  setupDraggable(tasksModal, tasksHeader, { top: 32, left: 32 });
  setupDraggable(notificationsModal, notificationsHeader, { top: 32, right: 32 });
}

/** 書き起こしは断片で届くため、話者が変わるまで同じ行に足していく */
let currentLine: { role: "user" | "assistant"; el: HTMLLIElement } | null = null;

function appendLog(role: "user" | "assistant" | "error", text: string) {
  if (role !== "error" && currentLine?.role === role) {
    currentLine.el.textContent += text;
  } else {
    const li = document.createElement("li");
    li.className = `log-${role}`;
    li.textContent = text;
    logEl.prepend(li);
    currentLine = role === "error" ? null : { role, el: li };
  }
}

const STATUS_TEXT: Record<VoiceState, string> = {
  stopped: "停止中（オーブを押して再開）",
  connecting: "接続中…",
  listening: "聞き取り中",
  thinking: "考え中…",
  speaking: "話している",
};

// 話している途中の文字の表示と、ログのユーザー発話に使う。
// 会話の聞き取りは Gemini が行うが、音声を 1 ターンにまとめて送る方式では Gemini の書き起こしが返らないため
let interim: WebSpeechRecognizer | null = null;
try {
  interim = new WebSpeechRecognizer(LANG);
  interim.onInterim = (text) => {
    interimEl.textContent = text;
  };
  interim.onFinal = (text) => appendLog("user", text);
} catch (err) {
  console.warn("[main] ブラウザの音声認識は使えない:", err);
}

const client = new VoiceClient(config.voiceWsUrl, {
  onStateChange(state) {
    statusEl.textContent = STATUS_TEXT[state];
    orb.setState(state === "connecting" ? "listening" : state);
    if (state === "stopped") interim?.stop();
    else if (state === "speaking" || state === "thinking") interim?.suspend();
    else interim?.resume();
  },
  onModelText: (text) => appendLog("assistant", text),
  onModelTurnComplete() {
    currentLine = null;
  },
  onUserTranscript: (text) => appendLog("user", text),
  onUserSpeaking(speaking) {
    if (speaking) currentLine = null;
    else interimEl.textContent = "";
  },
  onTask: (task: Task) => board.upsertTask(task),
  onNotification: (notification: Notification) => board.upsertNotification(notification),
  onFloor(state) {
    floorEl.textContent = FLOOR_LABEL[state];
    floorEl.dataset.state = state;
  },
  onError(err) {
    statusEl.textContent = `エラー: ${err.message}`;
    appendLog("error", err.message);
    if (!client.isRunning) orb.setState("stopped");
  },
});

const toggleVoice = () => {
  if (!client.isRunning) interim?.start();
  client.toggle();
};

const hitbox = $<HTMLDivElement>("orb-hitbox");
hitbox.addEventListener("click", toggleVoice);
hitbox.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    toggleVoice();
  }
});
