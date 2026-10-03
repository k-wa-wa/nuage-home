import type { ClientLocation, TaskOutput } from "@nuage-home/shared";
import { TIME_ZONE, TUNING } from "../../constants.ts";
import { formatLocation } from "../../conversation/location.ts";
import type { ChatFn, LlmMessage, OpenAITool } from "../../llm/client.ts";
import {
  createFetchPageTool,
  createWebSearchTool,
  type ToolArgs,
  ToolRegistry,
} from "../../tools/index.ts";
import type { AppAgent } from "../types.ts";

/**
 * 調査エージェント。Web 検索等のツールを使い、LLM で調査レポートを作る。
 * 会話層からは add_task（app: "research"）として呼ばれ、タスクとして裏で動く。
 */

export interface ResearchDeps {
  chat: ChatFn;
  tools: ToolRegistry;
  logger: { info(obj: object, msg: string): void };
}

export class ResearchError extends Error {}

/** タスク完了時に音声用要約と画面用レポートを報告するツール */
export const COMPLETE_TASK_TOOL: OpenAITool = {
  type: "function",
  function: {
    name: "complete_task",
    description:
      "調査・分析が完了した際にユーザーへの最終報告を行う。必ずこのツールを呼び出して作業を終えること。",
    parameters: {
      type: "object",
      properties: {
        speech: {
          type: "string",
          description:
            "音声でそのまま読み上げるための1〜2文（目安60文字以内）の短い報告。IDや記号（#、*、-など）を含めず、自然な話し言葉にする。",
        },
        report: {
          type: "object",
          description:
            "画面に表示する詳細レポート。調査結果や分析など、画面で精読させたい場合のみ含める。",
          properties: {
            title: { type: "string", description: "レポートのタイトル" },
            markdown: { type: "string", description: "見出しや箇条書きを含む詳細な Markdown 本文" },
          },
          required: ["title", "markdown"],
        },
      },
      required: ["speech"],
    },
  },
};

/** 調査エージェントが使うツールセット（Web 検索とページ取得）を構築する */
export function createResearchTools(searxngUrl: string, bwproxyUrl: string): ToolRegistry {
  return new ToolRegistry([createWebSearchTool(searxngUrl), createFetchPageTool(bwproxyUrl)]);
}

export function createResearchAgent(deps: ResearchDeps): AppAgent {
  return {
    name: "research",
    description: "Web 検索を使った詳しい調査・分析・比較",
    ask: (instruction, signal) => runResearch(instruction, deps, signal),
  };
}

/**
 * 日本の現在日時と曜日を埋め込んだシステムプロンプト
 */
export function buildSystemPrompt(
  now: Date = new Date(),
  location?: ClientLocation | string,
): string {
  const date = now.toLocaleDateString("ja-JP", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const time = now.toLocaleTimeString("ja-JP", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
  return [
    "あなたは調査担当のエージェントである。与えられた依頼を、ツールを自律的に駆使して調べ、日本語の調査レポートにまとめる。",
    "【調査とツールの使い方】:",
    "- まず web_search でキーワード検索を行う。",
    "- 検索結果のスニペットを確認し、詳しい内容や根拠が必要な場合は fetch_page で該当ページの本文を取得して精読する。",
    "- 検索結果が見つからない・的外れな場合は、キーワードの言い換えや別の切り口で粘り強く再検索する。",
    "- ページの取得に失敗した（エラーやアクセス拒否）場合は、諦めずに別の検索結果リンクを試す。",
    "- 必要な情報や根拠が集まったら追加の検索はせず、速やかに complete_task ツールを呼び出して調査を完了すること。",
    "- complete_task ツールの speech にはユーザーに音声で話しかける1〜2文の簡潔な要約を、report には画面で閲覧するための見出しや箇条書きを含む詳細なMarkdownレポートを指定すること。",
    "最新の情報を検索・調査する際は、現在の年（2026年）を前提とする。",
    ...(location ? [formatLocation(location)] : []),
    `現在日時: ${date} ${time}`,
  ].join("\n");
}

/**
 * ツール呼び出しとレポート作成を行う。レポートを作れなかった場合は ResearchError を投げる。
 */
export async function runResearch(
  instruction: string,
  deps: ResearchDeps,
  signal?: AbortSignal,
): Promise<TaskOutput> {
  const tools = [...deps.tools.toOpenAITools(), COMPLETE_TASK_TOOL];
  const messages: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: instruction },
  ];
  let usedTools = false;

  for (let step = 0; step < TUNING.researchMaxToolSteps; step++) {
    signal?.throwIfAborted();
    const res = await deps.chat(messages, tools);

    if (res.tool_calls && res.tool_calls.length > 0) {
      usedTools = true;
      messages.push({ role: "assistant", content: res.content, tool_calls: res.tool_calls });
      for (const call of res.tool_calls) {
        if (call.function.name === "complete_task") {
          const args = parseToolArgs(call.function.arguments);
          const speech =
            typeof args.speech === "string" && args.speech
              ? args.speech
              : res.content || "調査が完了した。";
          let report: TaskOutput["report"] | undefined;
          if (typeof args.report === "object" && args.report !== null) {
            const r = args.report as Record<string, unknown>;
            if (typeof r.title === "string" && typeof r.markdown === "string") {
              report = { title: r.title, markdown: r.markdown };
            }
          }
          return { speech, report };
        }

        const args = parseToolArgs(call.function.arguments);
        deps.logger.info({ tool: call.function.name, args }, "research: executing tool");
        const result = await deps.tools.execute(call.function.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
      continue;
    }

    if (res.content) {
      return fallbackTaskOutput(instruction, res.content);
    }
    break;
  }

  // ツールを呼び続けて上限に達した場合、集めた結果からツール無しでレポートを作らせる
  if (usedTools) {
    signal?.throwIfAborted();
    messages.push({
      role: "user",
      content: "これまでに得られた情報に基づいて、調査結果を報告すること。",
    });
    const res = await deps.chat(messages, [COMPLETE_TASK_TOOL]);
    if (res.tool_calls) {
      const completeCall = res.tool_calls.find((c) => c.function.name === "complete_task");
      if (completeCall) {
        const args = parseToolArgs(completeCall.function.arguments);
        const speech =
          typeof args.speech === "string" && args.speech ? args.speech : "調査が完了した。";
        let report: TaskOutput["report"] | undefined;
        if (typeof args.report === "object" && args.report !== null) {
          const r = args.report as Record<string, unknown>;
          if (typeof r.title === "string" && typeof r.markdown === "string") {
            report = { title: r.title, markdown: r.markdown };
          }
        }
        return { speech, report };
      }
    }
    if (res.content) {
      return fallbackTaskOutput(instruction, res.content);
    }
  }

  throw new ResearchError("調査レポートを作成できなかった。");
}

function fallbackTaskOutput(instruction: string, content: string): TaskOutput {
  const first = content.split(/(?<=[。！？!?\n])/)[0]?.trim() ?? "";
  const speech = first.length > 80 ? `${first.slice(0, 80)}…` : first || "調査が完了した。";
  return {
    speech,
    report: {
      title: `${instruction}の調査レポート`,
      markdown: content,
    },
  };
}

function parseToolArgs(raw: string): ToolArgs {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as ToolArgs)
      : {};
  } catch {
    return {};
  }
}
