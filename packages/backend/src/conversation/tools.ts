import { TASK_STATUS_LABEL } from "@nuage-home/shared";
import type { AppAgent } from "../agents/types.ts";
import type { FunctionDeclaration } from "../live/port.ts";
import type { Summarizer } from "../tasks/summarizer.ts";
import type { OrchestrationHub } from "./hub.ts";

/**
 * 会話層（Live）に公開するツール。
 * スキーマ宣言（declaration）と実行ハンドラ（execute）を一体で管理する。
 */
export interface ConversationTool {
  declaration: FunctionDeclaration;
  execute(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface ConversationToolDeps {
  hub: OrchestrationHub;
  apps: AppAgent[];
  summarize: Summarizer;
}

export function buildTools(apps: AppAgent[]): FunctionDeclaration[] {
  // ダミーの hub, summarize を渡して declaration だけ取り出す
  const dummyHub = { tasks: { list: () => [], cancel: () => null } } as unknown as OrchestrationHub;
  const dummySummarize = async () => "";
  return createConversationTools({ hub: dummyHub, apps, summarize: dummySummarize }).map(
    (t) => t.declaration,
  );
}

export function createConversationTools(deps: ConversationToolDeps): ConversationTool[] {
  const { hub, apps, summarize } = deps;
  const appNames = apps.map((a) => a.name);

  const addTaskTool: ConversationTool = {
    declaration: {
      name: "add_task",
      description:
        "照明やカーテンなどの家電操作、Web検索や詳しい調査、開発タスクの確認など、利用できるアプリに作業を依頼する。結果は後で通知として届く。",
      parameters: {
        type: "object",
        properties: {
          instruction: {
            type: "string",
            description: "依頼内容（ユーザーの言葉や状況から汲み取った具体的な作業内容）",
          },
          ...(appNames.length > 0
            ? {
                app: {
                  type: "string",
                  description: `依頼先のアプリ名（${apps.map((a) => `${a.name}: ${a.description}`).join("、")}）`,
                  ...(appNames.length > 1 ? { enum: appNames } : {}),
                },
              }
            : {}),
        },
        required: ["instruction"],
      },
    },
    async execute(args) {
      const instruction = typeof args.instruction === "string" ? args.instruction : "";
      if (!instruction) return { status: "rejected", message: "依頼内容が空である。" };

      const targetAppName = typeof args.app === "string" ? args.app : undefined;
      const app =
        (targetAppName ? apps.find((a) => a.name === targetAppName) : undefined) ?? apps[0];
      if (!app) return { status: "rejected", message: "対応できるアプリがない。" };

      hub.startTask(
        { app: app.name, instruction, origin: "voice" },
        (signal) => app.ask(instruction, signal),
        summarize,
      );
      return { status: "accepted", message: "受け付けた。結果は終わりしだい伝える。" };
    },
  };

  const taskStatusTool: ConversationTool = {
    declaration: {
      name: "task_status",
      description: "頼んだ作業の進み具合と結果を確認する",
      parameters: { type: "object", properties: {} },
    },
    async execute() {
      const list = hub.tasks.list().slice(0, 5);
      if (list.length === 0) return { tasks: [], message: "頼まれている作業はない。" };
      // ID は音声で読み上げると聞き取りにくいため含めない
      return {
        tasks: list.map((t) => ({
          app: t.app,
          instruction: t.instruction,
          status: TASK_STATUS_LABEL[t.status],
          summary: t.summary,
        })),
      };
    },
  };

  const cancelTaskTool: ConversationTool = {
    declaration: {
      name: "cancel_task",
      description: "頼んだ作業を取り消す。対象を省略すると直近の作業を取り消す",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "取り消す作業を特定する言葉" },
        },
      },
    },
    async execute(args) {
      const target = typeof args.target === "string" ? args.target : "";
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
    },
  };

  return [addTaskTool, taskStatusTool, cancelTaskTool];
}
