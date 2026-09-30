import type { ClientLocation } from "@nuage-home/shared";
import type { AppAgent } from "../agents/types.ts";
import { TIME_ZONE } from "../constants.ts";
import type { FunctionDeclaration } from "../live/port.ts";
import type { ToolRegistry } from "../tools/index.ts";
import { formatLocation } from "./location.ts";
import { PIGGYBACK_TAG, SPEAK_TAG } from "./notification-queue.ts";

export { formatLocation } from "./location.ts";

/**
 * Live（会話層）に渡す指示とツール宣言。
 * 専門エージェントは `<name>_ask`（即 ack してタスク化）、組み込みツールはその場で実行して結果を返す。
 */

export function buildSystemInstruction(
  apps: AppAgent[],
  tools: ToolRegistry,
  now: Date = new Date(),
  location?: ClientLocation | string,
): string {
  const date = now.toLocaleString("ja-JP", {
    timeZone: TIME_ZONE,
    dateStyle: "full",
    timeStyle: "short",
  });
  return [
    "あなたは親しみやすい家庭用の音声アシスタント。日本語で、短く自然な話し言葉で話す。",
    "ユーザーとの会話・聞き取り・相槌、および作業の受付（タスク化）に専念する。",
    "声だけで自然に伝わるよう、表や箇条書きの読み上げを避け、会話調で簡潔に伝える。",
    "深夜や早朝（23時〜7時）は、より短く静かなトーンで応答する。",
    "最新の情報を扱う際は、現在の年（2026年）を前提とする。",
    ...(location ? [formatLocation(location)] : []),
    ...(tools.list().length > 0
      ? ["天気など、すぐ調べられることはその場で答えるツールを使い、結果を短く伝える。"]
      : []),
    "Web 検索や詳しい調査、アプリの操作や状況確認などの作業は、自分で行わず必ず対応するアプリの *_ask ツールに依頼する。ツールはすぐに受付結果を返すので、短く相槌を返して会話を続ける。結果は後で通知として届く。",
    "利用できるアプリ:",
    ...apps.map((a) => `- ${a.name}: ${a.description}`),
    `「${SPEAK_TAG}」で始まる入力はシステムからの通知で、ユーザーの発言ではない。内容を自然な言葉で短く伝える。`,
    `「${PIGGYBACK_TAG}」を受け取ったら、その場では話さない。ユーザーの次の発言にまず答え、その後に「ところで」と一言だけ添えて通知の内容を伝える。一度伝えた通知は繰り返さない。`,
    "頼んだ作業の進み具合を聞かれたら task_status、取り消しを頼まれたら cancel_task を使う。",
    `現在日時: ${date}`,
  ].join("\n");
}

export function buildTools(apps: AppAgent[], tools: ToolRegistry): FunctionDeclaration[] {
  return [
    ...apps.map((a) => ({
      name: `${a.name}_ask`,
      description: `${a.description}。時間のかかる仕事を依頼する。結果は後で通知として届く。`,
      parameters: {
        type: "object",
        properties: {
          instruction: {
            type: "string",
            description: "依頼内容（ユーザーの言葉を具体的にしたもの）",
          },
        },
        required: ["instruction"],
      },
    })),
    ...tools
      .list()
      .map((t) => ({ name: t.name, description: t.description, parameters: { ...t.parameters } })),
    {
      name: "task_status",
      description: "頼んだ作業の進み具合と結果を確認する",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "cancel_task",
      description: "頼んだ作業を取り消す。対象を省略すると直近の作業を取り消す",
      parameters: {
        type: "object",
        properties: { target: { type: "string", description: "取り消す作業を特定する言葉" } },
      },
    },
  ];
}
