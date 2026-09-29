export interface ToolParameterProperty {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: string[];
}

export interface ToolParameters {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

/** LLM が生成したツール引数の基底型 */
export type ToolArgs = Record<string, unknown>;

export interface ToolDefinition<TArgs extends ToolArgs = ToolArgs> {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (args: TArgs) => Promise<string>;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameters;
  };
}
