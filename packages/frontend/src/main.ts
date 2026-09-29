import "./style.css"
import { config } from "./config.ts"
import { ConversationController, type ConversationView } from "./conversation.ts"
import { OrbRenderer } from "./orb/orb-renderer.ts"
import { WebSpeechRecognizer } from "./speech/web-speech-recognition.ts"
import { WebSpeechSynthesizer } from "./speech/web-speech-synthesis.ts"
import { AgentSocket } from "./ws-client.ts"
import { GeminiLiveClient } from "./live-client.ts"

const app = document.querySelector<HTMLDivElement>("#app")!
app.innerHTML = `
  <main>
    <div id="orb-wrapper" style="cursor: pointer;">
      <canvas id="orb"></canvas>
    </div>
    <p id="interim">オーブをクリックして会話を開始</p>
    <ul id="log"></ul>
  </main>
`

const orbWrapper = document.querySelector<HTMLDivElement>("#orb-wrapper")!
const orbCanvas = document.querySelector<HTMLCanvasElement>("#orb")!
const interimEl = document.querySelector<HTMLParagraphElement>("#interim")!
const logEl = document.querySelector<HTMLUListElement>("#log")!
const orb = new OrbRenderer(orbCanvas)

function logLine(role: "user" | "assistant" | "error", text: string) {
  const li = document.createElement("li")
  li.textContent = `${role}: ${text}`
  if (role === "error") {
    li.style.color = "#ff6b6b"
  }
  logEl.prepend(li)
}

if (config.useLiveMode) {
  console.log("[main] Initializing Gemini Live mode with endpoint:", config.backendLiveWsUrl)
  let currentAssistantLi: HTMLLIElement | null = null
  let currentAssistantText = ""

  let stt: WebSpeechRecognizer | null = null
  try {
    stt = new WebSpeechRecognizer(config.lang)
    stt.onInterim = (text) => {
      if (text) {
        interimEl.textContent = `あなた: ${text}`
      }
    }
    stt.onFinal = (text) => {
      if (text) {
        logLine("user", text)
      }
    }
  } catch (err) {
    console.warn("[main] WebSpeechRecognizer not available:", err)
  }

  interface AgentCardState {
    el: HTMLDetailsElement
    summaryEl: HTMLElement
    stepsEl: HTMLDivElement
    actionCount: number
  }
  let currentCard: AgentCardState | null = null

  function ensureAgentCard(title = "ツール・調査活動"): AgentCardState {
    if (currentCard) return currentCard

    const card = document.createElement("details")
    card.className = "agent-card"
    card.open = true

    const summary = document.createElement("summary")
    summary.textContent = `🔧 ${title}`

    const steps = document.createElement("div")
    steps.className = "agent-card-steps"

    card.appendChild(summary)
    card.appendChild(steps)
    logEl.prepend(card)

    currentCard = {
      el: card,
      summaryEl: summary,
      stepsEl: steps,
      actionCount: 0,
    }
    return currentCard
  }

  function addCardStep(icon: string, text: string, detail?: string) {
    const card = ensureAgentCard()
    card.actionCount++
    card.summaryEl.textContent = `🔧 エージェント調査活動 (${card.actionCount} アクション)`

    const stepItem = document.createElement("div")
    stepItem.className = "agent-step-item"
    stepItem.innerHTML = `<span>${icon}</span> <span>${text}</span>`

    if (detail) {
      const resultEl = document.createElement("div")
      resultEl.className = "agent-step-result"
      resultEl.textContent = detail.length > 200 ? `${detail.slice(0, 200)}...` : detail
      stepItem.appendChild(resultEl)
    }

    card.stepsEl.appendChild(stepItem)
  }

  const liveClient = new GeminiLiveClient(config.backendLiveWsUrl, {
    onStateChange: (state) => {
      console.log("[main] LiveState changed:", state)
      switch (state) {
        case "connecting":
          interimEl.textContent = "Gemini Live に接続中..."
          orb.setState("listening")
          break
        case "listening":
          interimEl.textContent = "話しかけてください（聞き取り中）"
          orb.setState("listening")
          currentAssistantLi = null
          currentAssistantText = ""
          stt?.resume()
          break
        case "thinking":
          interimEl.textContent = "Gemini が考え中..."
          orb.setState("thinking")
          stt?.suspend()
          break
        case "speaking":
          interimEl.textContent = "Gemini が発話中..."
          orb.setState("speaking")
          stt?.suspend()
          break
        case "stopped":
          interimEl.textContent = "停止中（クリックして再開）"
          orb.setState("stopped")
          currentAssistantLi = null
          currentAssistantText = ""
          currentCard = null
          stt?.stop()
          break
      }
    },
    onUserSpeaking: (speaking) => {
      if (speaking) {
        currentAssistantLi = null
        currentAssistantText = ""
        currentCard = null
      }
    },
    onUserTranscript: (text) => {
      logLine("user", text)
      currentCard = null
    },
    onToolStart: (tools, toolCalls) => {
      if (tools.includes("run_agent")) {
        interimEl.textContent = "自律エージェントが調査中...（少々お待ちください）"
        ensureAgentCard("自律エージェント調査活動")
      } else {
        interimEl.textContent = `ツール実行中: ${tools.join(", ")}`
        for (const call of toolCalls || []) {
          addCardStep("⚙️", `${call.name}: ${JSON.stringify(call.args)}`)
        }
      }
    },
    onToolResult: (tool, output) => {
      if (tool !== "run_agent") {
        addCardStep("📥", `${tool} の結果取得 (${output.length}文字)`, output)
      }
    },
    onAgentEvent: (event) => {
      switch (event.type) {
        case "step_start":
          addCardStep("📍", `ステップ ${event.step} / ${event.maxSteps}`)
          break

        case "tool_start": {
          let desc = ""
          let icon = "🔍"
          if (event.tool === "wikipedia") {
            const kw = String(event.args.keyword ?? "")
            desc = `Wikipediaで「${kw}」を検索中...`
            interimEl.textContent = `🔍 ${desc}`
          } else if (event.tool === "web_search") {
            const q = String(event.args.query ?? "")
            desc = `Webで「${q}」を検索中...`
            icon = "🌐"
            interimEl.textContent = `🌐 ${desc}`
          } else if (event.tool === "weather") {
            const loc = String(event.args.location ?? "")
            desc = `天気情報を取得中（${loc}）...`
            icon = "🌤️"
            interimEl.textContent = `🌤️ ${desc}`
          } else {
            desc = `${event.tool} を実行中...`
            icon = "⚙️"
            interimEl.textContent = `⚙️ ${desc}`
          }
          addCardStep(icon, `${event.tool}: ${JSON.stringify(event.args)}`)
          break
        }

        case "tool_result": {
          addCardStep("📥", `${event.tool} の結果取得 (${event.output.length}文字)`, event.output)
          break
        }

        case "summarizing":
          interimEl.textContent = "📝 収集データから最終レポートを作成中..."
          addCardStep("📝", "収集データをもとに最終レポートを作成中...")
          break

        case "complete":
          if (currentCard) {
            currentCard.summaryEl.textContent = `✅ 調査完了 (${currentCard.actionCount} アクション, レポート ${event.reportLength}文字)`
          }
          break
      }
    },
    onTranscript: (chunk, isFinal) => {
      if (chunk) {
        if (!currentAssistantLi) {
          currentAssistantLi = document.createElement("li")
          currentAssistantText = ""
          logEl.prepend(currentAssistantLi)
        }
        currentAssistantText += chunk
        currentAssistantLi.textContent = `assistant: ${currentAssistantText}`
      }
      if (isFinal) {
        currentAssistantLi = null
        currentAssistantText = ""
      }
    },
    onError: (err) => {
      console.error("[main] LiveClient error:", err)
      interimEl.textContent = `エラー: ${err.message}`
      orb.setState("stopped")
      logLine("error", err.message)
      stt?.stop()
    },
  })

  orbWrapper.addEventListener("click", () => {
    console.log("[main] Orb clicked! Current running:", liveClient.running)
    if (!liveClient.running) {
      interimEl.textContent = "マイクと接続を初期化中..."
      try {
        stt?.start()
      } catch {}
    } else {
      stt?.stop()
    }
    liveClient.toggle()
  })
} else {
  console.log("[main] Initializing Web Speech mode with endpoint:", config.backendWsUrl)
  const view: ConversationView = {
    setState: (state) => orb.setState(state),
    showInterim: (text) => {
      interimEl.textContent = text
    },
    log: (role, text) => logLine(role, text),
  }

  const agent = new AgentSocket(config.backendWsUrl)
  const controller = new ConversationController({
    stt: new WebSpeechRecognizer(config.lang),
    tts: new WebSpeechSynthesizer(config.lang),
    agent,
    view,
  })

  orbWrapper.addEventListener("click", () => controller.toggle())
}
