import type {
  ConversationClientMessage,
  ConversationModes,
  ConversationServerMessage,
  LiveIoRecord,
  NotificationPriority,
} from "@nuage-home/shared"
import { config } from "../config.ts"
import { block, chip, FLOOR_LABEL, TaskBoard } from "../ui/board.ts"
import "../ui/theme.css"
import { TypedSpeech, type SpeechBubble } from "./typed-speech.ts"
import "./sandbox.css"

/**
 * タスク・通知の統制を、音声の代わりにテキストで体験するサンドボックス。
 * - 入力欄に文字を打ち始めると「話し始めた」、Enter で「話し終えた」とみなす
 * - Live の発話は一定速度で表示し、表示中は「再生中」として backend に伝える
 * 設計: docs/design/voice-task-orchestration.md
 */

const IO_LABEL: Record<LiveIoRecord["kind"], string> = {
  user_turn: "ユーザー発話",
  context: "文脈（応答させない）",
  prompt: "読み上げ指示",
  tool_call: "ツール呼び出し",
  tool_response: "ツール応答",
}

const SCENARIO = [
  "autopilot で止まってる PR 調べて",
  "週末に京都へ行くんだけど、紅葉のおすすめある？",
  "嵐山ならお昼ご飯はどこがいい？",
  "さっき頼んだの、どうなった？",
  "autopilot の状況を確認して",
  "やっぱりやめて",
]

const root = document.querySelector<HTMLDivElement>("#sandbox")!
root.innerHTML = `
  <header class="sb-header">
    <h1>Sandbox</h1>
    <label class="sb-field">Live
      <select id="sb-live" data-setting>
        <option value="mock">モック</option>
        <option value="gemini">Gemini Live（テキスト）</option>
      </select>
    </label>
    <label class="sb-field">LLM（要約）
      <select id="sb-llm" data-setting>
        <option value="mock">モック</option>
        <option value="real">LiteLLM</option>
      </select>
    </label>
    <span class="sb-field">ツール <span class="sb-fixed">モック（固定）</span></span>
    <label class="sb-field">ツールの処理時間
      <select id="sb-delay" data-setting>
        <option value="3000">3 秒</option>
        <option value="8000">8 秒</option>
        <option value="15000">15 秒</option>
        <option value="30000">30 秒</option>
      </select>
    </label>
    <label class="sb-field">読み上げ速度
      <input id="sb-speed" type="range" min="4" max="40" value="10" />
      <span id="sb-speed-value">10 字/秒</span>
    </label>
    <span id="sb-conn" class="chip">未接続</span>
    <button id="sb-reset" type="button" title="タスクと通知を消し、新しい Live セッションで接続し直す">リセット</button>
  </header>
  <div class="sb-layout">
    <section class="sb-chat panel">
      <div class="sb-floor">発言権: <span id="sb-floor" class="chip" data-state="idle">待機</span></div>
      <ol id="sb-log" class="sb-log" aria-live="polite"></ol>
      <div class="sb-scenario" id="sb-scenario"></div>
      <form id="sb-form" class="sb-form">
        <textarea id="sb-input" rows="2" placeholder="話しかける（入力中は「話している」扱い。Enter で送信）"></textarea>
        <button type="submit">送信</button>
      </form>
    </section>
    <aside class="sb-side">
      <section class="panel">
        <h2>タスク</h2>
        <ol id="sb-tasks" class="list"></ol>
      </section>
      <section class="panel">
        <h2>通知</h2>
        <div class="sb-debug">
          <span>手動で発生:</span>
          <button type="button" data-priority="urgent">urgent</button>
          <button type="button" data-priority="normal">normal</button>
          <button type="button" data-priority="low">low</button>
        </div>
        <ol id="sb-notifications" class="list"></ol>
      </section>
      <section class="panel">
        <h2>Live に送った内容</h2>
        <ol id="sb-io" class="list sb-io"></ol>
      </section>
    </aside>
  </div>
`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const logEl = $<HTMLOListElement>("sb-log")
const inputEl = $<HTMLTextAreaElement>("sb-input")
const floorEl = $<HTMLSpanElement>("sb-floor")
const connEl = $<HTMLSpanElement>("sb-conn")
const liveSel = $<HTMLSelectElement>("sb-live")
const llmSel = $<HTMLSelectElement>("sb-llm")
const delaySel = $<HTMLSelectElement>("sb-delay")
const speedEl = $<HTMLInputElement>("sb-speed")
const ioEl = $<HTMLOListElement>("sb-io")
const board = new TaskBoard($("sb-tasks"), $("sb-notifications"))

let ws: WebSocket | null = null
let userSpeaking = false

function send(msg: ConversationClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function addLine(role: "user" | "assistant" | "system", text: string): HTMLLIElement {
  const li = document.createElement("li")
  li.className = `sb-line sb-${role}`
  li.textContent = text
  logEl.append(li)
  logEl.scrollTop = logEl.scrollHeight
  return li
}

const speech = new TypedSpeech({
  view: {
    begin(): SpeechBubble {
      const li = addLine("assistant", "")
      return {
        append: (t) => {
          li.textContent += t
          logEl.scrollTop = logEl.scrollHeight
        },
        markInterrupted: () => li.classList.add("sb-interrupted"),
      }
    },
    silentTurn: () => addLine("system", "（無言のターン）"),
  },
  onPlaying: (playing) => send({ type: "playback_state", playing }),
  charsPerSecond: () => Number(speedEl.value),
})

/** 話し始めた。実機と同じく、発話開始を先に伝えてから読み上げを止める */
function startSpeaking() {
  if (userSpeaking) return
  userSpeaking = true
  send({ type: "speech_start" })
  speech.bargeIn()
}

function finishSpeaking(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  startSpeaking()
  addLine("user", trimmed)
  send({ type: "user_turn", text: trimmed })
  userSpeaking = false
}

inputEl.addEventListener("input", () => {
  if (inputEl.value.trim()) {
    startSpeaking()
  } else if (userSpeaking) {
    userSpeaking = false
    send({ type: "speech_cancel" })
  }
})

inputEl.addEventListener("keydown", (e) => {
  // IME の変換確定の Enter では送信しない
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    finishSpeaking(inputEl.value)
    inputEl.value = ""
  }
})

$<HTMLFormElement>("sb-form").addEventListener("submit", (e) => {
  e.preventDefault()
  finishSpeaking(inputEl.value)
  inputEl.value = ""
})

const scenarioEl = $<HTMLDivElement>("sb-scenario")
for (const text of SCENARIO) {
  const b = document.createElement("button")
  b.type = "button"
  b.textContent = text
  b.addEventListener("click", () => {
    // 話し始めてから言い終えるまでの時間を少しだけ模擬する
    startSpeaking()
    setTimeout(() => finishSpeaking(text), 300)
  })
  scenarioEl.append(b)
}

for (const b of root.querySelectorAll<HTMLButtonElement>(".sb-debug button")) {
  b.addEventListener("click", () => {
    const priority = b.dataset.priority as NotificationPriority
    const summary = { urgent: "監視アラート。家のサーバーのディスクが残り少ない。", normal: "洗濯が終わった。", low: "明日は雨の予報。" }[priority]
    send({ type: "debug_notify", priority, summary })
  })
}

speedEl.addEventListener("input", () => {
  $<HTMLSpanElement>("sb-speed-value").textContent = `${speedEl.value} 字/秒`
})

// 選択は再読み込みしても残す（ブラウザごとの利便機能なので、保存できなくても動作に影響しない）
const SETTINGS_KEY = "nuage-home.sandbox.settings"
const settingEls = [liveSel, llmSel, delaySel, speedEl]
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Record<string, string>
  for (const el of settingEls) {
    if (saved[el.id] !== undefined) el.value = saved[el.id]
  }
  $<HTMLSpanElement>("sb-speed-value").textContent = `${speedEl.value} 字/秒`
} catch {
  // 保存値が読めなければ既定値で始める
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.fromEntries(settingEls.map((el) => [el.id, el.value]))))
  } catch {
    // 保存できなくても動作は続ける
  }
}
speedEl.addEventListener("change", saveSettings)
for (const el of [liveSel, llmSel, delaySel]) {
  el.addEventListener("change", () => {
    saveSettings()
    addLine("system", "設定を変えたので、新しい Live セッションで接続し直した（タスクと通知は残る）")
    connect()
  })
}

$<HTMLButtonElement>("sb-reset").addEventListener("click", () => {
  if (ws?.readyState === WebSocket.OPEN) {
    // reset_done を受けてから、会話も含めて接続し直す
    send({ type: "reset" })
  } else {
    resetView()
    connect()
  }
})

function resetView() {
  logEl.replaceChildren()
  userSpeaking = false
  inputEl.value = ""
}

function addIo(record: LiveIoRecord, at: number) {
  const li = document.createElement("li")
  const time = new Date(at).toLocaleTimeString("ja-JP")
  li.append(chip(IO_LABEL[record.kind], record.kind), document.createTextNode(` ${time} `))
  if ("text" in record) li.append(block("sb-io-body", record.text))
  if (record.kind === "tool_call") li.append(block("sb-io-body", `${record.name} ${JSON.stringify(record.args)}`))
  if (record.kind === "tool_response") li.append(block("sb-io-body", `${record.name} ${JSON.stringify(record.response)}`))
  ioEl.prepend(li)
}

function handle(msg: ConversationServerMessage) {
  switch (msg.type) {
    case "ready":
      connEl.textContent = `接続中（${describeModes(msg.modes)}）`
      connEl.dataset.state = "ok"
      return
    case "reset_done":
      resetView()
      addLine("system", "リセットした（タスク・通知・会話を消し、新しい Live セッションで接続し直した）")
      connect()
      return
    case "model_text":
      speech.onModelText(msg.text)
      return
    case "model_turn_complete":
      speech.onTurnComplete()
      return
    case "floor":
      floorEl.textContent = FLOOR_LABEL[msg.state]
      floorEl.dataset.state = msg.state
      return
    case "task_update":
      board.upsertTask(msg.task)
      return
    case "notification_update":
      board.upsertNotification(msg.notification)
      return
    case "live_io":
      addIo(msg.record, msg.at)
      return
    case "error":
      addLine("system", `エラー: ${msg.message}`)
      return
    // サンドボックスは音声を使わない
    case "model_audio":
    case "user_transcript":
    case "interrupted":
      return
  }
}

function describeModes(modes: ConversationModes): string {
  const live = modes.live === "gemini" ? "Gemini Live" : "Live モック"
  const llm = modes.llm === "real" ? "LiteLLM" : "LLM モック"
  return `${live} / ${llm} / ツールモック ${Number(delaySel.value) / 1000} 秒`
}

function connect() {
  ws?.close()
  // 新しい Live セッションになるので、表示途中の発話は捨てる
  speech.reset()
  board.clear()
  ioEl.replaceChildren()
  connEl.textContent = "接続中…"
  connEl.dataset.state = "pending"
  const query = new URLSearchParams({ live: liveSel.value, llm: llmSel.value, delay: delaySel.value })
  const socket = new WebSocket(`${config.sandboxWsUrl}?${query}`)
  ws = socket
  socket.addEventListener("message", (e) => {
    if (ws === socket) handle(JSON.parse(String(e.data)) as ConversationServerMessage)
  })
  socket.addEventListener("close", () => {
    if (ws !== socket) return
    connEl.textContent = "切断"
    connEl.dataset.state = "error"
  })
}

connect()
