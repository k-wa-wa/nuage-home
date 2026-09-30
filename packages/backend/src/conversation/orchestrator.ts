import type {
  ConversationClientMessage,
  ConversationServerMessage,
  LiveIoRecord,
  Task,
} from "@nuage-home/shared";
import type { AppAgent } from "../agents/types.ts";
import { TUNING } from "../constants.ts";
import type { LiveEvent, LivePort, LiveToolCall, UserTurn } from "../live/port.ts";
import type { Summarizer } from "../tasks/summarizer.ts";
import { type Floor, type FloorEvent, initialFloor, reduceFloor } from "./floor.ts";
import type { OrchestrationHub } from "./hub.ts";
import { formatLocation, reverseGeocode } from "./location.ts";
import { buildSystemInstruction, buildTools } from "./prompt.ts";

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
  private readonly opts: OrchestratorOptions;

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.floor = initialFloor(opts.hub.clock());
  }

  get floorState(): Floor {
    return this.floor;
  }

  async start(): Promise<void> {
    const { live, hub, apps, send } = this.opts;
    live.onEvent((e) => this.handleLive(e));
    this.unsubscribers.push(hub.subscribeTasks((task) => send({ type: "task_update", task })));
    this.unsubscribers.push(
      hub.subscribeNotifications((notification) =>
        send({ type: "notification_update", notification }),
      ),
    );
    this.unsubscribers.push(hub.subscribeWake(() => this.tick()));

    await live.start({
      systemInstruction: buildSystemInstruction(apps),
      tools: buildTools(apps),
    });

    // 再接続時に、既存のタスクと通知を画面へ復元する
    for (const task of hub.tasks.list().reverse()) send({ type: "task_update", task });
    for (const notification of hub.queue.list())
      send({ type: "notification_update", notification });
    send({ type: "floor", state: this.floor.state });

    if (!this.opts.manualTick) this.timer = setInterval(() => this.tick(), TUNING.tickIntervalMs);
  }

  handleClient(msg: ConversationClientMessage): void {
    switch (msg.type) {
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
            this.opts.live.sendContext(text);
            this.record({ kind: "context", text });
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
    this.opts.live.close();
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

  /** タスク操作（受付・状況確認・取消）を行う */
  private async handleToolCall(call: LiveToolCall): Promise<Record<string, unknown>> {
    const { hub, apps, summarize } = this.opts;

    if (call.name === "add_task") {
      const instruction = typeof call.args.instruction === "string" ? call.args.instruction : "";
      if (!instruction) return { status: "rejected", message: "依頼内容が空である。" };

      const targetAppName = typeof call.args.app === "string" ? call.args.app : undefined;
      const app =
        (targetAppName ? apps.find((a) => a.name === targetAppName) : undefined) ?? apps[0];
      if (!app) return { status: "rejected", message: "対応できるアプリがない。" };

      hub.startTask(
        { app: app.name, instruction, origin: "voice" },
        (signal) => app.ask(instruction, signal),
        summarize,
      );
      return { status: "accepted", message: "受け付けた。結果は終わりしだい伝える。" };
    }

    if (call.name === "task_status") {
      const list = hub.tasks.list().slice(0, 5);
      if (list.length === 0) return { tasks: [], message: "頼まれている作業はない。" };
      // ID は音声で読み上げると聞き取りにくいため含めない
      return {
        tasks: list.map((t) => ({
          app: t.app,
          instruction: t.instruction,
          status: STATUS_LABEL[t.status],
          summary: t.summary,
        })),
      };
    }

    if (call.name === "cancel_task") {
      const target = typeof call.args.target === "string" ? call.args.target : "";
      const match = target
        ? hub.tasks
            .list()
            .find(
              (t) =>
                (t.status === "accepted" || t.status === "running") &&
                t.instruction.includes(target),
            )
        : undefined;
      const cancelled = hub.tasks.cancel(match?.id);
      return cancelled
        ? { status: "cancelled", instruction: cancelled.instruction }
        : { status: "not_found", message: "取り消せる作業はない。" };
    }

    return { status: "error", message: `未知のツール: ${call.name}` };
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

const STATUS_LABEL: Record<Task["status"], string> = {
  accepted: "受付済み",
  running: "実行中",
  succeeded: "完了",
  failed: "失敗",
  cancelled: "取り消し",
};
