import type { Notification, NotificationPriority } from "@nuage-home/shared";
import { TUNING } from "../constants.ts";
import {
  canSpeak,
  DEFAULT_FLOOR_TIMING,
  type Floor,
  type FloorTiming,
  isConversationActive,
} from "./floor.ts";

/**
 * 通知の配送キュー。
 * Floor の状態を見て「読み上げ・相乗り・文脈のみ」のどれで、いつ届けるかを決める。
 * Live への送信そのものは行わず、実行すべきアクションを返すだけにする。
 * 設計: docs/design/voice-task-orchestration.md 6 章
 */

export type DeliveryAction =
  /** turnComplete=true で読み上げさせる */
  | { type: "speak"; ids: string[]; text: string }
  /** turnComplete=false で文脈として渡す（相乗り・low） */
  | { type: "context"; ids: string[]; text: string };

export interface NewNotification {
  priority: NotificationPriority;
  summary: string;
  detail?: string;
  taskId?: string;
}

export const SPEAK_TAG = "[通知]";
export const PIGGYBACK_TAG = "[相乗り通知]";

export class NotificationQueue {
  private items: Notification[] = [];
  private seq = 0;
  private readonly timing: FloorTiming;
  private readonly expireMs: number;

  constructor(
    timing: FloorTiming = DEFAULT_FLOOR_TIMING,
    expireMs: number = TUNING.notificationExpireMs,
  ) {
    this.timing = timing;
    this.expireMs = expireMs;
  }

  list(): Notification[] {
    return this.items.map((n) => ({ ...n }));
  }

  add(input: NewNotification, now: number): Notification {
    const n: Notification = { id: `n-${++this.seq}`, createdAt: now, state: "queued", ...input };
    this.items.push(n);
    return { ...n };
  }

  /**
   * 現在の Floor で実行すべき配送アクションを決め、通知の状態を進める。
   * 戻り値の changed は状態が変わった通知で、画面の更新に使う。
   */
  plan(floor: Floor, now: number): { actions: DeliveryAction[]; changed: Notification[] } {
    const actions: DeliveryAction[] = [];
    const changed = new Set<Notification>();
    const set = (n: Notification, state: Notification["state"]) => {
      n.state = state;
      changed.add(n);
    };

    for (const n of this.items) {
      if (
        (n.state === "queued" || n.state === "piggybacked") &&
        now - n.createdAt >= this.expireMs
      ) {
        set(n, "screen_only");
      }
    }

    // 文脈の差し込みは、Live が話していないとき（ユーザー発話中を含む）に限る
    const contextOk = floor.state === "idle" || floor.state === "user_speaking";
    const conversing = isConversationActive(floor, now, this.timing);

    if (contextOk) {
      const low = this.items.filter((n) => n.state === "queued" && n.priority === "low");
      if (low.length > 0) {
        actions.push({ type: "context", ids: low.map((n) => n.id), text: format(SPEAK_TAG, low) });
        for (const n of low) set(n, "delivered");
      }
      const normal = this.items.filter((n) => n.state === "queued" && n.priority === "normal");
      if (normal.length > 0 && conversing) {
        actions.push({
          type: "context",
          ids: normal.map((n) => n.id),
          text: format(PIGGYBACK_TAG, normal),
        });
        for (const n of normal) set(n, "piggybacked");
      }
    }

    // 遷移を取りこぼしても読み上げ中のまま固まらないようにする
    if (floor.state === "idle") {
      for (const n of this.items) if (n.state === "speaking") set(n, "delivered");
    }

    // 読み上げは 1 度に 1 回。配送中のものがあれば待つ
    if (!this.items.some((n) => n.state === "speaking")) {
      const hasUrgent = this.items.some((n) => n.state === "queued" && n.priority === "urgent");
      const grace = hasUrgent ? this.timing.urgentGraceMs : this.timing.graceMs;
      if (canSpeak(floor, now, grace, this.timing)) {
        const ready = this.items.filter(
          (n) =>
            (n.state === "queued" && n.priority !== "low") ||
            // 相乗りしたが、ユーザーが話さないまま会話が途切れたもの
            (n.state === "piggybacked" && !conversing),
        );
        if (ready.length > 0) {
          ready.sort((a, b) => rank(a.priority) - rank(b.priority) || a.createdAt - b.createdAt);
          actions.push({
            type: "speak",
            ids: ready.map((n) => n.id),
            text: format(SPEAK_TAG, ready),
          });
          for (const n of ready) set(n, "speaking");
        }
      }
    }

    return { actions, changed: [...changed].map((n) => ({ ...n })) };
  }

  /** ユーザーが話したら、相乗り中の通知はその応答で伝わったものとみなす */
  onUserTurnSent(): Notification[] {
    return this.transition("piggybacked", "delivered");
  }

  /** 読み上げ中の通知の結末を Floor の遷移から判定する */
  onFloorChange(prev: Floor, next: Floor): Notification[] {
    if (next.state === "user_speaking" && prev.state !== "user_speaking") {
      // 読み上げ中にユーザーが話し始めた。音声では再送せず、画面の未読として残す
      return this.transition("speaking", "interrupted");
    }
    if (next.state === "idle" && prev.state !== "idle") {
      return this.transition("speaking", "delivered");
    }
    return [];
  }

  private transition(from: Notification["state"], to: Notification["state"]): Notification[] {
    const hit = this.items.filter((n) => n.state === from);
    for (const n of hit) n.state = to;
    return hit.map((n) => ({ ...n }));
  }
}

function rank(p: NotificationPriority): number {
  return p === "urgent" ? 0 : p === "normal" ? 1 : 2;
}

function format(tag: string, items: Notification[]): string {
  if (items.length === 1) return `${tag} ${items[0].summary}`;
  return `${tag} ${items.length}件ある。${items.map((n, i) => `(${i + 1}) ${n.summary}`).join(" ")}`;
}
