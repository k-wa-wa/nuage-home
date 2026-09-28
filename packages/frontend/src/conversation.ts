import type { SpeechToText, TextToSpeech } from "./speech/types.ts"

export type AssistantState = "stopped" | "listening" | "thinking" | "speaking"

export interface AgentClient {
  ask(text: string): Promise<string>
}

export interface ConversationView {
  setState(state: AssistantState): void
  showInterim(text: string): void
  log(role: "user" | "assistant" | "error", text: string): void
}

export interface ConversationDeps {
  stt: SpeechToText
  tts: TextToSpeech
  agent: AgentClient
  view: ConversationView
}

/**
 * 「聞く → エージェントに問い合わせる → 読み上げる」の 1 往復を制御する。
 * 応答中（busy）に確定した発話は捨てる。
 */
export class ConversationController {
  private deps: ConversationDeps
  private running = false
  private busy = false

  constructor(deps: ConversationDeps) {
    this.deps = deps
    deps.stt.onFinal = (text) => void this.handleUtterance(text)
    deps.stt.onInterim = (text) => deps.view.showInterim(text)
    deps.stt.onListeningChange = (listening) => {
      if (!this.busy) deps.view.setState(listening ? "listening" : "stopped")
    }
  }

  toggle() {
    this.running = !this.running
    if (this.running) {
      this.deps.stt.start()
    } else {
      this.deps.stt.stop()
      this.deps.view.setState("stopped")
    }
  }

  private async handleUtterance(text: string) {
    if (this.busy) return
    this.busy = true
    const { stt, tts, agent, view } = this.deps
    view.showInterim("")
    view.log("user", text)
    view.setState("thinking")

    try {
      const reply = await agent.ask(text)
      view.log("assistant", reply)

      view.setState("speaking")
      stt.suspend()
      await tts.speak(reply)
    } catch (err) {
      view.log("error", String(err))
    } finally {
      stt.resume()
      view.setState(this.running ? "listening" : "stopped")
      this.busy = false
    }
  }
}
