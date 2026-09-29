import type { OpenAITool, ToolArgs, ToolDefinition } from "./types.ts";

/**
 * ツールの登録と実行。
 * 調査エージェント（LLM の tools）と会話層（Live の即答ツール）の両方で使う。
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = []) {
    for (const t of tools) this.register(t);
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** OpenAI API の tools 形式に変換する */
  toOpenAITools(): OpenAITool[] {
    return this.list().map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  /** ツールを実行する。例外は投げず、LLM にそのまま渡せるエラー文を返す */
  async execute(name: string, args: ToolArgs): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `エラー: ツール '${name}' は登録されていない。`;
    try {
      return await tool.execute(args);
    } catch (err) {
      return `エラー: ツール '${name}' の実行中に例外が発生した: ${String(err)}`;
    }
  }
}
