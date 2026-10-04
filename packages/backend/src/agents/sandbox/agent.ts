import type { TaskOutput } from "@nuage-home/shared";
import { TIME_ZONE, TUNING } from "../../constants.ts";
import type { ChatFn, LlmMessage, OpenAITool } from "../../llm/client.ts";
import {
  createExecutePythonTool,
  createExecuteShellTool,
  type SandboxExecutor,
  type ToolArgs,
  ToolRegistry,
} from "../../tools/index.ts";
import type { AppAgent } from "../types.ts";

export interface SandboxDeps {
  chat: ChatFn;
  tools: ToolRegistry;
  logger: { info(obj: object, msg: string): void };
}

export class SandboxError extends Error {}

/** タスク完了時に音声用要約と画面用レポートを報告するツール */
export const COMPLETE_TASK_TOOL: OpenAITool = {
  type: "function",
  function: {
    name: "complete_task",
    description:
      "コード実行・分析・グラフ作成が完了した際にユーザーへの最終報告を行う。必ずこのツールを呼び出して作業を終えること。",
    parameters: {
      type: "object",
      properties: {
        speech: {
          type: "string",
          description:
            "音声でそのまま読み上げるための1〜2文（目安60文字以内）の短い報告。丁寧な敬語（です・ます調）で、IDや記号（#、*、-など）を含めず、自然な話し言葉にする。",
        },
        report: {
          type: "object",
          description:
            "画面に表示する詳細レポート。分析結果やグラフ画像、数値一覧など、画面で精読させたい場合のみ含める。",
          properties: {
            title: { type: "string", description: "レポートのタイトル" },
            markdown: {
              type: "string",
              description:
                "見出しや箇条書き、埋め込み画像（![グラフ](data:image/png;base64,...)）を含む詳細な Markdown 本文",
            },
          },
          required: ["title", "markdown"],
        },
      },
      required: ["speech"],
    },
  },
};

/** サンドボックスエージェントが使うツールセット（Python 実行と Shell 実行）を構築する */
export function createSandboxTools(executor: SandboxExecutor): ToolRegistry {
  return new ToolRegistry([createExecutePythonTool(executor), createExecuteShellTool(executor)]);
}

export function createSandboxAgent(deps: SandboxDeps): AppAgent {
  return {
    name: "sandbox",
    description: "Python や Shell による計算・データ分析・グラフ描画・スクリプト実行",
    ask: (instruction, signal) => runSandbox(instruction, deps, signal),
  };
}

/**
 * サンドボックスエージェントのシステムプロンプト
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
    "あなたは Python や Shell を駆使してデータ分析・計算・グラフ描画を行う専門エージェントである。",
    "依頼に対して、自律的にツールを実行して試行錯誤し、最終的な結果を報告する。",
    "",
    "【ツールの使い方とルール】:",
    "- Python での計算・データ集計・グラフ描画には execute_python を使用する（numpy, pandas, matplotlib 等が利用可能）。",
    "- ファイル操作、CLI ツールの利用、シェルスクリプトには execute_shell を使用する。",
    "- 実行エラーが発生した場合は、エラーメッセージを読んで原因を分析し、修正して再実行すること。",
    "",
    "【グラフ描画と画像の扱い】:",
    "- matplotlib でグラフを描画する場合は、ファイルに保存するのではなく io.BytesIO を使い、Base64 エンコードして `__IMAGE_BASE64__:<base64文字列>` という形式で標準出力に出力させること。",
    "  例:",
    "    import io, base64",
    "    import matplotlib.pyplot as plt",
    "    plt.rcParams['font.sans-serif'] = ['Noto Sans CJK JP', 'DejaVu Sans']",
    "    plt.rcParams['axes.unicode_minus'] = False",
    "    plt.style.use('dark_background')",
    "    fig, ax = plt.subplots(figsize=(7, 3.5), dpi=100)",
    "    # ... グラフ描画 ...",
    "    buf = io.BytesIO()",
    "    plt.savefig(buf, format='png', dpi=100, facecolor='#0f172a')",
    "    buf.seek(0)",
    "    print('__IMAGE_BASE64__:' + base64.b64encode(buf.read()).decode('utf-8'))",
    "- 日本語ラベルを使う場合は必ず `plt.rcParams['font.sans-serif'] = ['Noto Sans CJK JP', 'DejaVu Sans']` を設定すること。",
    "- 天気予報や気温などの気象データが必要な場合は、Open-Meteo 等の無料オープン API（例: https://api.open-meteo.com/v1/forecast?latitude=35.6895&longitude=139.6917&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FTokyo）を requests.get で取得して使用すること。",
    "- グラフのデザインはダークテーマ（背景色 `#0f172a`）を適用し、シアン `#38bdf8` やピンク `#f43f5e`、明るいテキスト `#f1f5f9` を使って見やすく洗練されたカラーにすること。",
    "- complete_task ツールの report.markdown には、画像リンク記法 `![グラフ](data:image/png;base64,<取得したbase64>)` をそのまま埋め込むこと。",
    "",
    "【作業の完了】:",
    "- 作業が完了したら、必ず complete_task ツールを呼び出すこと。",
    "- complete_task ツールの speech にはユーザーに音声で話しかける丁寧な敬語（です・ます調）の1〜2文の簡潔な要約を、report には詳細なMarkdownレポートを指定すること。",
    `現在日時: ${date} ${time}`,
  ].join("\n");
}

/**
 * ツール呼び出しとレポート作成を行う。
 */
export async function runSandbox(
  instruction: string,
  deps: SandboxDeps,
  signal?: AbortSignal,
): Promise<TaskOutput> {
  const tools = [...deps.tools.toOpenAITools(), COMPLETE_TASK_TOOL];
  const messages: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: instruction },
  ];
  const capturedImages: string[] = [];

  for (let step = 0; step < TUNING.sandbox.maxToolSteps; step++) {
    signal?.throwIfAborted();
    const res = await deps.chat(messages, tools);

    if (res.tool_calls && res.tool_calls.length > 0) {
      messages.push({ role: "assistant", content: res.content, tool_calls: res.tool_calls });
      for (const call of res.tool_calls) {
        if (call.function.name === "complete_task") {
          const args = parseToolArgs(call.function.arguments);
          const speech =
            typeof args.speech === "string" && args.speech
              ? args.speech
              : res.content || "処理が完了しました。";
          let report: TaskOutput["report"] | undefined;
          if (typeof args.report === "object" && args.report !== null) {
            const r = args.report as Record<string, unknown>;
            if (typeof r.title === "string" && typeof r.markdown === "string") {
              let md = r.markdown;
              // もし LLM の markdown に画像が埋め込まれておらず、途中で取得した画像があれば末尾に付加する
              if (capturedImages.length > 0 && !md.includes("data:image/png;base64")) {
                const imgSection = capturedImages
                  .map((b64, i) => `\n\n![生成グラフ ${i + 1}](data:image/png;base64,${b64})`)
                  .join("");
                md += imgSection;
              }
              report = { title: r.title, markdown: md };
            }
          }
          return { speech, report };
        }

        const args = parseToolArgs(call.function.arguments);
        deps.logger.info({ tool: call.function.name, args }, "sandbox: tool call");
        const output = await deps.tools.execute(call.function.name, args);

        // 出力から __IMAGE_BASE64__ を検知してバッファしておく
        const matches = output.matchAll(/__IMAGE_BASE64__:([A-Za-z0-9+/=]+)/g);
        for (const match of matches) {
          if (match[1]) {
            capturedImages.push(match[1]);
          }
        }

        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
    } else {
      // ツール呼び出しなしでテキスト応答が返ってきた場合
      return {
        speech: res.content || "処理が完了しました。",
        report:
          res.content && res.content.length > 50
            ? { title: "実行結果", markdown: res.content }
            : undefined,
      };
    }
  }

  throw new SandboxError("サンドボックス実行が最大ステップ数を超過しました");
}

function parseToolArgs(json: string): ToolArgs {
  try {
    return JSON.parse(json) as ToolArgs;
  } catch {
    return {};
  }
}
