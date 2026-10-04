import type { ChatFn, LlmMessage } from "../../llm/client.ts";
import type { ToolRegistry } from "../../tools/registry.ts";
import type { AppAgent } from "../types.ts";

export interface SmartHomeDeps {
  chat: ChatFn;
  tools: ToolRegistry;
  logger: { info(obj: object, msg: string): void };
}

export class SmartHomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmartHomeError";
  }
}

/**
 * 家電操作エージェント。自然言語の指示から適切な SwitchBot 機器・シーンを特定して操作する。
 */
export function createSmartHomeAgent(deps: SmartHomeDeps): AppAgent {
  return {
    name: "smart_home",
    description: "照明（フロアライト・電球・テープライト）やカーテン等の家電操作",
    ask: (instruction, signal) => runSmartHome(instruction, deps, signal),
  };
}

function buildSystemPrompt(): string {
  return [
    "あなたは家庭内のスマート家電操作を担当するエージェントである。ユーザーの指示に応じて適切なツールを呼び出し、家電（照明、カーテン、電球グループ等）を確実に操作する。",
    "【行動指針】:",
    "- ユーザーの意図を汲み取り、適切なツール（control_device, run_scene）を呼び出す。",
    "- 操作対象のデバイス名が不明確な場合や複数ある場合は、まず list_devices を使って登録デバイス・シーン一覧を確認する。",
    "- 電球グループの操作など、該当するシーンが存在する場合は run_scene を優先して使用する。",
    "- 複数の操作（例: 'カーテンを開けてフロアライトを点灯'）が依頼された場合は、ツール呼び出しを繰り返して全て実行する。",
    "- ツール実行完了後は、何を実行したかを丁寧な敬語（です・ます調）を用い、1〜2文の簡潔な日本語で報告する。長々と解説しない。",
  ].join("\n");
}

export async function runSmartHome(
  instruction: string,
  deps: SmartHomeDeps,
  signal?: AbortSignal,
): Promise<string> {
  const tools = deps.tools.toOpenAITools();
  const messages: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: instruction },
  ];
  const MAX_STEPS = 5;

  for (let step = 0; step < MAX_STEPS; step++) {
    signal?.throwIfAborted();
    const res = await deps.chat(messages, tools);

    if (res.tool_calls && res.tool_calls.length > 0) {
      messages.push({ role: "assistant", content: res.content, tool_calls: res.tool_calls });
      for (const call of res.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          args = {};
        }
        deps.logger.info({ tool: call.function.name, args }, "smart_home: executing tool");
        const result = await deps.tools.execute(call.function.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
      continue;
    }

    if (res.content) return res.content;
    break;
  }

  // ツール実行後に要約回答が得られなかった場合のフォールバック
  signal?.throwIfAborted();
  messages.push({
    role: "user",
    content: "家電の操作結果を簡潔に報告してください。",
  });
  const finalRes = await deps.chat(messages, []);
  if (finalRes.content) return finalRes.content;

  throw new SmartHomeError("家電の操作結果をまとめることができなかった。");
}
