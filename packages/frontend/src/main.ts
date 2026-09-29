import type { Notification, Task } from "@nuage-home/shared"
import { config, LANG } from "./config.ts"
import { OrbRenderer } from "./orb/orb-renderer.ts"
import { WebSpeechRecognizer } from "./speech/web-speech-recognition.ts"
import { FLOOR_LABEL, TaskBoard } from "./ui/board.ts"
import "./ui/theme.css"
import "./style.css"
import { VoiceClient, type VoiceState } from "./voice/voice-client.ts"

/**
 * 音声モード。オーブを押して話しかける。
 * 声では要約だけを伝え、頼んだ作業の状況と結果の全文は下の一覧に出す。
 */

const app = document.querySelector<HTMLDivElement>("#app")!
app.innerHTML = `
  <main class="voice">
    <div id="orb-wrapper" class="orb-wrapper">
      <canvas id="orb"></canvas>
    </div>
    <p id="status" class="status">オーブを押して会話を始める</p>
    <p id="interim" class="interim"></p>
    <ol id="log" class="log" aria-live="polite"></ol>
    <div class="boards">
      <section class="panel">
        <h2>頼んだ作業</h2>
        <ol id="tasks" class="list"></ol>
      </section>
      <section class="panel">
        <h2>通知 <span id="floor" class="chip" data-state="idle">${FLOOR_LABEL.idle}</span></h2>
        <ol id="notifications" class="list"></ol>
      </section>
    </div>
  </main>
`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const orb = new OrbRenderer($<HTMLCanvasElement>("orb"))
const statusEl = $<HTMLParagraphElement>("status")
const interimEl = $<HTMLParagraphElement>("interim")
const logEl = $<HTMLOListElement>("log")
const floorEl = $<HTMLSpanElement>("floor")
const board = new TaskBoard($("tasks"), $("notifications"))

/** 書き起こしは断片で届くため、話者が変わるまで同じ行に足していく */
let currentLine: { role: "user" | "assistant"; el: HTMLLIElement } | null = null

function appendLog(role: "user" | "assistant" | "error", text: string) {
  if (role !== "error" && currentLine?.role === role) {
    currentLine.el.textContent += text
  } else {
    const li = document.createElement("li")
    li.className = `log-${role}`
    li.textContent = text
    logEl.prepend(li)
    currentLine = role === "error" ? null : { role, el: li }
  }
}

const STATUS_TEXT: Record<VoiceState, string> = {
  stopped: "停止中（オーブを押して再開）",
  connecting: "接続中…",
  listening: "聞き取り中",
  thinking: "考え中…",
  speaking: "話している",
}

// 話している途中の文字の表示と、ログのユーザー発話に使う。
// 会話の聞き取りは Gemini が行うが、音声を 1 ターンにまとめて送る方式では Gemini の書き起こしが返らないため
let interim: WebSpeechRecognizer | null = null
try {
  interim = new WebSpeechRecognizer(LANG)
  interim.onInterim = (text) => {
    interimEl.textContent = text
  }
  interim.onFinal = (text) => appendLog("user", text)
} catch (err) {
  console.warn("[main] ブラウザの音声認識は使えない:", err)
}

const client = new VoiceClient(config.voiceWsUrl, {
  onStateChange(state) {
    statusEl.textContent = STATUS_TEXT[state]
    orb.setState(state === "connecting" ? "listening" : state)
    if (state === "stopped") interim?.stop()
    else if (state === "speaking" || state === "thinking") interim?.suspend()
    else interim?.resume()
  },
  onModelText: (text) => appendLog("assistant", text),
  onModelTurnComplete() {
    currentLine = null
  },
  onUserTranscript: (text) => appendLog("user", text),
  onUserSpeaking(speaking) {
    if (speaking) currentLine = null
    else interimEl.textContent = ""
  },
  onTask: (task: Task) => board.upsertTask(task),
  onNotification: (notification: Notification) => board.upsertNotification(notification),
  onFloor(state) {
    floorEl.textContent = FLOOR_LABEL[state]
    floorEl.dataset.state = state
  },
  onError(err) {
    statusEl.textContent = `エラー: ${err.message}`
    appendLog("error", err.message)
    if (!client.isRunning) orb.setState("stopped")
  },
})

$<HTMLDivElement>("orb-wrapper").addEventListener("click", () => {
  if (!client.isRunning) interim?.start()
  client.toggle()
})
