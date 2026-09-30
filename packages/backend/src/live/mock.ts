import { TUNING } from "../constants.ts";
import { PIGGYBACK_TAG, SPEAK_TAG } from "../conversation/notification-queue.ts";
import type { LiveEvent, LivePort, LiveSetup, LiveToolResponse, UserTurn } from "./port.ts";

/**
 * サンドボックス用のモック Live。
 * gemini-3.8-live で検証した挙動（docs/design/voice-task-orchestration.md 2 章・11 章）を再現する。
 * - ツール呼び出しのターンは無言で終わる
 * - 即 ack の toolResponse を受けると相槌を話す
 * - 相乗り通知は黙って覚え、次のユーザー発話への回答の後に「ところで」で触れる
 * - 発話中に turnComplete=true の入力が来ると、現在の発話を遮る
 * 音声は理解できないため、音声の発話には定型文で答える。
 */

interface ToolRoute {
  tool: string;
  app?: string;
  pattern: RegExp;
}

const REQUEST_VERB = /調べ|確認|見て|チェック|やって|進めて|教えて|どう(なって|なってる)/;

export class MockLivePort implements LivePort {
  private listener: (e: LiveEvent) => void = () => {};
  private routes: ToolRoute[] = [];
  private piggyback: string[] = [];
  private speaking: { cancel: () => void } | null = null;
  private callSeq = 0;

  async start(setup: LiveSetup): Promise<void> {
    const addTask = setup.tools.find((t) => t.name === "add_task");
    if (addTask) {
      const appProp = addTask.parameters.properties as Record<string, unknown> | undefined;
      const appEnum = (appProp?.app as { enum?: string[] } | undefined)?.enum ?? ["autopilot"];
      this.routes = appEnum.map((app) => {
        const extra = app === "autopilot" ? "|PR|プルリク|Issue|イシュー|開発" : "";
        return { tool: "add_task", app, pattern: new RegExp(`${app}${extra}`, "i") };
      });
      this.routes.push({
        tool: "add_task",
        app: appEnum[0],
        pattern: /調べ|確認|見て|チェック|やって|進めて|教えて/,
      });
    } else {
      this.routes = setup.tools
        .filter((t) => t.name.endsWith("_ask"))
        .map((t) => {
          const app = t.name.replace(/_ask$/, "");
          const extra = app === "autopilot" ? "|PR|プルリク|Issue|イシュー|開発" : "";
          return { tool: t.name, pattern: new RegExp(`${app}${extra}`, "i") };
        });
    }
  }

  onEvent(listener: (e: LiveEvent) => void): void {
    this.listener = listener;
  }

  sendUserTurn(turn: UserTurn): void {
    if ("audio" in turn) {
      this.later(() => this.speak("ごめん、モックは音声を聞き取れないよ。"));
      return;
    }
    this.later(() => this.respondToUser(turn.text));
  }

  sendContext(text: string): void {
    if (text.startsWith(PIGGYBACK_TAG))
      this.piggyback.push(text.slice(PIGGYBACK_TAG.length).trim());
  }

  sendPrompt(text: string): void {
    this.interruptIfSpeaking();
    const body = text.startsWith(SPEAK_TAG) ? text.slice(SPEAK_TAG.length).trim() : text;
    this.later(() => this.speak(`お待たせ。${body}`));
  }

  sendToolResponses(responses: LiveToolResponse[]): void {
    this.later(() => {
      const lines = responses.map((r) => this.phraseToolResponse(r));
      this.speak(lines.join(""));
    });
  }

  close(): void {
    this.speaking?.cancel();
  }

  private respondToUser(text: string): void {
    const call = this.routeTool(text);
    if (call) {
      // 検証どおり、ツール呼び出しのターンは無言で終わる
      this.emit({ type: "tool_call", calls: [{ id: `mock-${++this.callSeq}`, ...call }] });
      this.later(() => this.emit({ type: "turn_complete" }), 50);
      return;
    }
    let reply = chatReply(text);
    if (this.piggyback.length > 0) {
      reply += `ところで、${this.piggyback.join("それと、")}`;
      this.piggyback = [];
    }
    this.speak(reply);
  }

  private routeTool(text: string): { name: string; args: Record<string, unknown> } | null {
    if (/やめて|キャンセル|取り消/.test(text)) return { name: "cancel_task", args: {} };
    if (/どうなった|進み具合|進捗|終わった[？?]/.test(text))
      return { name: "task_status", args: {} };
    const route = this.routes.find((r) => r.pattern.test(text));
    if (route && REQUEST_VERB.test(text)) {
      if (route.tool === "add_task") {
        return {
          name: "add_task",
          args: { instruction: text, ...(route.app ? { app: route.app } : {}) },
        };
      }
      return { name: route.tool, args: { instruction: text } };
    }
    return null;
  }

  private phraseToolResponse(r: LiveToolResponse): string {
    const res = r.response;
    if (r.name === "add_task" || r.name.endsWith("_ask"))
      return res.status === "accepted" ? "了解、やっておくね。" : "ごめん、うまく頼めなかった。";
    if (r.name === "cancel_task")
      return res.status === "cancelled"
        ? "わかった、取り消したよ。"
        : "取り消せる作業はないみたい。";
    if (r.name === "task_status") {
      const tasks =
        (res.tasks as { instruction: string; status: string; summary?: string }[] | undefined) ??
        [];
      if (tasks.length === 0) return "今お願いされている作業はないよ。";
      return tasks
        .slice(0, 3)
        .map((t) => `「${t.instruction}」は${t.status}${t.summary ? `で、${t.summary}` : ""}。`)
        .join("");
    }
    return "うまくいかなかった。";
  }

  /** 発話を断片に分けて送り、最後に turn_complete を送る */
  private speak(text: string): void {
    this.interruptIfSpeaking();
    const chunks = text.match(/.{1,6}/gsu) ?? [];
    let i = 0;
    let cancelled = false;
    const timer = setInterval(() => {
      if (cancelled) return;
      if (i < chunks.length) {
        this.emit({ type: "text", text: chunks[i++] });
        return;
      }
      clearInterval(timer);
      this.speaking = null;
      this.emit({ type: "turn_complete" });
    }, TUNING.mock.liveChunkIntervalMs);
    this.speaking = {
      cancel: () => {
        cancelled = true;
        clearInterval(timer);
      },
    };
  }

  private interruptIfSpeaking(): void {
    if (!this.speaking) return;
    this.speaking.cancel();
    this.speaking = null;
    this.emit({ type: "interrupted" });
    this.emit({ type: "turn_complete" });
  }

  private later(fn: () => void, ms: number = TUNING.mock.liveResponseDelayMs): void {
    setTimeout(fn, ms);
  }

  private emit(e: LiveEvent): void {
    this.listener(e);
  }
}

/** 雑談の定型応答（モックなので最低限） */
function chatReply(text: string): string {
  if (/こんにちは|おはよう|こんばんは/.test(text)) return "こんにちは！今日はどうする？";
  if (/ありがとう|助かった/.test(text)) return "どういたしまして。";
  if (/紅葉|京都/.test(text)) return "京都の紅葉なら、清水寺や嵐山がきれいだよ。";
  if (/昼|ランチ|ご飯/.test(text)) return "嵐山なら湯豆腐のお店が人気だよ。";
  if (/天気/.test(text)) return "今日は晴れのち曇りみたい。";
  return `なるほど、「${text.slice(0, 20)}」だね。`;
}
