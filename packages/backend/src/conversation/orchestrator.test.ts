import type { ConversationServerMessage } from "@nuage-home/shared"
import { describe, expect, it } from "vitest"
import type { AppAgent } from "../agents/types.ts"
import { TUNING } from "../constants.ts"
import type { LiveEvent, LivePort, LiveSetup, LiveToolResponse, UserTurn } from "../live/port.ts"
import { ToolRegistry } from "../tools/index.ts"
import { OrchestrationHub } from "./hub.ts"
import { Orchestrator } from "./orchestrator.ts"

type Sent =
  | { kind: "user"; text: string }
  | { kind: "user_audio"; bytes: number }
  | { kind: "context"; text: string }
  | { kind: "prompt"; text: string }
  | { kind: "tool_responses"; responses: LiveToolResponse[] }

class FakeLive implements LivePort {
  sent: Sent[] = []
  setup: LiveSetup | null = null
  private listener: (e: LiveEvent) => void = () => {}
  async start(setup: LiveSetup) {
    this.setup = setup
  }
  sendUserTurn(turn: UserTurn) {
    this.sent.push("audio" in turn ? { kind: "user_audio", bytes: turn.audio.length } : { kind: "user", text: turn.text })
  }
  sendContext(text: string) {
    this.sent.push({ kind: "context", text })
  }
  sendPrompt(text: string) {
    this.sent.push({ kind: "prompt", text })
  }
  sendToolResponses(responses: LiveToolResponse[]) {
    this.sent.push({ kind: "tool_responses", responses })
  }
  onEvent(listener: (e: LiveEvent) => void) {
    this.listener = listener
  }
  emit(e: LiveEvent) {
    this.listener(e)
  }
  close() {}
}

function deferred() {
  let resolve!: (v: string) => void
  const promise = new Promise<string>((r) => (resolve = r))
  return { promise, resolve }
}

async function setup(tools = new ToolRegistry()) {
  let now = 0
  const live = new FakeLive()
  const job = deferred()
  const autopilot: AppAgent = { name: "autopilot", description: "開発タスクの状況確認と調査", ask: () => job.promise }
  const hub = new OrchestrationHub(() => now)
  const out: ConversationServerMessage[] = []
  const orch = new Orchestrator({
    live,
    hub,
    apps: [autopilot],
    tools,
    summarize: async (detail) => `要約: ${detail}`,
    send: (m) => out.push(m),
    manualTick: true,
  })
  await orch.start()
  return {
    live,
    hub,
    orch,
    out,
    job,
    at: (t: number) => {
      now = t
    },
    /** ユーザーが話し、Live が応答し終えるまで（再生込み）を模擬する */
    userTurn(text: string) {
      orch.handleClient({ type: "speech_start" })
      orch.handleClient({ type: "user_turn", text })
    },
    modelSpeaks() {
      orch.handleClient({ type: "playback_state", playing: true })
      live.emit({ type: "turn_complete" })
      orch.handleClient({ type: "playback_state", playing: false })
    },
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("Orchestrator", () => {
  it("ツール呼び出しに即 ack を返し、タスクを裏で動かす", async () => {
    const { live, hub, orch, userTurn } = await setup()
    userTurn("autopilot で止まってる PR 調べて")
    live.emit({ type: "tool_call", calls: [{ id: "c1", name: "autopilot_ask", args: { instruction: "止まっている PR の原因調査" } }] })
    await flush()
    expect(live.sent.at(-1)).toEqual({
      kind: "tool_responses",
      responses: [{ id: "c1", name: "autopilot_ask", response: { status: "accepted", message: "受け付けた。結果は終わりしだい伝える。" } }],
    })
    expect(hub.tasks.list()[0]).toMatchObject({ app: "autopilot", status: "running", origin: "voice" })
    // 無言のツール呼び出しターンが終わっても、相槌を待つ
    live.emit({ type: "turn_complete" })
    expect(orch.floorState.state).toBe("awaiting_model")
  })

  it("会話が途切れているときに終わったタスクは、猶予の後に読み上げる", async () => {
    const { live, hub, orch, job, at, userTurn, modelSpeaks } = await setup()
    userTurn("autopilot で止まってる PR 調べて")
    live.emit({ type: "tool_call", calls: [{ id: "c1", name: "autopilot_ask", args: { instruction: "調査" } }] })
    await flush()
    live.emit({ type: "turn_complete" })
    modelSpeaks() // 相槌

    at(60_000)
    job.resolve("e2e テストのタイムアウトで止まっている")
    await flush()
    await flush()
    expect(hub.tasks.list()[0]).toMatchObject({ status: "succeeded", summary: "要約: e2e テストのタイムアウトで止まっている" })
    expect(live.sent.at(-1)).toEqual({ kind: "prompt", text: "[通知] 要約: e2e テストのタイムアウトで止まっている" })
    expect(orch.floorState.state).toBe("awaiting_model")

    modelSpeaks()
    expect(hub.queue.list()[0].state).toBe("delivered")
  })

  it("会話中に終わったタスクは相乗りにし、次のユーザー発話の前に文脈として渡す", async () => {
    const { live, hub, job, at, userTurn, modelSpeaks } = await setup()
    userTurn("autopilot で止まってる PR 調べて")
    live.emit({ type: "tool_call", calls: [{ id: "c1", name: "autopilot_ask", args: { instruction: "調査" } }] })
    await flush()
    live.emit({ type: "turn_complete" })
    modelSpeaks()
    at(1000)
    userTurn("京都の紅葉のおすすめある？")
    at(1500)
    job.resolve("タイムアウトで停止")
    await flush()
    await flush()
    // Live が応答中なので、まだ何も差し込まない
    expect(live.sent.at(-1)).toEqual({ kind: "user", text: "京都の紅葉のおすすめある？" })

    at(3000)
    modelSpeaks()
    at(3100)
    userTurn("嵐山ならお昼はどこがいい？")
    const lastTwo = live.sent.slice(-2)
    expect(lastTwo).toEqual([
      { kind: "context", text: "[相乗り通知] 要約: タイムアウトで停止" },
      { kind: "user", text: "嵐山ならお昼はどこがいい？" },
    ])
    expect(hub.queue.list()[0].state).toBe("delivered")
  })

  it("読み上げ中にユーザーが話し始めたら、その通知は interrupted にして再送しない", async () => {
    const { live, hub, orch, at } = await setup()
    at(60_000)
    orch.handleClient({ type: "debug_notify", priority: "normal", summary: "洗濯が終わった" })
    expect(live.sent.at(-1)).toEqual({ kind: "prompt", text: "[通知] 洗濯が終わった" })
    orch.handleClient({ type: "playback_state", playing: true })
    orch.handleClient({ type: "speech_start" })
    expect(hub.queue.list()[0].state).toBe("interrupted")
    at(200_000)
    orch.tick()
    expect(live.sent.filter((s) => s.kind === "prompt")).toHaveLength(1)
  })

  it("cancel_task で実行中のタスクを取り消し、結果は通知しない", async () => {
    const { live, hub, job, userTurn } = await setup()
    userTurn("autopilot 調べて")
    live.emit({ type: "tool_call", calls: [{ id: "c1", name: "autopilot_ask", args: { instruction: "PR の調査" } }] })
    await flush()
    live.emit({ type: "tool_call", calls: [{ id: "c2", name: "cancel_task", args: {} }] })
    await flush()
    expect(live.sent.at(-1)).toMatchObject({ responses: [{ response: { status: "cancelled", instruction: "PR の調査" } }] })
    job.resolve("結果")
    await flush()
    await flush()
    expect(hub.tasks.list()[0].status).toBe("cancelled")
    expect(hub.queue.list()).toEqual([])
  })

  it("リセットするとタスクと通知が消え、中止したタスクの結果は通知しない", async () => {
    const { live, hub, job, out, userTurn } = await setup()
    userTurn("autopilot 調べて")
    live.emit({ type: "tool_call", calls: [{ id: "c1", name: "autopilot_ask", args: { instruction: "PR の調査" } }] })
    await flush()
    hub.notify({ priority: "low", summary: "明日は雨" })
    hub.reset()
    expect(hub.tasks.list()).toEqual([])
    expect(hub.queue.list()).toEqual([])
    const before = out.length
    job.resolve("結果")
    await flush()
    await flush()
    expect(hub.queue.list()).toEqual([])
    expect(out.slice(before)).toEqual([])
  })

  it("リセット後に作ったタスクも画面へ通知される", async () => {
    const { live, hub, out, userTurn } = await setup()
    hub.reset()
    userTurn("autopilot 調べて")
    live.emit({ type: "tool_call", calls: [{ id: "c1", name: "autopilot_ask", args: { instruction: "PR の調査" } }] })
    await flush()
    expect(out.filter((m) => m.type === "task_update").at(-1)).toMatchObject({ task: { instruction: "PR の調査", status: "running" } })
  })

  it("task_status は ID を含めずに一覧を返す", async () => {
    const { live, userTurn } = await setup()
    userTurn("autopilot 調べて")
    live.emit({ type: "tool_call", calls: [{ id: "c1", name: "autopilot_ask", args: { instruction: "PR の調査" } }] })
    await flush()
    live.emit({ type: "tool_call", calls: [{ id: "c2", name: "task_status", args: {} }] })
    await flush()
    const last = live.sent.at(-1)
    expect(last).toMatchObject({ responses: [{ response: { tasks: [{ app: "autopilot", instruction: "PR の調査", status: "実行中" }] } }] })
    expect(JSON.stringify(last)).not.toContain("t-1")
  })

  it("アプリ・即答ツール・タスク系ツールを Live に渡す", async () => {
    const weather = { name: "weather", description: "天気", parameters: { type: "object" as const, properties: {} }, execute: async () => "晴れ" }
    const { live } = await setup(new ToolRegistry([weather]))
    expect(live.setup?.tools.map((t) => t.name)).toEqual(["autopilot_ask", "weather", "task_status", "cancel_task"])
  })

  it("音声の発話はまとめて 1 ターンとして送る", async () => {
    const { live, orch, out } = await setup()
    orch.handleClient({ type: "speech_start" })
    const chunk = Buffer.alloc(TUNING.minSpeechBytes).toString("base64")
    orch.handleClient({ type: "user_audio", data: chunk })
    orch.handleClient({ type: "user_audio", data: chunk })
    orch.handleClient({ type: "user_audio_end" })
    expect(live.sent.at(-1)).toEqual({ kind: "user_audio", bytes: TUNING.minSpeechBytes * 2 })
    expect(orch.floorState.state).toBe("awaiting_model")
    expect(out.filter((m) => m.type === "live_io").at(-1)).toMatchObject({ record: { kind: "user_turn", text: "（音声 0.7 秒）" } })
  })

  it("短すぎる音声はノイズとして捨て、発話を取り消す", async () => {
    const { live, orch } = await setup()
    orch.handleClient({ type: "speech_start" })
    orch.handleClient({ type: "user_audio", data: Buffer.alloc(100).toString("base64") })
    orch.handleClient({ type: "user_audio_end" })
    expect(live.sent).toEqual([])
    expect(orch.floorState.state).toBe("idle")
  })

  it("発話を始め直したら、前の発話の音声は捨てる", async () => {
    const { live, orch } = await setup()
    const chunk = Buffer.alloc(TUNING.minSpeechBytes).toString("base64")
    orch.handleClient({ type: "speech_start" })
    orch.handleClient({ type: "user_audio", data: chunk })
    orch.handleClient({ type: "speech_start" })
    orch.handleClient({ type: "user_audio", data: chunk })
    orch.handleClient({ type: "user_audio_end" })
    expect(live.sent.at(-1)).toEqual({ kind: "user_audio", bytes: TUNING.minSpeechBytes })
  })

  it("即答ツールは結果を待って返し、その間に通知を割り込ませない", async () => {
    let finish!: (v: string) => void
    const weather = {
      name: "weather",
      description: "天気",
      parameters: { type: "object" as const, properties: {} },
      execute: () => new Promise<string>((r) => (finish = r)),
    }
    const { live, orch, at, userTurn } = await setup(new ToolRegistry([weather]))
    userTurn("東京の天気は？")
    live.emit({ type: "tool_call", calls: [{ id: "c1", name: "weather", args: { location: "東京" } }] })
    // 無言のツール呼び出しターンが終わっても、ツール結果の読み上げを待つ
    live.emit({ type: "turn_complete" })
    // urgent の猶予は過ぎているが、Live の応答待ちのタイムアウト（20 秒）より前
    at(10_000)
    orch.handleClient({ type: "debug_notify", priority: "urgent", summary: "サーバーが落ちた" })
    expect(live.sent.filter((s) => s.kind === "prompt")).toEqual([])
    finish("東京: 晴れ")
    await flush()
    expect(live.sent.at(-1)).toEqual({
      kind: "tool_responses",
      responses: [{ id: "c1", name: "weather", response: { result: "東京: 晴れ" } }],
    })
  })

  it("Live の音声・書き起こし・ユーザー発話の書き起こし・遮りを画面へ中継する", async () => {
    const { live, out } = await setup()
    live.emit({ type: "audio", data: "AAAA" })
    live.emit({ type: "text", text: "こんにちは" })
    live.emit({ type: "user_text", text: "やあ" })
    live.emit({ type: "interrupted" })
    expect(out.slice(-4)).toEqual([
      { type: "model_audio", data: "AAAA" },
      { type: "model_text", text: "こんにちは" },
      { type: "user_transcript", text: "やあ" },
      { type: "interrupted" },
    ])
  })
})
