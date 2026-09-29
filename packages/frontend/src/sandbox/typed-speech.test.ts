import { describe, expect, it } from "vitest"
import { TypedSpeech, type SpeechBubble } from "./typed-speech.ts"

function setup() {
  const timers: (() => void)[] = []
  const bubbles: { text: string; interrupted: boolean }[] = []
  const playing: boolean[] = []
  let silent = 0
  const speech = new TypedSpeech({
    view: {
      begin(): SpeechBubble {
        const b = { text: "", interrupted: false }
        bubbles.push(b)
        return { append: (t) => (b.text += t), markInterrupted: () => (b.interrupted = true) }
      },
      silentTurn: () => silent++,
    },
    onPlaying: (p) => playing.push(p),
    charsPerSecond: () => 10,
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => timers.splice(0),
  })
  const drain = () => {
    while (timers.length) timers.shift()!()
  }
  return { speech, bubbles, playing, drain, silent: () => silent }
}

describe("TypedSpeech", () => {
  it("ターンが終わっても、表示し終えるまでは再生中とする", () => {
    const { speech, bubbles, playing, drain } = setup()
    speech.onModelText("了解、")
    speech.onModelText("調べるね。")
    speech.onTurnComplete()
    expect(playing).toEqual([true])
    drain()
    expect(bubbles[0].text).toBe("了解、調べるね。")
    expect(playing).toEqual([true, false])
  })

  it("無言のターンは再生状態を変えない", () => {
    const { speech, playing, silent } = setup()
    speech.onTurnComplete()
    expect(silent()).toBe(1)
    expect(playing).toEqual([])
  })

  it("割り込むと表示を止め、同じターンの残りは捨てる", () => {
    const { speech, bubbles, playing, drain } = setup()
    speech.onModelText("京都の紅葉なら")
    speech.bargeIn()
    expect(bubbles[0]).toEqual({ text: "", interrupted: true })
    expect(playing).toEqual([true, false])
    speech.onModelText("清水寺がきれいだよ。")
    speech.onTurnComplete()
    drain()
    expect(bubbles).toHaveLength(1)
    // 次のターンは通常どおり表示する
    speech.onModelText("どういたしまして。")
    speech.onTurnComplete()
    drain()
    expect(bubbles[1].text).toBe("どういたしまして。")
  })

  it("reset 後は、割り込んだターンの残りを捨てる状態を持ち越さない", () => {
    const { speech, bubbles, drain } = setup()
    speech.onModelText("途中まで")
    speech.bargeIn()
    speech.reset()
    speech.onModelText("新しいセッションの発話")
    speech.onTurnComplete()
    drain()
    expect(bubbles.at(-1)?.text).toBe("新しいセッションの発話")
  })

  it("ターン完了後の割り込みでは、次のターンを捨てない", () => {
    const { speech, bubbles, drain } = setup()
    speech.onModelText("長い説明")
    speech.onTurnComplete()
    speech.bargeIn()
    speech.onModelText("次の応答")
    speech.onTurnComplete()
    drain()
    expect(bubbles[1].text).toBe("次の応答")
  })
})
