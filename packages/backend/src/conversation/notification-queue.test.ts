import { describe, expect, it } from "vitest"
import { initialFloor, reduceFloor, type Floor } from "./floor.ts"
import { NotificationQueue } from "./notification-queue.ts"

const idleSince = (t: number): Floor => ({ ...initialFloor(t) })
const speaking = (t: number): Floor => reduceFloor(initialFloor(t), { type: "user_speech_start" }, t)
const modelSpeaking = (t: number): Floor =>
  reduceFloor(reduceFloor(initialFloor(t), { type: "user_turn_sent" }, t), { type: "playback", playing: true }, t)

describe("NotificationQueue.plan", () => {
  it("会話が途切れていれば、猶予の後に読み上げる", () => {
    const q = new NotificationQueue()
    q.add({ priority: "normal", summary: "調査が終わった" }, 20_000)
    expect(q.plan(idleSince(0), 20_000).actions).toEqual([
      { type: "speak", ids: ["n-1"], text: "[通知] 調査が終わった" },
    ])
    expect(q.list()[0].state).toBe("speaking")
  })

  it("ユーザーが話している間は urgent でも読み上げない", () => {
    const q = new NotificationQueue()
    q.add({ priority: "urgent", summary: "サーバーが落ちた" }, 0)
    expect(q.plan(speaking(0), 100_000).actions.filter((a) => a.type === "speak")).toEqual([])
  })

  it("Live が話している間は何も差し込まない", () => {
    const q = new NotificationQueue()
    q.add({ priority: "normal", summary: "調査が終わった" }, 0)
    q.add({ priority: "low", summary: "参考情報" }, 0)
    expect(q.plan(modelSpeaking(0), 1000).actions).toEqual([])
  })

  it("会話中の normal 通知は相乗りにする", () => {
    const q = new NotificationQueue()
    q.add({ priority: "normal", summary: "調査が終わった" }, 5000)
    const { actions } = q.plan(idleSince(0), 5000)
    expect(actions).toEqual([{ type: "context", ids: ["n-1"], text: "[相乗り通知] 調査が終わった" }])
    expect(q.list()[0].state).toBe("piggybacked")
  })

  it("相乗り中にユーザーが話せば、伝わったものとみなす", () => {
    const q = new NotificationQueue()
    q.add({ priority: "normal", summary: "調査が終わった" }, 5000)
    q.plan(idleSince(0), 5000)
    expect(q.onUserTurnSent().map((n) => n.state)).toEqual(["delivered"])
  })

  it("相乗りした後、ユーザーが話さないまま会話が途切れたら読み上げる", () => {
    const q = new NotificationQueue()
    q.add({ priority: "normal", summary: "調査が終わった" }, 5000)
    q.plan(idleSince(0), 5000)
    expect(q.plan(idleSince(0), 9000).actions).toEqual([])
    expect(q.plan(idleSince(0), 10_000).actions).toEqual([
      { type: "speak", ids: ["n-1"], text: "[通知] 調査が終わった" },
    ])
  })

  it("urgent は短い猶予で読み上げ、会話中でも相乗りにしない", () => {
    const q = new NotificationQueue()
    q.add({ priority: "urgent", summary: "サーバーが落ちた" }, 0)
    expect(q.plan(idleSince(0), 700).actions).toEqual([])
    expect(q.plan(idleSince(0), 800).actions).toEqual([
      { type: "speak", ids: ["n-1"], text: "[通知] サーバーが落ちた" },
    ])
  })

  it("low は文脈として渡すだけで読み上げない", () => {
    const q = new NotificationQueue()
    q.add({ priority: "low", summary: "参考情報" }, 0)
    expect(q.plan(idleSince(0), 60_000).actions).toEqual([{ type: "context", ids: ["n-1"], text: "[通知] 参考情報" }])
    expect(q.list()[0].state).toBe("delivered")
  })

  it("読み上げ待ちが複数あれば 1 回にまとめ、urgent を先にする", () => {
    const q = new NotificationQueue()
    q.add({ priority: "normal", summary: "調査が終わった" }, 0)
    q.add({ priority: "urgent", summary: "サーバーが落ちた" }, 1)
    const [action] = q.plan(idleSince(0), 60_000).actions
    expect(action).toEqual({
      type: "speak",
      ids: ["n-2", "n-1"],
      text: "[通知] 2件ある。(1) サーバーが落ちた (2) 調査が終わった",
    })
  })

  it("読み上げ中は次の読み上げをしない", () => {
    const q = new NotificationQueue()
    q.add({ priority: "normal", summary: "1つ目" }, 0)
    q.plan(idleSince(0), 60_000)
    q.add({ priority: "normal", summary: "2つ目" }, 60_000)
    const awaiting = reduceFloor(idleSince(0), { type: "model_prompted" }, 60_000)
    expect(q.plan(awaiting, 90_000).actions).toEqual([])
  })

  it("長く配送できなかった通知は画面のみに落とす", () => {
    const q = new NotificationQueue()
    q.add({ priority: "normal", summary: "調査が終わった" }, 0)
    q.plan(speaking(0), 10 * 60 * 1000)
    expect(q.list()[0].state).toBe("screen_only")
  })
})

describe("NotificationQueue.onFloorChange", () => {
  it("読み上げ中にユーザーが話し始めたら interrupted にする", () => {
    const q = new NotificationQueue()
    q.add({ priority: "normal", summary: "調査が終わった" }, 0)
    q.plan(idleSince(0), 60_000)
    const prev = modelSpeaking(60_000)
    const next = reduceFloor(prev, { type: "user_speech_start" }, 61_000)
    expect(q.onFloorChange(prev, next).map((n) => n.state)).toEqual(["interrupted"])
  })

  it("読み上げが終わって idle に戻ったら delivered にする", () => {
    const q = new NotificationQueue()
    q.add({ priority: "normal", summary: "調査が終わった" }, 0)
    q.plan(idleSince(0), 60_000)
    const prev = modelSpeaking(60_000)
    const next = reduceFloor(reduceFloor(prev, { type: "model_turn_complete" }, 61_000), { type: "playback", playing: false }, 62_000)
    expect(next.state).toBe("idle")
    expect(q.onFloorChange(prev, next).map((n) => n.state)).toEqual(["delivered"])
  })
})
