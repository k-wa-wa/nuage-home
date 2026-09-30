import type {
  ConversationClientMessage,
  ConversationServerMessage,
  LiveIoRecord,
} from "@nuage-home/shared";
import type { AppAgent } from "../agents/types.ts";
import { TUNING } from "../constants.ts";
import type { LiveEvent, LivePort, LiveToolCall, UserTurn } from "../live/port.ts";
import type { Summarizer } from "../tasks/summarizer.ts";
import { type Floor, type FloorEvent, initialFloor, reduceFloor } from "./floor.ts";
import type { OrchestrationHub } from "./hub.ts";
import { formatLocation, reverseGeocode } from "./location.ts";
import { buildSystemInstruction } from "./prompt.ts";
import { type ConversationTool, createConversationTools } from "./tools.ts";

/**
 * 1 つの会話（接続）を受け持ち、Live・タスク・通知を統制する。
 * 音声モードとサンドボックスで共通に使う。
 * 設計: docs/design/voice-task-orchestration.md
 */

export interface OrchestratorOptions {
  live: LivePort;
  hub: OrchestrationHub;
  /** この会話で使う専門エージェント（呼ばれるとタスクとして裏で動く） */
  apps: AppAgent[];
  /** この会話で使う要約 */
  summarize: Summarizer;
  /** 画面（クライアント）への送信 */
  send: (msg: ConversationServerMessage) => void;
  /** 通知キューを自動で評価しない（テスト用） */
  manualTick?: boolean;
}

export class Orchestrator {
  private floor: Floor;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribers: (() => void)[] = [];
  /** 発話中の音声。発話が終わったら 1 ターンとしてまとめて送る */
  private audioChunks: Buffer[] = [];
  private liveActive = false;
  private liveStarting = false;
  private readonly tools: Map<string, ConversationTool>;
  private readonly opts: OrchestratorOptions;

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.floor = initialFloor(opts.hub.clock());
    const toolList = createConversationTools({
      hub: opts.hub,
      apps: opts.apps,
      summarize: opts.summarize,
    });
    this.tools = new Map(toolList.map((t) => [t.declaration.name, t]));
  }

  get floorState(): Floor {
    return this.floor;
  }

  get isLiveActive(): boolean {
    return this.liveActive;
  }

  async start(): Promise<void> {
    const { live, hub, send } = this.opts;
    live.onEvent((e) => this.handleLive(e));
    this.unsubscribers.push(hub.subscribeTasks((task) => send({ type: "task_update", task })));
    this.unsubscribers.push(
      hub.subscribeNotifications((notification) =>
        send({ type: "notification_update", notification }),
      ),
    );
    this.unsubscribers.push(hub.subscribeWake(() => this.tick()));

    // 再接続時に、既存のタスクと通知を画面へ復元する
    for (const task of hub.tasks.list().reverse()) send({ type: "task_update", task });
    for (const notification of hub.queue.list())
      send({ type: "notification_update", notification });
    send({ type: "floor", state: this.floor.state });

    if (!this.opts.manualTick) this.timer = setInterval(() => this.tick(), TUNING.tickIntervalMs);
  }

  async startLive(): Promise<void> {
    if (this.liveActive || this.liveStarting) return;
    this.liveStarting = true;
    try {
      await this.opts.live.start({
        systemInstruction: buildSystemInstruction(this.opts.apps),
        tools: Array.from(this.tools.values()).map((t) => t.declaration),
      });
      this.liveActive = true;
      this.opts.send({ type: "voice_ready" });
    } finally {
      this.liveStarting = false;
    }
  }

  stopLive(): void {
    if (!this.liveActive) return;
    this.opts.live.close();
    this.liveActive = false;
    this.opts.send({ type: "voice_stopped" });
    if (this.floor.state !== "idle") {
      this.apply({ type: "user_speech_cancel" });
    }
  }

  handleClient(msg: ConversationClientMessage): void {
    switch (msg.type) {
      case "voice_start":
        void this.startLive();
        return;
      case "voice_stop":
        this.stopLive();
        return;
      case "speech_start":
        this.audioChunks = [];
        this.apply({ type: "user_speech_start" });
        return;
      case "speech_cancel":
        this.audioChunks = [];
        this.apply({ type: "user_speech_cancel" });
        return;
      case "user_audio":
        // 録音側は発話中の音声だけを送るが、取り消し後に遅れて届いた分などは捨てる
        if (this.floor.state === "user_speaking")
          this.audioChunks.push(Buffer.from(msg.data, "base64"));
        return;
      case "user_audio_end": {
        const audio = Buffer.concat(this.audioChunks);
        this.audioChunks = [];
        if (audio.length < TUNING.minSpeechBytes) {
          // 短すぎる発話はノイズとして捨てる
          this.apply({ type: "user_speech_cancel" });
          return;
        }
        // 16kHz・16bit・モノラル
        this.userTurn({ audio }, `（音声 ${(audio.length / 32_000).toFixed(1)} 秒）`);
        return;
      }
      case "user_turn": {
        const text = msg.text.trim();
        if (!text) {
          this.apply({ type: "user_speech_cancel" });
          return;
        }
        this.userTurn({ text }, text);
        return;
      }
      case "playback_state":
        this.apply({ type: "playback", playing: msg.playing });
        return;
      case "debug_notify":
        this.opts.hub.notify({ priority: msg.priority, summary: msg.summary });
        return;
      case "client_context":
        if (msg.location) {
          const { latitude, longitude } = msg.location;
          void (async () => {
            const address = msg.location?.address ?? (await reverseGeocode(latitude, longitude));
            const loc = { latitude, longitude, address: address ?? undefined };
            const text = formatLocation(loc);
            if (this.liveActive) {
              this.opts.live.sendContext(text);
              this.record({ kind: "context", text });
            }
          })();
        }
        return;
      case "reset":
        this.opts.hub.reset();
        this.opts.send({ type: "reset_done" });
        return;
    }
  }

  /** 通知キューを評価し、配送アクションを実行する */
  tick(): void {
    const { hub, live } = this.opts;
    if (!this.liveActive) return;
    const { actions, changed } = hub.queue.plan(this.floor, hub.clock());
    for (const action of actions) {
      if (action.type === "context") {
        live.sendContext(action.text);
        this.record({ kind: "context", text: action.text });
      } else {
        live.sendPrompt(action.text);
        this.record({ kind: "prompt", text: action.text });
        this.apply({ type: "model_prompted" });
      }
    }
    hub.emitNotifications(changed);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.stopLive();
  }

  private userTurn(turn: UserTurn, label: string): void {
    // 相乗りできる通知があれば、ユーザー発話より先に文脈として渡す
    this.tick();
    this.opts.live.sendUserTurn(turn);
    this.record({ kind: "user_turn", text: label });
    this.apply({ type: "user_turn_sent" });
    this.opts.hub.emitNotifications(this.opts.hub.queue.onUserTurnSent());
  }

  private handleLive(e: LiveEvent): void {
    const { send } = this.opts;
    switch (e.type) {
      case "text":
        send({ type: "model_text", text: e.text });
        return;
      case "audio":
        send({ type: "model_audio", data: e.data });
        return;
      case "user_text":
        send({ type: "user_transcript", text: e.text });
        return;
      case "interrupted":
        send({ type: "interrupted" });
        return;
      case "turn_complete":
        send({ type: "model_turn_complete" });
        this.apply({ type: "model_turn_complete" });
        return;
      case "tool_call":
        // 応答（相槌やツール結果の読み上げ）が来ることを先に数えておく。
        // 即答ツールの実行中に、無言ターンの完了で一瞬 idle になり通知が割り込むのを防ぐ
        this.apply({ type: "model_prompted" });
        void this.respondToToolCalls(e.calls);
        return;
      case "error":
        send({ type: "error", message: e.message });
        return;
    }
  }

  private async respondToToolCalls(calls: LiveToolCall[]): Promise<void> {
    const responses = await Promise.all(
      calls.map(async (call) => {
        this.record({ kind: "tool_call", name: call.name, args: call.args });
        const response = await this.handleToolCall(call);
        this.record({ kind: "tool_response", name: call.name, response });
        return { id: call.id, name: call.name, response };
      }),
    );
    this.opts.live.sendToolResponses(responses);
  }

  /** ツール呼び出しを該当ツールにディスパッチする */
  private async handleToolCall(call: LiveToolCall): Promise<Record<string, unknown>> {
    const tool = this.tools.get(call.name);
    if (!tool) return { status: "error", message: `未知のツール: ${call.name}` };
    return tool.execute(call.args);
  }

  private apply(event: FloorEvent): void {
    const prev = this.floor;
    this.floor = reduceFloor(prev, event, this.opts.hub.clock());
    if (prev.state !== this.floor.state) this.opts.send({ type: "floor", state: this.floor.state });
    this.opts.hub.emitNotifications(this.opts.hub.queue.onFloorChange(prev, this.floor));
  }

  private record(record: LiveIoRecord): void {
    this.opts.send({ type: "live_io", record, at: this.opts.hub.clock() });
  }
}
