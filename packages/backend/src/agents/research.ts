import { TIME_ZONE, TUNING } from "../constants.ts";
import type { ChatFn, LlmMessage } from "../llm/client.ts";
import type { ToolArgs, ToolRegistry } from "../tools/index.ts";
import type { AppAgent } from "./types.ts";

/**
 * 調査エージェント。Web 検索等のツールを使い、LLM で調査レポートを作る。
 * 会話層からは research_ask として呼ばれ、タスクとして裏で動く。
 */

export interface ResearchDeps {
  chat: ChatFn;
  tools: ToolRegistry;
  logger: { info(obj: object, msg: string): void };
}

export class ResearchError extends Error {}

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
export function buildSystemPrompt(now: Date = new Date()): string {
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
    "あなたは調査担当のエージェントである。与えられた依頼を、ツールで情報を集めて調べ、日本語の調査レポートにまとめる。",
    "レポートは後で音声向けに要約されるため、結論と根拠を先に書き、冗長にしない。",
    "必要な情報が集まったら追加の検索はせず、速やかにレポートを書く。",
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
): Promise<string> {
  const tools = deps.tools.toOpenAITools();
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
        const args = parseToolArgs(call.function.arguments);
        deps.logger.info({ tool: call.function.name, args }, "research: executing tool");
        const result = await deps.tools.execute(call.function.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
      continue;
    }

    if (res.content) return res.content;
    break;
  }

  // ツールを呼び続けて上限に達した場合、集めた結果からツール無しでレポートを作らせる
  if (usedTools) {
    signal?.throwIfAborted();
    messages.push({
      role: "user",
      content: "これまでに得られた情報に基づいて、調査レポートを作成すること。",
    });
    const res = await deps.chat(messages, []);
    if (res.content) return res.content;
  }

  throw new ResearchError("調査レポートを作成できなかった。");
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
