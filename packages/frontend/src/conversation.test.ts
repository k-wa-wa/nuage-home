import { describe, expect, it, vi } from "vitest"
import { ConversationController, type AgentClient, type AssistantState } from "./conversation.ts"
import type { SpeechToText, TextToSpeech } from "./speech/types.ts"

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(ask: AgentClient["ask"] = async (text) => `re: ${text}`) {
  const stt: SpeechToText = {
    onFinal: () => {},
    onInterim: () => {},
    onListeningChange: () => {},
    start: vi.fn(),
    stop: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(),
  }
  const tts: TextToSpeech = { speak: vi.fn(async () => {}) }
  const agent: AgentClient = { ask: vi.fn(ask) }
  const states: AssistantState[] = []
  const logs: string[] = []
  const interim: string[] = []
  const controller = new ConversationController({
    stt,
    tts,
    agent,
    view: {
      setState: (s) => states.push(s),
      showInterim: (t) => interim.push(t),
      log: (role, text) => logs.push(`${role}: ${text}`),
    },
  })
  // 実ブラウザと同じく、start() で聞き取り開始を通知する
  vi.mocked(stt.start).mockImplementation(() => stt.onListeningChange(true))
  return { controller, stt, tts, agent, states, logs, interim }
}

describe("ConversationController", () => {
  it("開始すると聞き取り状態になり、停止すると stopped になる", () => {
    const { controller, stt, states } = setup()

    controller.toggle()
    expect(stt.start).toHaveBeenCalled()
    expect(states.at(-1)).toBe("listening")

    controller.toggle()
    expect(stt.stop).toHaveBeenCalled()
    expect(states.at(-1)).toBe("stopped")
  })

  it("発話 → 問い合わせ → 読み上げ → 聞き取り再開 の順に進む", async () => {
    const { controller, stt, tts, states, logs } = setup()
    controller.toggle()

    stt.onFinal("こんにちは")
    await flush()

    expect(states.slice(1)).toEqual(["thinking", "speaking", "listening"])
    expect(logs).toEqual(["user: こんにちは", "assistant: re: こんにちは"])
    expect(tts.speak).toHaveBeenCalledWith("re: こんにちは")
    // 自分の声を拾わないよう、読み上げ前に止めて後で再開する
    const suspendOrder = vi.mocked(stt.suspend).mock.invocationCallOrder[0]
    expect(suspendOrder).toBeLessThan(vi.mocked(tts.speak).mock.invocationCallOrder[0])
    expect(stt.resume).toHaveBeenCalledTimes(1)
  })

  it("問い合わせが失敗してもエラーを記録して聞き取りに戻り、次の発話を受け付ける", async () => {
    const ask = vi.fn<AgentClient["ask"]>().mockRejectedValueOnce(new Error("502")).mockResolvedValue("ok")
    const { controller, stt, states, logs } = setup(ask)
    controller.toggle()

    stt.onFinal("1回目")
    await flush()
    expect(logs.at(-1)).toBe("error: Error: 502")
    expect(states.at(-1)).toBe("listening")

    stt.onFinal("2回目")
    await flush()
    expect(logs.at(-1)).toBe("assistant: ok")
  })

  it("応答中に確定した発話は捨てる", async () => {
    let answer!: (text: string) => void
    const { controller, stt, agent } = setup(() => new Promise((resolve) => (answer = resolve)))
    controller.toggle()

    stt.onFinal("1回目")
    stt.onFinal("割り込み")
    answer("ok")
    await flush()

    expect(agent.ask).toHaveBeenCalledTimes(1)
  })

  it("応答中は認識の開始・終了通知で表示状態を上書きしない", async () => {
    let answer!: (text: string) => void
    const { controller, stt, states } = setup(() => new Promise((resolve) => (answer = resolve)))
    controller.toggle()

    stt.onFinal("こんにちは")
    stt.onListeningChange(false)
    expect(states.at(-1)).toBe("thinking")

    answer("ok")
    await flush()
  })

  it("応答中に停止した場合、応答後は listening ではなく stopped に戻る", async () => {
    let answer!: (text: string) => void
    const { controller, stt, states } = setup(() => new Promise((resolve) => (answer = resolve)))
    controller.toggle()

    stt.onFinal("こんにちは")
    controller.toggle()
    answer("ok")
    await flush()

    expect(states.at(-1)).toBe("stopped")
  })
})
